-- All Stripe effects are prepared before contacting Stripe, then reconciled.
-- The row lock and revision serialize charges, add-ons and cancellation.
begin;

create table public.visit_billing_runtime (
  id boolean primary key default true check (id),
  last_scheduler_at timestamptz
);
insert into public.visit_billing_runtime (id) values (true);
alter table public.visit_billing_runtime enable row level security;
revoke all on public.visit_billing_runtime from public, anon, authenticated;
grant select, update on public.visit_billing_runtime to service_role;

-- A pending pay rate must not produce a misleading zero-pay invoice.
create or replace function public.defer_unconfirmed_visit_invoice()
returns trigger language plpgsql security definer set search_path = public
as $function$
begin
  if exists (select 1 from public.booking_visit_billing
    where booking_id = new.booking_id and not rate_confirmed) then return null; end if;
  return new;
end;
$function$;
create trigger defer_unconfirmed_visit_invoice before insert on public.provider_job_invoices
for each row execute function public.defer_unconfirmed_visit_invoice();
revoke all on function public.defer_unconfirmed_visit_invoice() from public, anon, authenticated;

create or replace function public.prepare_visit_money_operation(
  p_booking uuid, p_actor uuid, p_type text, p_revision integer, p_parameters jsonb
)
returns jsonb
language plpgsql security definer set search_path = public
as $function$
declare
  v_booking public.bookings;
  v_bill public.booking_visit_billing;
  v_operation public.booking_visit_money_operations;
  v_duration integer;
  v_amount integer;
  v_refund_percent integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required' using errcode = 'insufficient_privilege';
  end if;
  select * into strict v_booking from public.bookings where id = p_booking for update;
  select * into strict v_bill from public.booking_visit_billing where booking_id = p_booking for update;
  if p_type not in ('charge', 'extras', 'cancel', 'unfilled', 'late_refund') then raise exception 'Invalid operation'; end if;
  if p_type = 'late_refund' and (p_actor is not null or not v_bill.deadline_missed) then raise exception 'Invalid late payment refund'; end if;
  if p_actor is not null and p_actor is distinct from v_booking.customer_id then
    raise exception 'Not your booking' using errcode = 'insufficient_privilege';
  end if;
  if p_type = 'extras' and p_actor is null then raise exception 'Customer confirmation required'; end if;
  if v_bill.active_operation_id is not null then
    select * into strict v_operation from public.booking_visit_money_operations where id = v_bill.active_operation_id;
    if v_operation.operation_type = p_type and v_operation.revision = p_revision then
      return to_jsonb(v_operation);
    end if;
    raise exception 'A payment change is still processing. Please wait.';
  end if;
  if v_bill.revision <> p_revision then raise exception 'The visit changed. Refresh and review it again.'; end if;
  if v_booking.status::text not in ('offered', 'declined', 'scheduled') and p_type <> 'late_refund' then
    raise exception 'This visit has started or closed';
  end if;
  if p_type = 'charge' and (
    p_actor is not null or v_bill.status not in ('unpaid', 'failed', 'requires_action')
    or v_bill.charge_due_at > now() or v_booking.scheduled_at <= now() + interval '24 hours'
  ) then raise exception 'This visit is not due for charging'; end if;
  if p_type = 'unfilled' and (p_actor is not null or v_booking.provider_id is not null
    or v_booking.status::text <> 'offered' or v_booking.offer_expires_at > now())
  then raise exception 'This booking has not expired unmatched'; end if;
  if p_type = 'extras' and v_booking.scheduled_at < now() + interval '24 hours' then
    raise exception 'Add-on changes need at least 24 hours notice';
  end if;
  if p_type = 'cancel' and p_actor is null and v_bill.status = 'paid' then
    raise exception 'A paid visit cannot be cancelled for payment failure';
  end if;
  if p_type in ('cancel', 'unfilled', 'late_refund') then
    v_refund_percent := case
      when p_type in ('unfilled', 'late_refund') then 100
      when p_actor is null then 0
      when v_booking.scheduled_at <= now() or
        (v_booking.scheduled_at at time zone 'Europe/London')::date = (now() at time zone 'Europe/London')::date then 0
      when v_booking.scheduled_at >= now() + interval '48 hours' then 100
      when v_booking.scheduled_at >= now() + interval '24 hours' then 75
      else 50 end;
    if (p_parameters ->> 'refundPercent')::integer is distinct from v_refund_percent then
      raise exception 'The cancellation window changed. Review the updated refund.';
    end if;
  end if;
  insert into public.booking_visit_money_operations (
    booking_id, customer_id, operation_type, revision, idempotency_key, parameters
  ) values (
    p_booking, v_bill.customer_id, p_type, p_revision,
    'visit:' || gen_random_uuid()::text,
    p_parameters || jsonb_build_object(
      'oldScope', v_booking.cleaning_extras, 'oldDuration', v_booking.duration_minutes,
      'oldNotes', v_booking.household_notes, 'oldStatus', v_bill.status,
      'actor', p_actor, 'scheduledAt', v_booking.scheduled_at
    )
  ) returning * into v_operation;
  update public.booking_visit_billing set active_operation_id = v_operation.id,
    status = case when p_type = 'charge' then 'charging' when p_type = 'extras' then 'changing' else 'cancelling' end,
    updated_at = now() where booking_id = p_booking;
  perform set_config('opulence.visit_billing_operation', v_operation.id::text, true);
  if p_type = 'extras' then
    v_duration := (p_parameters -> 'scope' ->> 'durationMinutes')::integer;
    select sum((line ->> 'amountPence')::integer) into v_amount
      from jsonb_array_elements(p_parameters -> 'lines') line;
    if v_duration not between 120 and 480 or v_duration % 30 <> 0 or v_amount <= 0
      or (p_parameters ->> 'amountPence')::integer <> v_amount
      or not (p_parameters -> 'lines' @> jsonb_build_array(jsonb_build_object(
        'id', 'cleaning', 'amountPence', v_bill.base_pence - v_bill.discount_pence
      ))) then raise exception 'Invalid visit scope'; end if;
    -- Reserve the longer calendar slot BEFORE taking money. Capacity/window
    -- triggers reject this transaction if the assigned person has a clash.
    update public.bookings set cleaning_extras = p_parameters -> 'scope',
      duration_minutes = v_duration where id = p_booking;
  elsif p_type in ('cancel', 'unfilled', 'late_refund') then
    perform public._apply_booking_transition(p_booking, 'cancelled', p_actor,
      case when p_actor is null then 'system' else 'customer' end,
      case when p_type = 'unfilled' then 'No cleaner accepted this visit'
        when p_actor is null then 'Visit unpaid at the 24-hour deadline'
        else 'Customer cancelled this visit' end,
      jsonb_build_object('visit_money_operation', v_operation.id,
        'refund_percent', p_parameters -> 'refundPercent'));
    update public.booking_offers set status = 'expired' where booking_id = p_booking and status = 'open';
  end if;
  return to_jsonb(v_operation);
end;
$function$;

create or replace function public.claim_visit_money_operation(p_operation uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $function$
declare v_op public.booking_visit_money_operations;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  select * into strict v_op from public.booking_visit_money_operations where id = p_operation for update;
  if v_op.status in ('succeeded', 'failed') or v_op.lease_until > now() then return null; end if;
  update public.booking_visit_money_operations set status = 'running',
    lease_until = now() + interval '3 minutes' where id = p_operation returning * into v_op;
  return to_jsonb(v_op);
end;
$function$;

create or replace function public.finish_visit_money_operation(
  p_operation uuid, p_outcome text, p_results jsonb, p_error text default null
)
returns void
language plpgsql security definer set search_path = public
as $function$
declare
  v_op public.booking_visit_money_operations;
  v_bill public.booking_visit_billing;
  v_booking public.bookings;
  v_result jsonb;
  v_charge public.booking_visit_charges;
  v_payment uuid;
  v_previous text;
  v_next text;
  v_net integer;
  v_series uuid;
  v_count integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  if p_outcome not in ('succeeded', 'failed', 'ambiguous') then raise exception 'Invalid outcome'; end if;
  select booking_id into strict v_series from public.booking_visit_money_operations where id = p_operation;
  select * into strict v_booking from public.bookings where id = v_series for update;
  select * into strict v_bill from public.booking_visit_billing where booking_id = v_series for update;
  select * into strict v_op from public.booking_visit_money_operations where id = p_operation for update;
  if v_op.status in ('succeeded', 'failed') then return; end if;
  if v_bill.active_operation_id is distinct from p_operation then raise exception 'Operation no longer owns this visit'; end if;
  if p_outcome = 'ambiguous' then
    update public.booking_visit_money_operations set status = 'ambiguous', stripe_objects = p_results,
      lease_until = null, error = p_error where id = p_operation;
    return;
  end if;
  perform set_config('opulence.visit_billing_operation', p_operation::text, true);
  -- Failed card payments are recorded too; an ambiguous Stripe outcome MUST
  -- stay active until reconciliation, never become a new charge attempt.
  for v_result in select value from jsonb_array_elements(p_results) loop
    if v_result ->> 'type' = 'charge' and v_result ->> 'status' = 'succeeded' then
      if (v_result ->> 'amountPence')::integer <= 0 then raise exception 'Invalid charge'; end if;
      if v_op.operation_type = 'charge' then
        select id, status into v_payment, v_previous from public.payments
          where booking_id = v_bill.booking_id and stripe_payment_ref is null
            and coalesce(kind, '') <> 'tip' order by created_at limit 1 for update;
      else v_payment := null; v_previous := null; end if;
      if v_payment is null then
        insert into public.payments (booking_id, stripe_payment_ref, gross_amount, status, split_breakdown)
        values (v_bill.booking_id, v_result ->> 'id', (v_result ->> 'amountPence')::integer / 100.0,
          'succeeded', jsonb_build_object('provider', 0, 'platform_margin', 0,
            'billing_model', 'per_visit', 'pay_rate_pending', true,
            'reserved_lines', v_result -> 'lines')) returning id into v_payment;
        insert into public.payment_events (payment_id, to_status, actor_kind, reason, meta)
        values (v_payment, 'succeeded', 'system', 'Per-visit charge confirmed', jsonb_build_object('operation', p_operation));
      else
        update public.payments set stripe_payment_ref = v_result ->> 'id',
          gross_amount = (v_result ->> 'amountPence')::integer / 100.0,
          status = 'succeeded', status_changed_at = now(),
          split_breakdown = jsonb_build_object('provider', 0, 'platform_margin', 0,
            'billing_model', 'per_visit', 'pay_rate_pending', true, 'reserved_lines', v_result -> 'lines')
          where id = v_payment;
        insert into public.payment_events (payment_id, from_status, to_status, actor_kind, reason, meta)
        values (v_payment, v_previous, 'succeeded', 'system', 'Per-visit charge confirmed', jsonb_build_object('operation', p_operation));
      end if;
      insert into public.booking_visit_charges (booking_id, stripe_payment_intent, amount_pence, line_items, operation_id, payment_id)
      values (v_bill.booking_id, v_result ->> 'id', (v_result ->> 'amountPence')::integer,
        v_result -> 'lines', p_operation, v_payment) on conflict (stripe_payment_intent) do nothing;
    elsif v_result ->> 'type' = 'refund' then
      select * into strict v_charge from public.booking_visit_charges where id = (v_result ->> 'chargeId')::uuid for update;
      update public.booking_visit_charges set refunded_pence = refunded_pence + (v_result ->> 'amountPence')::integer,
        refunded_lines = coalesce(v_result -> 'refundedLines', refunded_lines) where id = v_charge.id;
      v_next := case when v_charge.refunded_pence + (v_result ->> 'amountPence')::integer = v_charge.amount_pence then 'refunded' else 'partially_refunded' end;
      select status into v_previous from public.payments where id = v_charge.payment_id;
      update public.payments set status = v_next, status_changed_at = now() where id = v_charge.payment_id;
      insert into public.payment_events (payment_id, from_status, to_status, actor_kind, reason, meta)
      values (v_charge.payment_id, v_previous, v_next, 'system', 'Visit refund confirmed',
        jsonb_build_object('operation', p_operation, 'stripe_refund', v_result ->> 'id', 'amount_pence', v_result -> 'amountPence'));
    end if;
  end loop;
  if p_outcome = 'failed' and v_op.operation_type = 'extras' then
    update public.bookings set cleaning_extras = v_op.parameters -> 'oldScope',
      duration_minutes = (v_op.parameters ->> 'oldDuration')::integer,
      household_notes = v_op.parameters ->> 'oldNotes' where id = v_bill.booking_id;
  end if;
  update public.booking_visit_money_operations set status = p_outcome, stripe_objects = p_results,
    lease_until = null, completed_at = now(), error = p_error where id = p_operation;
  update public.booking_visit_billing set active_operation_id = null,
    status = case
      when v_op.operation_type in ('cancel', 'unfilled', 'late_refund') then 'cancelled'
      when p_outcome = 'failed' and v_bill.deadline_missed then 'cancelled'
      when p_outcome = 'failed' and v_op.operation_type = 'charge' then 'failed'
      when p_outcome = 'failed' then v_op.parameters ->> 'oldStatus'
      when v_op.operation_type = 'charge' then 'paid'
      else v_op.parameters ->> 'oldStatus' end,
    amount_pence = case when p_outcome = 'succeeded' and v_op.operation_type = 'extras'
      then (v_op.parameters ->> 'amountPence')::integer else amount_pence end,
    line_items = case when p_outcome = 'succeeded' and v_op.operation_type = 'extras'
      then v_op.parameters -> 'lines' else line_items end,
    revision = revision + 1,
    attempts = attempts + case when v_op.operation_type = 'charge' then 1 else 0 end,
    retry_after = case when p_outcome = 'failed' and v_op.operation_type = 'charge' then now() + interval '6 hours' else null end,
    last_error = p_error, updated_at = now() where booking_id = v_bill.booking_id;
  if v_op.operation_type in ('cancel', 'unfilled', 'late_refund') then
    insert into public.notifications (user_id, title, body, href) values (
      v_bill.customer_id,
      case when v_op.operation_type = 'unfilled' then 'We couldn''t match your booking' else 'Visit cancelled' end,
      case when v_op.operation_type = 'unfilled' then 'No cleaner accepted this visit. Any payment for it has been refunded in full.'
        when v_op.parameters ->> 'actor' is null then 'This visit was still unpaid 24 hours before its start and has been cancelled. Please update your saved card.'
        else 'Your visit has been cancelled and its payment adjustment has been confirmed.' end,
      '/account/visit/' || v_bill.booking_id::text);
    if v_booking.provider_id is not null then
      insert into public.notifications (user_id, title, body, href)
      select profile_id, 'Visit cancelled', 'This visit has been removed from your schedule.', '/worker'
      from public.providers where id = v_booking.provider_id;
    end if;
    v_series := v_booking.regular_series_id;
    if v_op.parameters ->> 'actor' is not null and v_series is not null
      and exists (select 1 from public.bookings where regular_series_id = v_series and regular_visit_number = 1 and status::text = 'completed')
      and not exists (select 1 from public.bookings where regular_series_id = v_series and regular_visit_number > 1 and status::text <> 'cancelled')
    then
      insert into public.regular_series_cancellation_flags (customer_id, cancelled_after_first, series_ids)
      values (v_bill.customer_id, 1, array[v_series])
      on conflict (customer_id) do update set
        cancelled_after_first = regular_series_cancellation_flags.cancelled_after_first + 1,
        series_ids = array_append(regular_series_cancellation_flags.series_ids, v_series), updated_at = now()
      where not v_series = any(regular_series_cancellation_flags.series_ids)
      returning cancelled_after_first into v_count;
      if v_count >= 2 then
        insert into public.notifications (user_id, title, body, href)
        select id, 'Regular series cancellation pattern', 'A customer has cancelled two regular series after their first completed visit. Please review; their rate is unchanged.', '/admin/customers/' || v_bill.customer_id::text
        from public.profiles where role::text = 'admin';
      end if;
    end if;
  elsif p_outcome = 'failed' and v_op.operation_type = 'charge' then
    insert into public.notifications (user_id, title, body, href) values (v_bill.customer_id,
      'Update your saved card', 'Your visit payment failed. Update your saved card in Payments. We will retry; if still unpaid 24 hours before the visit, it will be cancelled.', '/account/settings/payments');
  end if;
end;
$function$;

-- Stop an unpaid visit at its deadline even if a delayed Stripe response is
-- still being reconciled. A late success is refunded by a separate operation.
create or replace function public.mark_visit_payment_deadline(p_booking uuid)
returns void language plpgsql security definer set search_path = public
as $function$
declare v_book public.bookings; v_bill public.booking_visit_billing;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  select * into strict v_book from public.bookings where id = p_booking for update;
  select * into strict v_bill from public.booking_visit_billing where booking_id = p_booking for update;
  if v_book.scheduled_at > now() + interval '24 hours' or v_bill.status = 'paid' or v_bill.deadline_missed then return; end if;
  if v_bill.active_operation_id is null then return; end if;
  perform set_config('opulence.visit_billing_operation', v_bill.active_operation_id::text, true);
  perform public.system_transition_booking(p_booking, 'cancelled', 'Unpaid at the 24-hour deadline; delayed payment reconciliation pending');
  update public.booking_visit_billing set deadline_missed = true where booking_id = p_booking;
  update public.booking_offers set status = 'expired' where booking_id = p_booking and status = 'open';
  insert into public.notifications (user_id, title, body, href) values (v_bill.customer_id,
    'Visit cancelled', 'Your visit was still unpaid at the 24-hour deadline. A delayed payment will be refunded; please update your card.', '/account/visit/' || p_booking::text);
  insert into public.notifications (user_id, title, body, href)
  select profile_id, 'Visit cancelled', 'This unpaid visit has been removed from your schedule.', '/worker'
  from public.providers where id = v_book.provider_id;
end;
$function$;

-- Enforce the cutoff even if an old client calls the state RPC directly.
create or replace function public.guard_visit_billing_booking_changes()
returns trigger language plpgsql security definer set search_path = public
as $function$
declare v_bill public.booking_visit_billing; v_owned boolean;
begin
  select * into v_bill from public.booking_visit_billing where booking_id = old.id for update;
  if not found then return new; end if;
  v_owned := v_bill.active_operation_id is not null and
    current_setting('opulence.visit_billing_operation', true) = v_bill.active_operation_id::text;
  if new.package_id is distinct from old.package_id then raise exception 'To change your package, cancel this visit and rebook.'; end if;
  if new.status::text = 'cancelled' and old.status::text <> 'cancelled' and not coalesce(v_owned, false) then
    raise exception 'Use the visit cancellation form so its payment is adjusted.';
  end if;
  if new.scheduled_at is distinct from old.scheduled_at then
    if old.scheduled_at < now() + interval '24 hours' then raise exception 'Date changes need at least 24 hours notice'; end if;
    if new.scheduled_at < now() + interval '24 hours' and v_bill.status <> 'paid' then raise exception 'An unpaid visit needs at least 24 hours notice'; end if;
  end if;
  if (new.scheduled_at is distinct from old.scheduled_at or new.status is distinct from old.status)
    and v_bill.active_operation_id is not null and not coalesce(v_owned, false)
  then raise exception 'A payment change is still processing. Please wait.'; end if;
  if new.status::text in ('scheduled', 'in_progress') and v_bill.status <> 'paid'
    and new.scheduled_at <= now() + interval '24 hours'
  then raise exception 'This visit must be paid before work can proceed'; end if;
  return new;
end;
$function$;

create or replace function public.per_visit_checkout_ready()
returns boolean language sql security definer set search_path = public
as $function$
  select to_regprocedure('public.finish_visit_money_operation(uuid,text,jsonb,text)') is not null
    and exists (select 1 from public.visit_billing_runtime where last_scheduler_at > now() - interval '20 minutes');
$function$;

revoke all on function public.prepare_visit_money_operation(uuid,uuid,text,integer,jsonb),
  public.claim_visit_money_operation(uuid), public.finish_visit_money_operation(uuid,text,jsonb,text),
  public.mark_visit_payment_deadline(uuid),
  public.per_visit_checkout_ready() from public, anon, authenticated;
grant execute on function public.prepare_visit_money_operation(uuid,uuid,text,integer,jsonb),
  public.claim_visit_money_operation(uuid), public.finish_visit_money_operation(uuid,text,jsonb,text),
  public.mark_visit_payment_deadline(uuid),
  public.per_visit_checkout_ready() to service_role;

commit;
notify pgrst, 'reload schema';
