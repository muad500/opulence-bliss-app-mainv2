begin;

-- One clock calculation used by failed-payment processing and boundary tests.
create function public.late_acceptance_card_update_deadline(
  p_scheduled timestamptz, p_failed_at timestamptz
)
returns timestamptz
language sql immutable set search_path = public
as $function$
  select greatest(p_failed_at, least(
    p_failed_at + interval '2 hours', p_scheduled - interval '3 hours'
  ));
$function$;
revoke all on function public.late_acceptance_card_update_deadline(timestamptz,timestamptz)
  from public, anon, authenticated;
grant execute on function public.late_acceptance_card_update_deadline(timestamptz,timestamptz) to service_role;

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
  v_gate jsonb;
  v_grace_until timestamptz;
  v_new_grace boolean := false;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  if p_outcome not in ('succeeded', 'failed', 'ambiguous', 'blocked') then raise exception 'Invalid outcome'; end if;
  select booking_id into strict v_series from public.booking_visit_money_operations where id = p_operation;
  perform public.lock_visit_series(v_series);
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
  if p_outcome in ('failed', 'blocked') and v_op.operation_type = 'extras' then
    update public.bookings set cleaning_extras = v_op.parameters -> 'oldScope',
      duration_minutes = (v_op.parameters ->> 'oldDuration')::integer,
      household_notes = v_op.parameters ->> 'oldNotes' where id = v_bill.booking_id;
  end if;
  if p_outcome = 'succeeded' and v_op.operation_type in ('charge', 'extras')
    and exists (select 1 from jsonb_array_elements(p_results) result
      where result ->> 'type' = 'charge' and result ->> 'status' = 'succeeded') then
    v_gate := public.visit_charge_gate(v_booking.id, v_op.id, v_op.operation_type);
  end if;
  v_grace_until := v_bill.late_payment_grace_until;
  -- Start at most one window for this assignment. Retries never extend it.
  if p_outcome = 'failed' and v_op.operation_type = 'charge'
    and v_booking.provider_id is not null and v_bill.assigned_at is not null
    and v_bill.assigned_at >= v_booking.scheduled_at - interval '24 hours'
    and v_bill.late_payment_grace_assignment_at is distinct from v_bill.assigned_at
    and not v_bill.deadline_missed
  then
    v_new_grace := true;
    v_grace_until := public.late_acceptance_card_update_deadline(v_booking.scheduled_at, now());
  end if;
  update public.booking_visit_money_operations
  set status = case when p_outcome = 'blocked' then 'failed' else p_outcome end,
    stripe_objects = p_results,
    lease_until = null, completed_at = now(), error = p_error where id = p_operation;
  update public.booking_visit_billing set active_operation_id = null,
    late_payment_grace_until = v_grace_until,
    late_payment_grace_assignment_at = case when v_new_grace then v_bill.assigned_at
      else late_payment_grace_assignment_at end,
    policy_refund_required = case
      when v_op.operation_type = 'policy_refund' and p_outcome = 'succeeded' then false
      when v_gate is not null and not (v_gate ->> 'allowed')::boolean then true
      else policy_refund_required end,
    blocked_charge_operation = case
      when v_op.operation_type = 'policy_refund' and p_outcome = 'succeeded' then null
      when v_gate is not null and not (v_gate ->> 'allowed')::boolean then v_op.id
      else blocked_charge_operation end,
    status = case
      when p_outcome = 'blocked' then
        case when v_booking.status::text = 'cancelled' then 'cancelled'
          when v_op.operation_type = 'extras' then v_op.parameters ->> 'oldStatus'
          else 'unpaid' end
      when v_gate is not null and not (v_gate ->> 'allowed')::boolean then 'review'
      when v_op.operation_type = 'policy_refund' then
        case when v_booking.status::text = 'cancelled' then 'cancelled' else 'unpaid' end
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
    attempts = attempts + case when v_op.operation_type = 'charge' and p_outcome <> 'blocked' then 1 else 0 end,
    retry_after = case when p_outcome = 'failed' and v_op.operation_type = 'charge' then case when v_grace_until > now() then least(now() + interval '15 minutes', v_grace_until)
        else now() + interval '6 hours' end else null end,
    last_error = p_error, updated_at = now() where booking_id = v_bill.booking_id;
  if v_op.operation_type in ('cancel', 'unfilled', 'late_refund') then
    if v_op.operation_type = 'unfilled' then
      perform public.queue_visit_matching_notice(
        v_bill.booking_id, v_bill.customer_id, 'unmatched_cancelled',
        'unmatched:' || v_bill.booking_id, 'We couldn''t match your booking',
        case when jsonb_array_length(coalesce(v_op.parameters -> 'refunds', '[]'::jsonb)) > 0
          then 'No cleaner accepted this visit by the two-hour deadline, so it has been cancelled. Your payment for this visit has been refunded in full.'
          else 'No cleaner accepted this visit by the two-hour deadline, so it has been cancelled. No payment was taken for this visit.' end,
        '/account/visit/' || v_bill.booking_id
      );
    else
    insert into public.notifications (user_id, title, body, href) values (
      v_bill.customer_id,
      case when v_op.operation_type = 'unfilled' then 'We couldn''t match your booking' else 'Visit cancelled' end,
      case when v_op.operation_type = 'unfilled' then 'No cleaner accepted this visit. Any payment for it has been refunded in full.'
        when v_op.parameters ->> 'actor' is null then
          case when v_bill.late_payment_grace_until is not null
            then 'The card-update window ended without payment, so this visit has been cancelled. Please update your saved card before booking again.'
            else 'This visit was still unpaid 24 hours before its start and has been cancelled. Please update your saved card.' end
        else 'Your visit has been cancelled and its payment adjustment has been confirmed.' end,
      '/account/visit/' || v_bill.booking_id::text);
    end if;
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
      'Update your saved card',
      case when v_grace_until > now() then
        'Your visit payment failed. Update your saved card in Payments before '
        || to_char(v_grace_until at time zone 'Europe/London', 'DD Mon YYYY, HH24:MI')
        || ' (London time). We will retry within this card-update window; if still unpaid at its end, the visit will be cancelled.'
      when v_grace_until is not null then
        'Your visit payment failed too close to the visit for a card-update window. This visit will be cancelled.'
      else 'Your visit payment failed. Update your saved card in Payments. We will retry; if still unpaid 24 hours before the visit, it will be cancelled.' end,
      '/account/settings/payments');
  end if;
end;
$function$;

alter table public.visit_matching_notices add column scheduled_at timestamptz;
update public.visit_matching_notices notice set scheduled_at = booking.scheduled_at
from public.bookings booking where booking.id = notice.booking_id;
alter table public.visit_matching_notices alter column scheduled_at set not null;

create or replace function public.queue_visit_matching_notice(
  p_booking uuid, p_user uuid, p_kind text, p_key text,
  p_title text, p_body text, p_href text
)
returns void
language plpgsql security definer set search_path = public
as $function$
declare
  v_series uuid;
  v_id uuid;
  v_channel text;
  v_generation integer := 0;
  v_scheduled timestamptz;
  v_channels text[] := array['in_app', 'email'];
begin
  select regular_series_id, scheduled_at into v_series, v_scheduled
  from public.bookings where id = p_booking;
  if v_series is not null then
    select pause_generation into v_generation from public.regular_booking_series where id = v_series;
  end if;
  if p_kind = 'unmatched_cancelled' and exists (
    select 1 from public.account_profile_details
    where user_id = p_user and contact_sms
  ) then
    v_channels := array_append(v_channels, 'sms');
  end if;
  foreach v_channel in array v_channels loop
    v_id := null;
    insert into public.visit_matching_notices (
      booking_id, scheduled_at, series_id, series_generation, user_id, event_key, kind, channel,
      title, body, href, expires_at
    ) values (
      p_booking, v_scheduled, v_series, v_generation, p_user, p_key, p_kind, v_channel,
      p_title, p_body, p_href,
      now() + case when v_channel = 'sms' then interval '24 hours' else interval '7 days' end
    ) on conflict (user_id, event_key, channel) do nothing
    returning id into v_id;
    if v_id is not null and v_channel = 'in_app' then
      insert into public.notifications (user_id, title, body, href)
      values (p_user, p_title, p_body, p_href);
      update public.visit_matching_notices
      set status = 'sent', sent_at = now() where id = v_id;
    end if;
  end loop;
end;
$function$;

create or replace function public.queue_due_visit_matching_notices()
returns void
language plpgsql security definer set search_path = public
as $function$
declare
  v_candidate record;
  v_booking record;
  v_admin uuid;
  v_key text;
  v_time text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  for v_candidate in
    select booking.*, coalesce(series.pause_generation, 0) as generation
    from public.bookings booking
    join public.booking_visit_billing bill on bill.booking_id = booking.id
    left join public.regular_booking_series series on series.id = booking.regular_series_id
    where booking.status::text = 'offered' and booking.provider_id is null
      and booking.scheduled_at <= now() + interval '48 hours'
      and booking.scheduled_at > now() + interval '2 hours'
      and not coalesce(series.billing_paused, false)
      and (
        not exists (select 1 from public.visit_matching_notices notice
          where notice.booking_id = booking.id and notice.kind = 'admin_48h'
            and notice.scheduled_at = booking.scheduled_at
            and notice.series_generation = coalesce(series.pause_generation, 0))
        or (booking.scheduled_at <= now() + interval '24 hours' and not exists (
          select 1 from public.visit_matching_notices notice
          where notice.booking_id = booking.id and notice.kind = 'customer_24h'
            and notice.scheduled_at = booking.scheduled_at
            and notice.series_generation = coalesce(series.pause_generation, 0)
        ))
      )
    order by booking.scheduled_at limit 100
  loop
    perform public.lock_visit_series(v_candidate.id);
    -- The cursor may have been selected before acceptance or a series pause.
    -- Re-read under the same series lock used by those actions.
    select booking.*, coalesce(series.pause_generation, 0) as generation
    into v_booking
    from public.bookings booking
    left join public.regular_booking_series series on series.id = booking.regular_series_id
    where booking.id = v_candidate.id
      and booking.status::text = 'offered' and booking.provider_id is null
      and booking.scheduled_at <= now() + interval '48 hours'
      and booking.scheduled_at > now() + interval '2 hours'
      and not coalesce(series.billing_paused, false);
    if not found then continue; end if;
    v_key := v_booking.id || ':' || v_booking.scheduled_at || ':' || v_booking.generation;
    v_time := to_char(v_booking.scheduled_at at time zone 'Europe/London', 'DD Mon YYYY, HH24:MI') || ' (London time)';
    for v_admin in select id from public.profiles where role::text = 'admin' loop
      perform public.queue_visit_matching_notice(
        v_booking.id, v_admin, 'admin_48h', 'matching-48h:' || v_key,
        'Cleaner needed for an upcoming visit',
        'No cleaner is assigned for the visit on ' || v_time || '. Please review matching. Unassigned later regular visits will not be charged.',
        '/admin/bookings'
      );
    end loop;
    if v_booking.scheduled_at <= now() + interval '24 hours' then
      perform public.queue_visit_matching_notice(
        v_booking.id, v_booking.customer_id, 'customer_24h', 'matching-24h:' || v_key,
        'We''re still finding a cleaner for your visit',
        'We''re still finding a cleaner for your visit on ' || v_time || '. We will let you know when a cleaner accepts. If no cleaner accepts by two hours before the visit, we will cancel that visit and refund anything already paid for it.',
        '/account/visit/' || v_booking.id
      );
    end if;
  end loop;
end;
$function$;

create or replace function public.claim_visit_matching_notices(
  p_email_enabled boolean, p_sms_enabled boolean default false,
  p_budget_pence integer default 0, p_cost_pence integer default 0
)
returns table (
  id uuid, claim_token uuid, channel text, recipient text,
  title text, body text, href text, kind text, booking_id uuid, scheduled_at timestamptz
)
language plpgsql security definer set search_path = public
as $function$
declare
  item record;
  v_token uuid;
  v_month date := date_trunc('month', now() at time zone 'Europe/London')::date;
  v_spent bigint := 0;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  if p_sms_enabled then
    if p_budget_pence <= 0 or p_budget_pence > 1000000
      or p_cost_pence <= 0 or p_cost_pence > p_budget_pence
    then raise exception 'SMS budget required'; end if;
    perform pg_advisory_xact_lock(hashtextextended('booking-sms-budget:' || v_month::text, 0));
    select coalesce(sum(cost), 0) into v_spent from (
      select sms_cost_cap_pence as cost from public.booking_notification_deliveries where sms_budget_month = v_month
      union all select sms_cost_cap_pence from public.visit_matching_notices where sms_budget_month = v_month
    ) spent;
  end if;
  update public.visit_matching_notices notice
  set status = 'failed', last_error = 'SMS submission uncertain; manual review required.', claim_token = null
  where notice.channel = 'sms' and notice.status = 'processing'
    and notice.claimed_at < now() - interval '10 minutes';
  update public.visit_matching_notices notice
  set status = 'failed', last_error = 'Old email submission needs provider reconciliation.', claim_token = null
  where notice.channel = 'email' and notice.status in ('pending', 'processing')
    and notice.attempts > 0 and notice.claimed_at < now() - interval '23 hours';
  update public.visit_matching_notices notice
  set status = 'cancelled', claim_token = null
  where notice.status in ('pending', 'processing') and (
    notice.expires_at <= now() or (notice.kind in ('admin_48h', 'customer_24h') and not exists (
      select 1 from public.bookings booking
      left join public.regular_booking_series series on series.id = booking.regular_series_id
      where booking.id = notice.booking_id and booking.status::text = 'offered'
        and booking.provider_id is null and booking.scheduled_at > now() + interval '2 hours'
        and not coalesce(series.billing_paused, false)
        and notice.series_generation = coalesce(series.pause_generation, 0)
    ))
  );
  for item in
    select notice.*, profile.email, profile.phone, booking.scheduled_at
    from public.visit_matching_notices notice
    join public.profiles profile on profile.id = notice.user_id
    join public.bookings booking on booking.id = notice.booking_id
    left join public.account_profile_details preferences on preferences.user_id = notice.user_id
    where notice.attempts < 8 and notice.next_attempt_at <= now()
      and profile.account_deleted_at is null
      and (notice.channel <> 'email' or profile.email !~* '@[^@]*[.]invalid$')
      and (notice.status = 'pending' or (notice.channel = 'email'
        and notice.status = 'processing' and notice.claimed_at < now() - interval '5 minutes'))
      and ((notice.channel = 'email' and p_email_enabled)
        or (notice.channel = 'sms' and p_sms_enabled and coalesce(preferences.contact_sms, false)
          and profile.phone ~ '^\+44[0-9]{10}$'))
    order by notice.created_at, notice.id limit 20 for update of notice skip locked
  loop
    if item.channel = 'sms' then
      if v_spent + p_cost_pence > p_budget_pence then continue; end if;
      v_spent := v_spent + p_cost_pence;
    end if;
    v_token := gen_random_uuid();
    update public.visit_matching_notices notice
    set status = 'processing', claimed_at = now(), claim_token = v_token,
      attempts = attempts + 1,
      sms_budget_month = case when item.channel = 'sms' then v_month else null end,
      sms_cost_cap_pence = case when item.channel = 'sms' then p_cost_pence else null end
    where notice.id = item.id;
    id := item.id; claim_token := v_token; channel := item.channel;
    recipient := case when item.channel = 'email' then item.email else item.phone end;
    title := item.title; body := item.body; href := item.href; kind := item.kind;
    booking_id := item.booking_id; scheduled_at := item.scheduled_at;
    return next;
  end loop;
end;
$function$;

create or replace function public.visit_matching_notice_allowed(p_id uuid, p_token uuid)
returns boolean
language plpgsql security definer set search_path = public
as $function$
declare v_notice public.visit_matching_notices; v_booking public.bookings; v_series public.regular_booking_series;
begin
  if auth.role() is distinct from 'service_role' then return false; end if;
  select * into v_notice from public.visit_matching_notices
  where id = p_id and claim_token = p_token and status = 'processing' and expires_at > now();
  if not found then return false; end if;
  select * into strict v_booking from public.bookings where id = v_notice.booking_id;
  if v_booking.regular_series_id is not null then
    select * into strict v_series from public.regular_booking_series where id = v_booking.regular_series_id;
  end if;
  if exists (select 1 from public.profiles where id = v_notice.user_id
    and account_deleted_at is not null) then return false; end if;
  if v_notice.kind in ('admin_48h', 'customer_24h') then
    return v_booking.status::text = 'offered' and v_booking.provider_id is null
      and v_booking.scheduled_at = v_notice.scheduled_at
      and v_booking.scheduled_at > now() + interval '2 hours'
      and v_booking.scheduled_at <= now() + case when v_notice.kind = 'customer_24h'
        then interval '24 hours' else interval '48 hours' end
      and not coalesce(v_series.billing_paused, false)
      and v_notice.series_generation = coalesce(v_series.pause_generation, 0);
  elsif v_notice.kind = 'series_paused' then
    return v_series.billing_paused and v_notice.series_generation = v_series.pause_generation;
  elsif v_notice.kind = 'series_resumed' then
    return not v_series.billing_paused and v_notice.series_generation = v_series.pause_generation;
  end if;
  return true;
end;
$function$;

commit;
notify pgrst, 'reload schema';
