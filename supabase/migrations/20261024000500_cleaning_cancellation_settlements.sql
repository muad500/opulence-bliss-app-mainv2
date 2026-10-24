begin;

create table public.cleaning_cancellation_settlements (
  booking_id uuid primary key references public.bookings(id),
  provider_id uuid references public.providers(id),
  operation_id uuid not null unique references public.booking_visit_money_operations(id),
  cleaning_pence integer not null check(cleaning_pence>=0),
  normal_cleaner_pay_pence integer not null check(normal_cleaner_pay_pence>=0),
  charge_percent integer not null check(charge_percent between 0 and 70),
  charge_pence integer not null check(charge_pence>=0),
  cleaner_pay_pence integer not null check(cleaner_pay_pence>=0 and cleaner_pay_pence<=charge_pence),
  waived_pence integer not null default 0 check(waived_pence>=0),
  revision integer not null default 0,
  payout_settled_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.cleaning_payout_parts (
  charge_id uuid primary key references public.booking_visit_charges(id),
  booking_id uuid not null references public.bookings(id),
  provider_id uuid not null references public.providers(id),
  payout_id uuid not null references public.payouts(id),
  amount_pence integer not null check(amount_pence>0),
  transfer_ref text unique,
  reversed_pence integer not null default 0 check(reversed_pence between 0 and amount_pence),
  created_at timestamptz not null default now()
);
alter table public.cleaning_cancellation_settlements enable row level security;
alter table public.cleaning_payout_parts enable row level security;
revoke all on public.cleaning_cancellation_settlements,public.cleaning_payout_parts from public,anon,authenticated;
grant select on public.cleaning_cancellation_settlements,public.cleaning_payout_parts to authenticated;
grant all on public.cleaning_cancellation_settlements,public.cleaning_payout_parts to service_role;
create policy "staff and assigned cleaner read cancellation compensation" on public.cleaning_cancellation_settlements
for select to authenticated using(public.is_admin() or provider_id=public.current_provider_id());
create policy "staff and assigned cleaner read payout parts" on public.cleaning_payout_parts
for select to authenticated using(public.is_admin() or provider_id=public.current_provider_id());

-- Derive the compensation basis from locked database facts before any refund
-- occurs. An application cannot supply its own cleaner rate or retain extras.
create or replace function public.snapshot_cleaning_cancellation()
returns trigger language plpgsql security definer set search_path=public as $fn$
declare v_terms jsonb; v_booking public.bookings; v_bill public.booking_visit_billing;
  v_cleaning integer; v_normal integer; v_percent integer; v_cap integer; v_refunds jsonb;
begin
  if new.operation_type<>'cancel' then return new; end if;
  select terms into v_terms from public.booking_cleaning_billing_terms where booking_id=new.booking_id;
  if v_terms->>'cancellationBasis' is distinct from 'cleaning_hours' then return new; end if;
  select * into strict v_booking from public.bookings where id=new.booking_id;
  select * into strict v_bill from public.booking_visit_billing where booking_id=new.booking_id;
  v_refunds:=v_terms->'cancellationRefundPercent';
  v_cap:=100-case
    when new.parameters->>'actor' is not null and not coalesce((new.parameters->>'noAccess')::boolean,false)
      and public.cleaning_statutory_cancellation_free(new.booking_id) then 100
    when v_booking.scheduled_at<=now() or (v_booking.scheduled_at at time zone 'Europe/London')::date=(now() at time zone 'Europe/London')::date then (v_refunds->>'none')::integer
    when v_booking.scheduled_at>=now()+interval '48 hours' then (v_refunds->>'full')::integer
    when v_booking.scheduled_at>=now()+interval '24 hours' then (v_refunds->>'three_quarter')::integer
    when v_booking.scheduled_at>=now()+interval '12 hours' then (v_refunds->>'half')::integer
    else (v_refunds->>'none')::integer end;
  v_percent:=100-(new.parameters->>'refundPercent')::integer;
  if new.parameters ? 'staffActor' then
    if not exists(select 1 from public.profiles where id=(new.parameters->>'staffActor')::uuid and role::text='admin' and account_deleted_at is null)
      or v_percent<0 or v_percent>least(v_cap,70) then raise exception 'Invalid staff cancellation reduction'; end if;
    if coalesce((new.parameters->>'noAccess')::boolean,false) and (
      now()<v_booking.scheduled_at+interval '15 minutes' or not exists(
        select 1 from public.review_cases where booking_id=new.booking_id and category='client_unavailable' and status<>'resolved'
      )
    ) then raise exception 'No access needs a report and a 15 minute wait'; end if;
  elsif new.parameters->>'actor' is not null and (v_percent<>v_cap or v_percent>70) then
    raise exception 'Cancellation charge exceeds the agreed band';
  end if;
  select coalesce(sum((line->>'amountPence')::integer-coalesce((c.refunded_lines->>'cleaning')::integer,0)),0)
    into v_cleaning from public.booking_visit_charges c cross join lateral jsonb_array_elements(c.line_items) line
    where c.booking_id=new.booking_id and line->>'id'='cleaning';
  select round(coalesce(sum((line->>'reservedMinutes')::integer),0)*(v_terms->>'cleanerHourlyPence')::numeric/60)
    into v_normal from jsonb_array_elements(v_bill.line_items) line where line->>'id'='cleaning';
  new.parameters:=new.parameters || jsonb_build_object('launchCancellation',jsonb_build_object(
    'cleaningPence',v_cleaning,'normalCleanerPayPence',v_normal,'chargePercent',least(v_percent,70),
    'providerId',v_booking.provider_id));
  return new;
end
$fn$;
revoke all on function public.snapshot_cleaning_cancellation() from public,anon,authenticated;
create trigger snapshot_cleaning_cancellation before insert on public.booking_visit_money_operations
for each row execute function public.snapshot_cleaning_cancellation();

-- Refunds and settlement changes become visible in the SAME commit. Ambiguous
-- Stripe results cannot release compensation or apply a waiver twice.
create or replace function public.finish_cleaning_cancellation()
returns trigger language plpgsql security definer set search_path=public as $fn$
declare v_data jsonb; v_retained integer; v_provider uuid; v_pay integer; v_part jsonb;
begin
  if new.status<>'succeeded' or old.status='succeeded' then return new; end if;
  v_data:=new.parameters->'launchCancellation';
  if new.operation_type='cancel' and v_data is not null then
    select coalesce(sum((line->>'amountPence')::integer-coalesce((c.refunded_lines->>'cleaning')::integer,0)),0)
      into v_retained from public.booking_visit_charges c cross join lateral jsonb_array_elements(c.line_items) line
      where c.booking_id=new.booking_id and line->>'id'='cleaning';
    v_provider:=(v_data->>'providerId')::uuid;
    v_pay:=case when v_provider is null or new.parameters->>'actor' is null then 0 else
      least(v_retained,round((v_data->>'normalCleanerPayPence')::numeric*(v_data->>'chargePercent')::numeric/100)) end;
    insert into public.cleaning_cancellation_settlements(booking_id,provider_id,operation_id,cleaning_pence,normal_cleaner_pay_pence,charge_percent,charge_pence,cleaner_pay_pence,payout_settled_at)
    values(new.booking_id,v_provider,new.id,(v_data->>'cleaningPence')::integer,(v_data->>'normalCleanerPayPence')::integer,
      (v_data->>'chargePercent')::integer,v_retained,v_pay,case when v_pay=0 then now() else null end) on conflict(booking_id) do nothing;
  elsif new.operation_type='cancellation_adjustment' then
    v_data:=new.parameters->'nextSettlement';
    update public.cleaning_cancellation_settlements set
      charge_percent=(v_data->>'chargePercent')::integer,charge_pence=(v_data->>'chargePence')::integer,
      cleaner_pay_pence=(v_data->>'cleanerPayPence')::integer,waived_pence=(v_data->>'waivedPence')::integer,
      revision=revision+1,payout_settled_at=case when (v_data->>'cleanerPayPence')::integer=0 then now() else null end,updated_at=now() where booking_id=new.booking_id;
    for v_part in select value from jsonb_array_elements(coalesce(new.parameters->'reversals','[]'::jsonb)) loop
      update public.cleaning_payout_parts set reversed_pence=reversed_pence+(v_part->>'amountPence')::integer
        where charge_id=(v_part->>'chargeId')::uuid;
    end loop;
    -- The original amount and every reversal remain in the operation audit.
    update public.payouts set amount=(v_data->>'cleanerPayPence')::integer/100.0
      where booking_id=new.booking_id and payment_id is null;
    if (v_data->>'cleanerPayPence')::integer=0 then
      perform public._apply_payout_transition(id,'reversed',null,'system','Cleaner compensation fully waived/refunded',jsonb_build_object('visit_money_operation',new.id))
        from public.payouts where booking_id=new.booking_id and payment_id is null and status='paid';
    end if;
    insert into public.booking_events(booking_id,to_status,actor_id,actor_kind,reason,meta)
      values(new.booking_id,'cancelled',(new.parameters->>'requestedBy')::uuid,
        new.parameters->>'actorKind','Cancellation charge reduced / cleaner compensation waived',
        jsonb_build_object('visit_money_operation',new.id,'refund_pence',new.parameters->'refundPence'));
    insert into public.notifications(user_id,title,body,href)
      select customer_id,'Cancellation refund increased','A cancellation adjustment has been refunded to your original payment method.','/account/visit/'||new.booking_id
      from public.bookings where id=new.booking_id;
  end if;
  return new;
end
$fn$;
revoke all on function public.finish_cleaning_cancellation() from public,anon,authenticated;
create trigger finish_cleaning_cancellation after update of status on public.booking_visit_money_operations
for each row execute function public.finish_cleaning_cancellation();

alter table public.booking_visit_money_operations drop constraint booking_visit_money_operations_operation_type_check;
alter table public.booking_visit_money_operations add constraint booking_visit_money_operations_operation_type_check
check(operation_type in ('charge','extras','cancel','unfilled','late_refund','policy_refund','cancellation_adjustment'));

create or replace function public.prepare_cleaning_cancellation_adjustment(p_booking uuid,p_action text,p_value integer,p_revision integer)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare v_uid uuid:=auth.uid(); v_row public.cleaning_cancellation_settlements; v_bill public.booking_visit_billing;
  v_operation public.booking_visit_money_operations; v_charge public.booking_visit_charges; v_part public.cleaning_payout_parts;
  v_percent integer; v_waived integer; v_charge_total integer; v_pay integer; v_delta integer; v_left integer;
  v_amount integer; v_lines jsonb; v_refunds jsonb:='[]'; v_reversals jsonb:='[]'; v_kind text;
begin
  perform public.lock_visit_series(p_booking);
  perform 1 from public.bookings where id=p_booking for update;
  select * into strict v_bill from public.booking_visit_billing where booking_id=p_booking for update;
  select * into strict v_row from public.cleaning_cancellation_settlements where booking_id=p_booking for update;
  if public.is_admin() and p_action='reduce_charge' then v_kind:='admin';
  elsif v_row.provider_id=public.current_provider_id() and p_action='waive' then v_kind:='provider';
  else raise exception 'Not authorised for this cancellation adjustment' using errcode='insufficient_privilege'; end if;
  if v_row.revision<>p_revision or v_bill.active_operation_id is not null then raise exception 'A payment change is in progress or the record changed. Refresh first.'; end if;
  if exists(select 1 from public.payouts where booking_id=p_booking and payment_id is null and status='processing') then
    raise exception 'The cleaner transfer is in progress. Retry when it is confirmed.';
  end if;
  if exists(select 1 from public.money_operations where booking_id=p_booking
    and operation_key like 'transfer:cleaning:'||p_booking::text||':%' and status in ('processing','ambiguous')) then
    raise exception 'A cleaner transfer needs reconciliation before this refund';
  end if;
  v_percent:=v_row.charge_percent; v_waived:=v_row.waived_pence;
  if p_value is null or p_value<0 then raise exception 'Invalid reduction'; end if;
  if p_action='reduce_charge' then
    if p_value>=v_percent then raise exception 'Staff can only reduce the current cancellation percentage'; end if;
    v_percent:=p_value;
    v_charge_total:=greatest(0,round(v_row.cleaning_pence*v_percent/100.0)-v_waived);
    v_pay:=greatest(0,least(v_charge_total,round(v_row.normal_cleaner_pay_pence*v_percent/100.0)-v_waived));
  else
    if p_value=0 or p_value>v_row.cleaner_pay_pence then raise exception 'Choose an amount up to your remaining compensation'; end if;
    v_waived:=v_waived+p_value; v_charge_total:=v_row.charge_pence-p_value; v_pay:=v_row.cleaner_pay_pence-p_value;
  end if;
  v_delta:=v_row.charge_pence-v_charge_total; v_left:=v_delta;
  if v_delta<=0 then raise exception 'There is no additional refund'; end if;
  -- Modern per-visit bookings have one immutable cleaning-hours source charge.
  -- Do not guess at allocation for an imported multi-base record.
  if (select count(*) from public.booking_visit_charges c where c.booking_id=p_booking and c.line_items @> '[{"id":"cleaning"}]')<>1 then
    raise exception 'This imported payment needs line-item reconciliation before an adjustment';
  end if;
  for v_charge in select * from public.booking_visit_charges where booking_id=p_booking order by created_at for update loop
    select coalesce(sum((line->>'amountPence')::integer),0)-coalesce((v_charge.refunded_lines->>'cleaning')::integer,0)
      into v_amount from jsonb_array_elements(v_charge.line_items) line where line->>'id'='cleaning';
    v_amount:=least(v_left,greatest(0,v_amount));
    if v_amount=0 then continue; end if;
    v_lines:=v_charge.refunded_lines||jsonb_build_object('cleaning',coalesce((v_charge.refunded_lines->>'cleaning')::integer,0)+v_amount);
    v_refunds:=v_refunds||jsonb_build_array(jsonb_build_object('chargeId',v_charge.id,'intentId',v_charge.stripe_payment_intent,'amountPence',v_amount,'refundedLines',v_lines));
    v_left:=v_left-v_amount;
  end loop;
  if v_left<>0 then raise exception 'The remaining cleaning charge cannot fund this refund'; end if;
  select * into v_part from public.cleaning_payout_parts where booking_id=p_booking and transfer_ref is not null for update;
  if found and v_part.amount_pence-v_part.reversed_pence>v_pay then
    v_reversals:=jsonb_build_array(jsonb_build_object('chargeId',v_part.charge_id,'transferId',v_part.transfer_ref,
      'amountPence',v_part.amount_pence-v_part.reversed_pence-v_pay));
  end if;
  insert into public.booking_visit_money_operations(booking_id,customer_id,operation_type,revision,idempotency_key,parameters)
  values(p_booking,v_bill.customer_id,'cancellation_adjustment',v_bill.revision,'visit:'||gen_random_uuid(),
    jsonb_build_object('oldStatus','cancelled','scheduledAt',(select scheduled_at from public.bookings where id=p_booking),
      'requestedBy',v_uid,'actorKind',v_kind,'refundPence',v_delta,'refunds',v_refunds,'reversals',v_reversals,
      'nextSettlement',jsonb_build_object('chargePercent',v_percent,'chargePence',v_charge_total,'cleanerPayPence',v_pay,'waivedPence',v_waived)))
  returning * into v_operation;
  update public.booking_visit_billing set active_operation_id=v_operation.id,status='cancelling' where booking_id=p_booking;
  return to_jsonb(v_operation);
end
$fn$;
revoke all on function public.prepare_cleaning_cancellation_adjustment(uuid,text,integer,integer) from public,anon;
grant execute on function public.prepare_cleaning_cancellation_adjustment(uuid,text,integer,integer) to authenticated;

-- Staff no-access cancellation uses the normal refund engine and ledger. A
-- service-only caller must supply the authenticated staff actor (API gates MFA).
do $migration$
declare v_oid regprocedure:='public.prepare_visit_money_operation(uuid,uuid,text,integer,jsonb)'::regprocedure;
  v_definition text; v_old text; v_new text;
begin
  select pg_get_functiondef(v_oid) into v_definition;
  v_old:='if v_booking.status::text not in (''offered'', ''declined'', ''scheduled'') and p_type not in (''late_refund'', ''policy_refund'') then';
  v_new:='if v_booking.status::text not in (''offered'', ''declined'', ''scheduled'') and p_type not in (''late_refund'', ''policy_refund'')
    and not (p_type=''cancel'' and v_booking.status::text=''needs_review'' and coalesce((p_parameters->>''noAccess'')::boolean,false) and p_parameters ? ''staffActor'') then';
  if strpos(v_definition,v_old)=0 then raise exception 'Cancellation state guard changed'; end if;
  v_definition:=replace(v_definition,v_old,v_new);
  v_old:='      when p_actor is null then 0';
  v_new:='      when p_parameters ? ''staffActor'' and p_parameters ? ''staffChargePercent'' then 100-(p_parameters->>''staffChargePercent'')::integer
      when p_actor is null then 0';
  if strpos(v_definition,v_old)=0 then raise exception 'Cancellation percentage guard changed'; end if;
  v_definition:=replace(v_definition,v_old,v_new);
  v_old:='perform public._apply_booking_transition(p_booking, ''cancelled'', p_actor,
      case when p_actor is null then ''system'' else ''customer'' end,';
  v_new:='perform public._apply_booking_transition(p_booking, ''cancelled'', coalesce((p_parameters->>''staffActor'')::uuid,p_actor),
      case when p_parameters ? ''staffActor'' then ''admin'' when p_actor is null then ''system'' else ''customer'' end,';
  if strpos(v_definition,v_old)=0 then raise exception 'Cancellation actor audit changed'; end if;
  v_definition:=replace(v_definition,v_old,v_new);
  v_old:='case when p_type = ''unfilled'' then ''No cleaner accepted this visit''';
  v_new:='case when coalesce((p_parameters->>''noAccess'')::boolean,false) then ''No access after fifteen minutes; staff reviewed the cancellation charge''
        when p_type = ''unfilled'' then ''No cleaner accepted this visit''';
  if strpos(v_definition,v_old)=0 then raise exception 'No-access audit reason changed'; end if;
  execute replace(v_definition,v_old,v_new);
end
$migration$;
commit;
