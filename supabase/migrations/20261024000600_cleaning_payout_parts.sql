begin;
alter table public.cleaning_payout_parts add column operation_key text not null;
alter table public.cleaning_payout_parts add column destination_account text;

-- Serialise payout planning with refunds/waivers. The application verifies
-- Stripe's captured sources too; no unconfirmed/ambiguous funds are released.
create or replace function public.prepare_cleaning_payout(p_booking uuid,p_parts jsonb)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare v_booking public.bookings; v_bill public.booking_visit_billing; v_payout public.payouts;
  v_cancel public.cleaning_cancellation_settlements; v_part jsonb; v_charge public.booking_visit_charges;
  v_expected integer; v_total integer:=0; v_terms jsonb; v_key text; v_pending boolean;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  perform public.lock_visit_series(p_booking);
  select * into strict v_booking from public.bookings where id=p_booking for update;
  select * into strict v_bill from public.booking_visit_billing where booking_id=p_booking for update;
  select terms into v_terms from public.booking_cleaning_billing_terms where booking_id=p_booking;
  if v_terms->>'cancellationBasis' is distinct from 'cleaning_hours' or v_booking.provider_id is null
    or v_bill.active_operation_id is not null or v_booking.subscription_id is not null then raise exception 'Visit is not ready for a cleaning payout'; end if;
  if v_booking.status::text='cancelled' then
    select * into strict v_cancel from public.cleaning_cancellation_settlements where booking_id=p_booking for update;
    if v_cancel.provider_id is distinct from v_booking.provider_id then raise exception 'Cancellation provider changed'; end if;
    v_expected:=v_cancel.cleaner_pay_pence;
  elsif v_booking.status::text='completed' and v_bill.status='paid' then
    select round(coalesce(sum((p.split_breakdown->>'provider')::numeric),0)*100) into v_expected
      from public.payments p where booking_id=p_booking and coalesce(kind,'')<>'tip' and status in ('succeeded','partially_refunded');
  else raise exception 'Only settled completed/cancelled cleaning visits can be paid'; end if;
  if jsonb_typeof(p_parts)<>'array' then raise exception 'Invalid payout parts'; end if;
  if (select count(*) from jsonb_array_elements(p_parts))<>(select count(distinct part->>'chargeId') from jsonb_array_elements(p_parts) part) then
    raise exception 'Duplicate payout source';
  end if;
  for v_part in select value from jsonb_array_elements(p_parts) loop
    select * into strict v_charge from public.booking_visit_charges where id=(v_part->>'chargeId')::uuid and booking_id=p_booking;
    if v_part->>'intentId' is distinct from v_charge.stripe_payment_intent
      or (v_part->>'amountPence')::integer<=0 or (v_part->>'amountPence')::integer>v_charge.amount_pence-v_charge.refunded_pence
      or not exists(select 1 from public.payments where id=v_charge.payment_id and status in ('succeeded','partially_refunded')) then
      raise exception 'Payout source is not settled'; end if;
    v_total:=v_total+(v_part->>'amountPence')::integer;
  end loop;
  if v_total is distinct from v_expected then raise exception 'Payout total differs from the agreed allocation'; end if;
  if v_total=0 then
    update public.cleaning_cancellation_settlements set payout_settled_at=now() where booking_id=p_booking;
    return jsonb_build_object('ready',false,'settled',true,'amountPence',0);
  end if;
  select * into v_payout from public.payouts where booking_id=p_booking and payment_id is null order by created_at limit 1 for update;
  if not found then
    insert into public.payouts(booking_id,provider_id,amount,status) values(p_booking,v_booking.provider_id,v_total/100.0,'not_ready') returning * into v_payout;
  end if;
  if v_payout.provider_id is distinct from v_booking.provider_id then raise exception 'Payout provider differs from the assigned cleaner'; end if;
  if v_payout.stripe_transfer_ref is not null and not exists(select 1 from public.cleaning_payout_parts where payout_id=v_payout.id) then
    raise exception 'An earlier transfer needs reconciliation; do not transfer again'; end if;
  if exists(select 1 from public.review_cases where booking_id=p_booking and status<>'resolved' and (blocks_payment or blocks_payout)) then
    if v_payout.status in ('not_ready','pending','failed') then
      perform public._apply_payout_transition(v_payout.id,'held',null,'system','An open review case blocks this payout','{}');
    end if;
    return jsonb_build_object('ready',false,'settled',false,'amountPence',v_total);
  end if;
  for v_part in select value from jsonb_array_elements(p_parts) loop
    v_key:='transfer:cleaning:'||p_booking||':'||(v_part->>'chargeId')||':provider:'||v_booking.provider_id||':r'||coalesce(v_cancel.revision,0);
    insert into public.cleaning_payout_parts(charge_id,booking_id,provider_id,payout_id,amount_pence,operation_key)
    values((v_part->>'chargeId')::uuid,p_booking,v_booking.provider_id,v_payout.id,(v_part->>'amountPence')::integer,v_key)
    on conflict(charge_id) do update set amount_pence=excluded.amount_pence,operation_key=excluded.operation_key
      where cleaning_payout_parts.transfer_ref is null;
    if exists(select 1 from public.cleaning_payout_parts where charge_id=(v_part->>'chargeId')::uuid
      and (amount_pence-reversed_pence<>(v_part->>'amountPence')::integer or provider_id<>v_booking.provider_id)) then
      raise exception 'The existing source transfer needs reconciliation'; end if;
  end loop;
  update public.payouts set amount=v_total/100.0 where id=v_payout.id;
  if v_payout.status in ('not_ready','held') then
    perform public._apply_payout_transition(v_payout.id,'pending',null,'system','Settled cleaning funds and no blocking review','{}');
  end if;
  if v_payout.status<>'paid' and v_payout.status<>'processing' then
    perform public._apply_payout_transition(v_payout.id,'processing',null,'system','Cleaning source transfers claimed','{}');
  end if;
  return jsonb_build_object('ready',true,'payoutId',v_payout.id,'amountPence',v_total,
    'parts',(select coalesce(jsonb_agg(to_jsonb(part)),'[]') from public.cleaning_payout_parts part where part.payout_id=v_payout.id and part.amount_pence>part.reversed_pence));
end
$fn$;
revoke all on function public.prepare_cleaning_payout(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.prepare_cleaning_payout(uuid,jsonb) to service_role;
commit;
