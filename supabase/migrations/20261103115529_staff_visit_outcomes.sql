begin;
create table public.staff_visit_outcomes (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id),
  operation_id uuid unique references public.booking_visit_money_operations(id),
  mode text not null check(mode in ('unsafe_home','disrespect','customer_stopped','replacement_cancel')),
  actor_id uuid not null references public.profiles(id),
  reason text not null check(char_length(btrim(reason)) between 10 and 2000),
  worked_minutes integer,
  charge_pence integer not null check(charge_pence>=0),
  cleaner_pay_pence integer not null check(cleaner_pay_pence between 0 and charge_pence),
  created_at timestamptz not null default now()
);
alter table public.staff_visit_outcomes enable row level security;
revoke all on public.staff_visit_outcomes from public,anon,authenticated;
grant select on public.staff_visit_outcomes to authenticated;
grant all on public.staff_visit_outcomes to service_role;
create policy "staff and customer read recorded visit outcomes" on public.staff_visit_outcomes for select to authenticated
using(public.is_admin() or actor_id=auth.uid() or exists(select 1 from public.bookings b where b.id=booking_id and b.customer_id=auth.uid()));

-- Do not weaken the ordinary 70% guard. A separate verified staff action is
-- required, with a reason, source-funded amount and immutable operation audit.
do $patch$
declare source text; marker text;
begin
  select pg_get_functiondef('public.snapshot_cleaning_cancellation()'::regprocedure) into source;
  marker:='  if new.operation_type<>''cancel'' then return new; end if;';
  if strpos(source,marker)=0 then raise exception 'Cancellation snapshot source changed; review before release'; end if;
  source:=replace(source,marker,marker||$insert$
  if new.parameters ? 'staffOutcomeId' then
    if not exists(select 1 from public.staff_visit_outcomes o where o.id=(new.parameters->>'staffOutcomeId')::uuid
      and o.booking_id=new.booking_id and o.actor_id=(new.parameters->>'actor')::uuid and o.operation_id is null)
      then raise exception 'A recorded staff or replacement decision is required'; end if;
    return new;
  end if;
$insert$);
  execute source;
  select pg_get_functiondef('public.finish_cleaning_cancellation()'::regprocedure) into source;
  marker:='v_pay:=case when v_provider is null';
  if strpos(source,marker)=0 then raise exception 'Cancellation finalisation source changed; review before release'; end if;
  execute replace(source,marker,$insert$v_pay:=case when new.parameters ? 'staffOutcomeId' then
    least(v_retained,(select cleaner_pay_pence from public.staff_visit_outcomes where id=(new.parameters->>'staffOutcomeId')::uuid))
    when v_provider is null$insert$);
end;
$patch$;

create function public.prepare_recorded_visit_outcome(p_booking uuid,p_mode text,p_reason text,p_worked integer,p_revision integer)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare b public.bookings; bill public.booking_visit_billing; terms jsonb; o public.staff_visit_outcomes;
  op public.booking_visit_money_operations; c public.booking_visit_charges; line jsonb; refs jsonb:='[]'; refunded jsonb;
  cleaning integer:=0; minutes integer:=0; total integer:=0; target integer; pay integer; retained integer:=0;
  available integer; keep integer; refund integer; line_refund integer; accumulated integer:=0; allocated integer:=0;
  arrived timestamptz; normal_pay integer; percent integer; rate integer;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_mode not in ('unsafe_home','disrespect','customer_stopped','replacement_cancel') then raise exception 'Choose a recorded outcome'; end if;
  perform public.lock_visit_series(p_booking);
  select * into strict b from public.bookings where id=p_booking for update;
  select * into strict bill from public.booking_visit_billing where booking_id=p_booking for update;
  if p_mode='replacement_cancel' then
    if b.customer_id is distinct from auth.uid() or not exists(select 1 from public.booking_replacement_options where booking_id=p_booking)
      then raise exception 'Free replacement cancellation is not available for this visit' using errcode='insufficient_privilege'; end if;
    p_reason:='Customer chose free cancellation after their cleaner could not attend';
  elsif not public.is_admin() then raise exception 'Authenticator staff access required' using errcode='insufficient_privilege'; end if;
  select * into o from public.staff_visit_outcomes where booking_id=p_booking;
  if found then
    if o.mode<>p_mode then raise exception 'This visit already has a different recorded outcome'; end if;
    select * into strict op from public.booking_visit_money_operations where id=o.operation_id;
    return to_jsonb(op);
  end if;
  if p_mode='replacement_cancel' and (b.status::text not in ('offered','declined','scheduled') or b.scheduled_at<=now())
    then raise exception 'Free replacement cancellation is available only before this visit starts'; end if;
  if p_revision is null or bill.active_operation_id is not null or bill.revision<>p_revision or bill.status='review' or bill.policy_refund_required
    or b.status::text in ('completed','cancelled') or exists(select 1 from public.payouts where booking_id=p_booking and status::text in ('processing','paid'))
    then raise exception 'Refresh the visit; a payment or payout needs review before this decision'; end if;
  if char_length(btrim(coalesce(p_reason,''))) not between 10 and 2000 then raise exception 'A clear staff reason is required'; end if;
  select t.terms into strict terms from public.booking_cleaning_billing_terms t where booking_id=p_booking;
  if p_mode in ('unsafe_home','disrespect') and (terms->>'cancellationBasis' is distinct from 'booking_total' or b.provider_id is null or b.scheduled_at>now()) then
    raise exception 'This exception requires the final accepted unsafe-home terms and an assigned visit that has reached its start'; end if;
  if p_mode='customer_stopped' then
    select min(arrived_at) into arrived from public.check_ins where booking_id=p_booking;
    if b.status::text<>'in_progress' or arrived is null or p_worked is null or p_worked<0
      or p_worked>floor(extract(epoch from (now()-arrived))/60) then raise exception 'Record only verified time actually worked on an in-progress visit'; end if;
  end if;
  for c in select * from public.booking_visit_charges where booking_id=p_booking order by created_at,id for update loop
    if exists(select 1 from public.payments where id=c.payment_id and status not in ('succeeded','partially_refunded','refunded')) then raise exception 'Payment is not settled'; end if;
    total:=total+c.amount_pence-c.refunded_pence;
    for line in select value from jsonb_array_elements(c.line_items) loop
      if line->>'id'='cleaning' then
        cleaning:=cleaning+(line->>'amountPence')::integer-coalesce((c.refunded_lines->>'cleaning')::integer,0);
        minutes:=minutes+coalesce((line->>'reservedMinutes')::integer,0);
      end if;
      if line->>'id'='tip' then raise exception 'Tips must be reviewed separately'; end if;
    end loop;
  end loop;
  rate:=public.effective_booking_cleaner_hourly_pence(p_booking);
  if rate is null or rate<1 then raise exception 'The agreed cleaner pay is unavailable'; end if;
  normal_pay:=round(minutes*rate::numeric/60);
  if p_mode='customer_stopped' then
    if p_worked>minutes or minutes=0 then raise exception 'Worked time exceeds the paid cleaning time'; end if;
    target:=round(cleaning::numeric*p_worked/minutes);
    pay:=least(target,round(p_worked*rate::numeric/60));
    percent:=ceil(100.0*p_worked/minutes);
  elsif p_mode='replacement_cancel' then target:=0; pay:=0; percent:=0;
  else target:=total; pay:=least(cleaning,normal_pay); percent:=100; end if;
  for c in select * from public.booking_visit_charges where booking_id=p_booking order by created_at,id loop
    refunded:=c.refunded_lines; refund:=0;
    for line in select value from jsonb_array_elements(c.line_items) loop
      available:=(line->>'amountPence')::integer-coalesce((c.refunded_lines->>(line->>'id'))::integer,0);
      if available<0 then raise exception 'Refund source needs reconciliation'; end if;
      if p_mode in ('unsafe_home','disrespect') then keep:=available;
      elsif p_mode='customer_stopped' and line->>'id'='cleaning' then
        accumulated:=accumulated+available;
        keep:=round(accumulated::numeric*target/cleaning)-allocated; allocated:=allocated+keep;
      else keep:=0; end if;
      line_refund:=available-keep; retained:=retained+keep; refund:=refund+line_refund;
      refunded:=jsonb_set(refunded,array[line->>'id'],to_jsonb(coalesce((refunded->>(line->>'id'))::integer,0)+line_refund));
    end loop;
    if refund>0 then refs:=refs||jsonb_build_array(jsonb_build_object('chargeId',c.id,'intentId',c.stripe_payment_intent,'amountPence',refund,'refundedLines',refunded)); end if;
  end loop;
  if retained<>target or retained>total then raise exception 'Outcome allocation does not match settled funds'; end if;
  insert into public.staff_visit_outcomes(booking_id,mode,actor_id,reason,worked_minutes,charge_pence,cleaner_pay_pence)
  values(p_booking,p_mode,auth.uid(),btrim(p_reason),case when p_mode='customer_stopped' then p_worked end,target,pay) returning * into o;
  insert into public.booking_visit_money_operations(booking_id,customer_id,operation_type,revision,idempotency_key,parameters)
  values(p_booking,b.customer_id,'cancel',bill.revision,'visit-outcome:'||o.id,
    jsonb_build_object('oldStatus',bill.status,'actor',auth.uid(),'scheduledAt',b.scheduled_at,'assignedProvider',b.provider_id,
      'staffOutcomeId',o.id,'refundPercent',100-percent,'refunds',refs,
      'launchCancellation',jsonb_build_object('cleaningPence',case when p_mode in ('unsafe_home','disrespect') then total else cleaning end,
        'normalCleanerPayPence',normal_pay,'chargePercent',percent,'providerId',b.provider_id))) returning * into op;
  update public.staff_visit_outcomes set operation_id=op.id where id=o.id;
  update public.booking_visit_billing set active_operation_id=op.id,status='cancelling',updated_at=now() where booking_id=p_booking;
  perform set_config('opulence.visit_billing_operation',op.id::text,true);
  perform public._apply_booking_transition(p_booking,'cancelled',auth.uid(),case when p_mode='replacement_cancel' then 'customer' else 'admin' end,
    p_reason,jsonb_build_object('visit_money_operation',op.id,'recorded_outcome',p_mode,'worked_minutes',p_worked,'retained_pence',target));
  update public.booking_offers set status='expired' where booking_id=p_booking and status='open';
  if p_mode='replacement_cancel' then update public.booking_replacement_options set cancelled_operation_id=op.id where booking_id=p_booking; end if;
  return to_jsonb(op);
end;
$fn$;
revoke all on function public.prepare_recorded_visit_outcome(uuid,text,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.prepare_recorded_visit_outcome(uuid,text,text,integer,integer) to authenticated;
commit;
