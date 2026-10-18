begin;

-- Never turn a refunded extra into a second charge for an already paid base visit.
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
  v_blocked_type text;
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
  select operation_type into v_blocked_type from public.booking_visit_money_operations
  where id = v_bill.blocked_charge_operation;
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
        case when v_booking.status::text = 'cancelled' then 'cancelled'
          when v_blocked_type = 'extras' then 'review' else 'unpaid' end
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
  if v_op.operation_type = 'policy_refund' and p_outcome = 'succeeded' then
    perform public.queue_visit_matching_notice(
      v_bill.booking_id, v_bill.customer_id, 'payment_reconciled',
      'blocked-payment-refunded:' || p_operation,
      'A delayed payment has been refunded',
      case when v_blocked_type = 'extras' then
        'An add-on payment arrived after matching changed and has been refunded. Your earlier payment is still recorded. Our team will review the visit before any further payment is taken.'
      else 'A delayed payment arrived after this visit was paused, closed or unassigned. That payment has been refunded in full. This does not resume your visits.' end,
      '/account/visit/' || v_bill.booking_id
    );
    if v_blocked_type = 'extras' then
      perform public.queue_visit_matching_notice(
        v_bill.booking_id, reviewer.id, 'payment_reconciled', 'blocked-extras-review:' || p_operation,
        'Add-on payment reconciliation needs review',
        'A captured add-on charge has been refunded after matching changed. Existing payments are recorded; automatic billing is blocked for this visit until its scope and paid balance are reviewed.',
        '/admin/bookings'
      ) from public.profiles reviewer where reviewer.role::text = 'admin' and reviewer.account_deleted_at is null;
    end if;
  end if;
end;
$function$;

create or replace function public.guard_paused_series_assignment()
returns trigger
language plpgsql security definer set search_path = public
as $function$
begin
  if new.regular_series_id is not null and new.provider_id is not null
    and (new.provider_id is distinct from old.provider_id
      or (new.status::text in ('scheduled', 'in_progress') and new.status is distinct from old.status))
    and exists (select 1 from public.regular_booking_series
      where id = new.regular_series_id and billing_paused)
  then raise exception 'This regular series is paused. The customer or admin must resume it first.'; end if;
  return new;
end;
$function$;

commit;
notify pgrst, 'reload schema';
