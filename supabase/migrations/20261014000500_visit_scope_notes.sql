-- Keep the professional checklist aligned with the revised structured scope.
begin;

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
      duration_minutes = v_duration,
      household_notes = btrim(replace(coalesce(v_booking.household_notes, ''),
        coalesce(v_booking.cleaning_extras ->> 'notes', ''), ''))
        || E'\n' || coalesce(p_parameters -> 'scope' ->> 'notes', '')
      where id = p_booking;
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

commit;
notify pgrst, 'reload schema';
