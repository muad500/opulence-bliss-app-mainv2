-- Owner decisions: keep the current cleaner agreement, notify before each
-- regular charge, and record both parties' agreement to a free time change.
begin;

create table public.regular_payment_notices (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique references public.booking_visit_money_operations(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  customer_id uuid not null references public.profiles(id),
  scheduled_at timestamptz not null,
  amount_pence integer not null check (amount_pence > 0),
  in_app_sent_at timestamptz not null,
  email_sent_at timestamptz,
  email_reference text,
  claim_token uuid,
  lease_until timestamptz,
  first_attempt_at timestamptz,
  last_attempt_at timestamptz,
  attempts integer not null default 0
);
alter table public.regular_payment_notices enable row level security;
revoke all on public.regular_payment_notices from public, anon, authenticated;
grant select on public.regular_payment_notices to service_role;

create function public.require_regular_payment_notice()
returns trigger language plpgsql security definer set search_path=public as $fn$
begin
  if new.operation_type='charge' and exists (
    select 1 from public.bookings where id=new.booking_id and regular_series_id is not null
  ) then
    new.parameters:=new.parameters || '{"prepaymentNoticeRequired":true}'::jsonb;
  end if;
  return new;
end;
$fn$;
create trigger require_regular_payment_notice before insert on public.booking_visit_money_operations
for each row execute function public.require_regular_payment_notice();
revoke all on function public.require_regular_payment_notice() from public,anon,authenticated,service_role;

alter function public.visit_charge_gate(uuid,uuid,text) rename to visit_charge_gate_before_notice;
revoke all on function public.visit_charge_gate_before_notice(uuid,uuid,text) from public,anon,authenticated,service_role;
create function public.visit_charge_gate(p_booking uuid,p_operation uuid default null,p_kind text default 'charge')
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare result jsonb; op public.booking_visit_money_operations;
begin
  result:=public.visit_charge_gate_before_notice(p_booking,p_operation,p_kind);
  if not coalesce((result->>'allowed')::boolean,false) or p_operation is null then return result; end if;
  select * into strict op from public.booking_visit_money_operations where id=p_operation and booking_id=p_booking;
  if coalesce((op.parameters->>'prepaymentNoticeRequired')::boolean,false) and not exists (
    select 1 from public.regular_payment_notices n join public.bookings b on b.id=n.booking_id
    where n.operation_id=op.id and n.email_sent_at is not null and n.in_app_sent_at is not null
      and n.scheduled_at=b.scheduled_at and n.amount_pence=(op.parameters->>'amountPence')::integer
  ) then return result || '{"allowed":false,"reason":"payment_notice_pending"}'::jsonb; end if;
  return result;
end;
$fn$;
revoke all on function public.visit_charge_gate(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.visit_charge_gate(uuid,uuid,text) to service_role;

create function public.claim_regular_payment_notice(p_operation uuid)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare op public.booking_visit_money_operations; b public.bookings; n public.regular_payment_notices;
  gate jsonb; token uuid; recipient text; amount integer; stamp timestamptz:=clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  select * into strict op from public.booking_visit_money_operations where id=p_operation;
  if not coalesce((op.parameters->>'prepaymentNoticeRequired')::boolean,false) or op.status in ('succeeded','failed') then
    return jsonb_build_object('required',false,'ready',true);
  end if;
  perform public.lock_visit_series(op.booking_id);
  select * into strict b from public.bookings where id=op.booking_id for update;
  select * into strict op from public.booking_visit_money_operations where id=p_operation for update;
  gate:=public.visit_charge_gate_before_notice(b.id,op.id,op.operation_type);
  -- Let the normal runner reconcile/close a blocked operation, without email
  -- or a new payment. Its fresh charge gate still forbids Stripe confirmation.
  if not (gate->>'allowed')::boolean then return jsonb_build_object('required',false,'ready',true); end if;
  amount:=(op.parameters->>'amountPence')::integer;
  select * into n from public.regular_payment_notices where operation_id=op.id for update;
  if found and (n.scheduled_at<>b.scheduled_at or n.amount_pence<>amount) then
    raise exception 'Payment notice changed; operation needs reconciliation';
  end if;
  if n.id is null then
    insert into public.notifications(user_id,title,body,href) values(
      b.customer_id,'Your upcoming regular cleaning payment',
      'We will charge £'||to_char(amount/100.0,'FM999999990.00')||' for your regular visit on '||
      to_char(b.scheduled_at at time zone 'Europe/London','DD Mon YYYY, HH24:MI')||' (London time), after sending your payment notice.',
      '/account/visit/'||b.id);
    insert into public.regular_payment_notices(operation_id,booking_id,customer_id,scheduled_at,amount_pence,in_app_sent_at)
    values(op.id,b.id,b.customer_id,b.scheduled_at,amount,stamp) returning * into n;
  end if;
  if n.email_sent_at is not null then return jsonb_build_object('required',true,'ready',true); end if;
  if n.lease_until>stamp or n.first_attempt_at<stamp-interval '23 hours' then
    return jsonb_build_object('required',true,'ready',false);
  end if;
  select email into recipient from auth.users where id=b.customer_id;
  token:=gen_random_uuid();
  update public.regular_payment_notices set claim_token=token,lease_until=stamp+interval '3 minutes',
    first_attempt_at=coalesce(first_attempt_at,stamp),last_attempt_at=stamp,attempts=attempts+1
  where id=n.id returning * into n;
  return jsonb_build_object('required',true,'ready',false,'id',n.id,'token',token,'recipient',recipient,
    'scheduledAt',n.scheduled_at,'amountPence',n.amount_pence,'firstAttemptAt',n.first_attempt_at);
end;
$fn$;
revoke all on function public.claim_regular_payment_notice(uuid) from public,anon,authenticated;
grant execute on function public.claim_regular_payment_notice(uuid) to service_role;

create function public.finish_regular_payment_notice(p_id uuid,p_token uuid,p_reference text)
returns boolean language plpgsql security definer set search_path=public as $fn$
declare changed integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  update public.regular_payment_notices set email_sent_at=case when nullif(p_reference,'') is not null then clock_timestamp() else email_sent_at end,
    email_reference=coalesce(nullif(p_reference,''),email_reference),claim_token=null,lease_until=null
  where id=p_id and claim_token=p_token and email_sent_at is null;
  get diagnostics changed=row_count;
  return changed=1 and nullif(p_reference,'') is not null;
end;
$fn$;
revoke all on function public.finish_regular_payment_notice(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.finish_regular_payment_notice(uuid,uuid,text) to service_role;

-- Old prepared operations are grandfathered. Every new regular charge is
-- guarded at claim AND immediately before Stripe confirmation/reconciliation.
alter function public.claim_visit_money_operation(uuid) rename to claim_visit_money_operation_before_notice;
revoke all on function public.claim_visit_money_operation_before_notice(uuid) from public,anon,authenticated,service_role;
create function public.claim_visit_money_operation(p_operation uuid)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare op public.booking_visit_money_operations; gate jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  select * into strict op from public.booking_visit_money_operations where id=p_operation;
  gate:=public.visit_charge_gate(op.booking_id,op.id,op.operation_type);
  if gate->>'reason'='payment_notice_pending' then return null; end if;
  return public.claim_visit_money_operation_before_notice(p_operation);
end;
$fn$;
revoke all on function public.claim_visit_money_operation(uuid) from public,anon,authenticated;
grant execute on function public.claim_visit_money_operation(uuid) to service_role;

create table public.cleaning_time_changes (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  customer_id uuid not null references public.profiles(id),
  provider_id uuid not null references public.providers(id),
  original_at timestamptz not null,
  proposed_at timestamptz not null,
  requested_by uuid not null references public.profiles(id),
  responded_by uuid references public.profiles(id),
  status text not null default 'pending' check(status in ('pending','agreed','declined','superseded')),
  created_at timestamptz not null default now(),
  responded_at timestamptz
);
create unique index one_pending_cleaning_time_change on public.cleaning_time_changes(booking_id) where status='pending';
alter table public.cleaning_time_changes enable row level security;
revoke all on public.cleaning_time_changes from public,anon,authenticated;
grant select on public.cleaning_time_changes to authenticated,service_role;
create policy cleaning_time_change_participants on public.cleaning_time_changes for select to authenticated
using(customer_id=auth.uid() or exists(select 1 from public.providers where id=provider_id and profile_id=auth.uid()));

create function public.request_cleaning_time_change(p_booking uuid,p_slot timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare b public.bookings; worker uuid; r public.cleaning_time_changes; uid uuid:=auth.uid();
begin
  if uid is null then raise exception 'Sign in required'; end if;
  perform public.lock_visit_series(p_booking);
  select * into strict b from public.bookings where id=p_booking for update;
  select profile_id into worker from public.providers where id=b.provider_id;
  if b.status::text<>'scheduled' or b.provider_id is null or uid not in (b.customer_id,worker)
    or not exists(select 1 from public.profiles where id=uid and account_deleted_at is null)
  then raise exception 'Only the customer and assigned cleaner can agree a time change'; end if;
  if p_slot is null or p_slot<=now() or p_slot>now()+interval '1 year' or p_slot=b.scheduled_at
    or extract(hour from p_slot at time zone 'Europe/London')<7
    or (p_slot at time zone 'Europe/London')::date<>((p_slot+make_interval(mins=>coalesce(b.duration_minutes,120))) at time zone 'Europe/London')::date
    or ((p_slot+make_interval(mins=>coalesce(b.duration_minutes,120))) at time zone 'Europe/London')::time>time '20:00'
  then raise exception 'Choose a future time that fits within 7am to 8pm'; end if;
  if exists(select 1 from public.booking_visit_billing where booking_id=b.id and active_operation_id is not null)
    then raise exception 'Wait for the payment operation to finish'; end if;
  update public.cleaning_time_changes set status='superseded',responded_at=now() where booking_id=b.id and status='pending';
  insert into public.cleaning_time_changes(booking_id,customer_id,provider_id,original_at,proposed_at,requested_by)
    values(b.id,b.customer_id,b.provider_id,b.scheduled_at,p_slot,uid) returning * into r;
  insert into public.notifications(user_id,title,body,href) values(
    case when uid=b.customer_id then worker else b.customer_id end,'Please agree a new cleaning time',
    'A new time has been proposed for '||to_char(p_slot at time zone 'Europe/London','DD Mon YYYY, HH24:MI')||'. If you agree, the visit moves free of charge.',
    case when uid=b.customer_id then '/worker/job/' else '/account/visit/' end||b.id);
  return to_jsonb(r);
end;
$fn$;

create function public.respond_cleaning_time_change(p_change uuid,p_accept boolean)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare r public.cleaning_time_changes; b public.bookings; worker uuid; uid uuid:=auth.uid(); reason text;
begin
  if uid is null or p_accept is null then raise exception 'Sign in and choose a response'; end if;
  select * into strict r from public.cleaning_time_changes where id=p_change;
  perform public.lock_visit_series(r.booking_id);
  select * into strict b from public.bookings where id=r.booking_id for update;
  select * into strict r from public.cleaning_time_changes where id=p_change for update;
  select profile_id into worker from public.providers where id=b.provider_id;
  if b.customer_id<>r.customer_id or b.provider_id is distinct from r.provider_id or uid=r.requested_by
    or uid not in (r.customer_id,worker)
    or not exists(select 1 from public.profiles where id=uid and account_deleted_at is null)
  then raise exception 'This request changed or is not yours to answer'; end if;
  if r.status='agreed' and r.responded_by=uid and b.scheduled_at=r.proposed_at then return to_jsonb(r); end if;
  if r.status<>'pending' or b.status::text<>'scheduled' or b.scheduled_at<>r.original_at then raise exception 'This request is no longer pending'; end if;
  if p_accept then
    perform pg_advisory_xact_lock(hashtextextended('professional-schedule:'||b.provider_id::text,0));
    if r.proposed_at<=now() or not public.provider_service_approved(b.provider_id,'cleaning') then raise exception 'The new time or professional is no longer available'; end if;
    reason:=public.professional_booking_conflict(b.provider_id,b.id,r.proposed_at);
    if reason is not null then raise exception '%',reason; end if;
    if exists(select 1 from public.booking_visit_billing where booking_id=b.id and active_operation_id is not null)
      then raise exception 'Wait for the payment operation to finish'; end if;
  end if;
  update public.cleaning_time_changes set status=case when p_accept then 'agreed' else 'declined' end,
    responded_by=uid,responded_at=now() where id=r.id returning * into r;
  if p_accept then
    perform set_config('opulence.agreed_time_change',r.id::text,true);
    update public.bookings set scheduled_at=r.proposed_at,preferred_scheduled_at=r.proposed_at,
      optional_scheduled_at='{}'::timestamptz[] where id=b.id;
    update public.booking_visit_billing set charge_due_at=least(charge_due_at,now())
      where booking_id=b.id and status in ('unpaid','failed','requires_action');
    insert into public.booking_events(booking_id,from_status,to_status,actor_id,actor_kind,reason,meta)
    values(b.id,b.status::text,b.status::text,uid,case when uid=b.customer_id then 'customer' else 'provider' end,
      'Free reschedule agreed by customer and assigned cleaner',jsonb_build_object('event','agreed_reschedule','agreement',r.id,'from',r.original_at,'to',r.proposed_at,'requested_by',r.requested_by,'agreed_by',uid));
    insert into public.notifications(user_id,title,body,href) values
      (b.customer_id,'New cleaning time agreed','Your visit has moved free of charge to '||to_char(r.proposed_at at time zone 'Europe/London','DD Mon YYYY, HH24:MI')||'.','/account/visit/'||b.id),
      (worker,'New cleaning time agreed','The customer and cleaner have agreed the new time. No rescheduling charge applies.','/worker/job/'||b.id);
  end if;
  return to_jsonb(r);
end;
$fn$;
revoke all on function public.request_cleaning_time_change(uuid,timestamptz),public.respond_cleaning_time_change(uuid,boolean) from public,anon,service_role;
grant execute on function public.request_cleaning_time_change(uuid,timestamptz),public.respond_cleaning_time_change(uuid,boolean) to authenticated;

-- Preserve the existing solo-change guard. Only a locked two-party agreement
-- bypasses its timing checks; its other billing/status checks still run.
do $guard$
declare source text; marker text;
begin
  select replace(pg_get_functiondef('public.guard_visit_billing_booking_changes()'::regprocedure),E'\r\n',E'\n') into source;
  marker:='if new.scheduled_at is distinct from old.scheduled_at then';
  if strpos(source,marker)=0 then raise exception 'Reschedule guard changed; inspect before replacing'; end if;
  source:=replace(source,marker,$replacement$if new.scheduled_at is distinct from old.scheduled_at and not exists(
    select 1 from public.cleaning_time_changes c where c.id=nullif(current_setting('opulence.agreed_time_change',true),'')::uuid
      and c.booking_id=old.id and c.customer_id=old.customer_id and c.provider_id=old.provider_id
      and c.status='agreed' and c.original_at=old.scheduled_at and c.proposed_at=new.scheduled_at
      and c.requested_by<>c.responded_by and c.responded_by=auth.uid()
  ) then$replacement$);
  execute source;
end;
$guard$;

update public.faqs set answer='A new time agreed with your assigned cleaner is free at any time. You can propose a time in your visit page and the other person must accept it. If you change the booking alone, give at least 48 hours'' notice for a free change. With less notice, cancel and rebook under the original visit''s agreed cancellation band. Existing bookings keep their agreed terms.'
where lower(trim(question)) in ('can i reschedule my appointment?','can i change my booking?') and category<>'handyman';
commit;
notify pgrst,'reload schema';
