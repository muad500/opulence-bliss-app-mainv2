begin;

-- Retire the previous attachment RPC so all callers use the attempt ledger.
revoke all on function public.finalize_handyman_hold(uuid,text,text,integer,boolean)
  from public,anon,authenticated,service_role;

-- Each Stripe authorisation attempt survives retries and failed job finalisation.
create table public.handyman_payment_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.handyman_jobs(id),
  revision text not null check (revision in ('initial', 'final')),
  amount_pence integer not null check (amount_pence > 0),
  parameters jsonb,
  session_id text unique,
  payment_intent text unique,
  status text not null default 'creating'
    check (status in ('creating','open','attached','release_pending','released','expired')),
  legacy boolean not null default false,
  capture_before timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index handyman_attempts_recovery
  on public.handyman_payment_attempts(status, updated_at);
alter table public.handyman_payment_attempts enable row level security;
revoke all on public.handyman_payment_attempts from public, anon, authenticated;
grant all on public.handyman_payment_attempts to service_role;
alter table public.handyman_jobs add column checkout_attempt_id uuid
  references public.handyman_payment_attempts(id);

-- Existing known payments remain recognisable; never invent Stripe parameters.
insert into public.handyman_payment_attempts
  (job_id,revision,amount_pence,session_id,payment_intent,status,legacy)
select id,'initial',held_pence,checkout_session,payment_intent,
  case when payment_intent is not null then 'attached' else 'open' end,true
from public.handyman_jobs where checkout_session is not null;
update public.handyman_jobs j set checkout_attempt_id=a.id
from public.handyman_payment_attempts a where a.job_id=j.id;

create function public.begin_handyman_checkout(
  p_job uuid,p_user uuid,p_parameters jsonb
) returns public.handyman_payment_attempts
language plpgsql security definer set search_path=public as $fn$
declare j public.handyman_jobs; a public.handyman_payment_attempts;
  revision text; amount integer; parameters jsonb; attempt_id uuid:=gen_random_uuid();
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  select * into j from public.handyman_jobs where id=p_job for update;
  if not found or j.customer_id is distinct from p_user
    or j.status not in ('checkout_pending','awaiting_authorization') then
    raise exception 'Authorisation is unavailable';
  end if;
  revision:=case when j.status='awaiting_authorization' then 'final' else 'initial' end;
  amount:=case when revision='final' then (j.bill->>'gross')::integer else j.held_pence end;
  if amount is null or amount<=0 then raise exception 'No approved bill'; end if;
  if revision='final' and j.approved_at is null then raise exception 'Bill approval required'; end if;
  select * into a from public.handyman_payment_attempts where id=j.checkout_attempt_id for update;
  if found and a.status in ('creating','open') then
    if not a.legacy and (a.revision<>revision or a.amount_pence<>amount) then
      raise exception 'An earlier checkout needs reconciliation';
    end if;
    return a;
  end if;
  if revision='initial' and j.created_at<now()-interval '1 hour' then
    raise exception 'Reservation expired; book a new available slot';
  end if;
  if (p_parameters#>>'{line_items,0,price_data,unit_amount}')::integer is distinct from amount
    or p_parameters->>'client_reference_id' is distinct from p_user::text then
    raise exception 'Checkout parameters do not match';
  end if;
  parameters:=p_parameters || jsonb_build_object('expires_at',floor(extract(epoch from now()+interval '1 hour')));
  parameters:=jsonb_set(parameters,'{metadata,attempt_id}',to_jsonb(attempt_id::text));
  parameters:=jsonb_set(parameters,'{payment_intent_data,metadata,attempt_id}',to_jsonb(attempt_id::text));
  insert into public.handyman_payment_attempts(id,job_id,revision,amount_pence,parameters)
    values(attempt_id,j.id,revision,amount,parameters) returning * into a;
  update public.handyman_jobs set checkout_attempt_id=a.id,checkout_session=null where id=j.id;
  return a;
end $fn$;

create function public.record_handyman_session(p_attempt uuid,p_session text)
returns public.handyman_payment_attempts
language plpgsql security definer set search_path=public as $fn$
declare a public.handyman_payment_attempts; j public.handyman_jobs;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  select * into a from public.handyman_payment_attempts where id=p_attempt;
  select * into j from public.handyman_jobs where id=a.job_id for update;
  select * into a from public.handyman_payment_attempts where id=p_attempt for update;
  if a.id is null or (a.session_id is not null and a.session_id<>p_session) then
    raise exception 'Checkout attempt mismatch';
  end if;
  update public.handyman_payment_attempts
    set session_id=p_session,status=case when status='creating' then 'open' else status end,
        updated_at=clock_timestamp() where id=a.id returning * into a;
  if j.checkout_attempt_id=a.id and j.status in ('checkout_pending','awaiting_authorization') then
    update public.handyman_jobs set checkout_session=p_session where id=j.id;
  end if;
  return a;
end $fn$;

create function public.expire_handyman_attempt(p_attempt uuid,p_session text)
returns void language plpgsql security definer set search_path=public as $fn$
declare a public.handyman_payment_attempts;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  select * into a from public.handyman_payment_attempts where id=p_attempt;
  perform 1 from public.handyman_jobs where id=a.job_id for update;
  update public.handyman_payment_attempts set status='expired',updated_at=clock_timestamp()
    where id=p_attempt and session_id is not distinct from p_session and payment_intent is null
      and status in ('creating','open');
  if not found then raise exception 'Attempt changed; reconcile before retry'; end if;
end $fn$;

-- Persist either attachment or a release decision in the SAME locked transaction.
-- A database/network error is ambiguous and is retried, never interpreted as rejection.
create function public.finalize_handyman_attempt(
  p_job uuid,p_attempt uuid,p_session text,p_intent text,p_amount integer,
  p_final boolean,p_capture_before timestamptz
) returns jsonb language plpgsql security definer set search_path=public as $fn$
declare j public.handyman_jobs; a public.handyman_payment_attempts; reject_hold boolean;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  select * into j from public.handyman_jobs where id=p_job for update;
  if not found then raise exception 'Job not found'; end if;
  select * into a from public.handyman_payment_attempts
    where job_id=j.id and (id=p_attempt or (p_attempt is null and session_id=p_session)) for update;
  if not found or (a.session_id is not null and a.session_id<>p_session)
    or (a.payment_intent is not null and a.payment_intent<>p_intent)
    or a.amount_pence<>p_amount or (not a.legacy and (a.revision='final')<>p_final) then
    raise exception 'Authorisation attempt mismatch';
  end if;
  if a.status='released' then
    return jsonb_build_object('decision','released','job',to_jsonb(j),'attempt',to_jsonb(a));
  end if;
  if j.payment_intent=p_intent then
    return jsonb_build_object('decision','attached','job',to_jsonb(j),'attempt',to_jsonb(a));
  end if;
  reject_hold:=a.status in ('release_pending','expired')
    or j.checkout_attempt_id is distinct from a.id
    or j.status<>case when p_final then 'awaiting_authorization' else 'checkout_pending' end;
  if not reject_hold and p_final then
    reject_hold:=j.approved_at is null or p_amount is distinct from (j.bill->>'gross')::integer;
  elsif not reject_hold then
    perform pg_advisory_xact_lock(hashtextextended('professional-schedule:'||j.provider_id::text,0));
    reject_hold:=j.created_at<now()-interval '1 hour' or p_amount<>j.held_pence
      or not public.handyman_available(j.provider_id,j.customer_id,j.postcode,
                                       j.scheduled_at,j.estimated_minutes,j.id);
  end if;
  update public.handyman_payment_attempts
    set session_id=p_session,payment_intent=p_intent,capture_before=p_capture_before,
      status=case when reject_hold then 'release_pending' else 'attached' end,
      updated_at=clock_timestamp() where id=a.id returning * into a;
  if reject_hold then
    if j.status='checkout_pending' and j.checkout_attempt_id=a.id and j.payment_intent is null then
      update public.handyman_jobs set status='cancel_pending',updated_at=clock_timestamp()
        where id=j.id returning * into j;
    end if;
    return jsonb_build_object('decision','release','job',to_jsonb(j),'attempt',to_jsonb(a));
  end if;
  if p_final and j.payment_intent is not null then
    update public.handyman_payment_attempts set status='release_pending',updated_at=clock_timestamp()
      where job_id=j.id and payment_intent=j.payment_intent and id<>a.id;
  end if;
  update public.handyman_jobs set
    previous_payment_intent=case when p_final then payment_intent else null end,
    payment_intent=p_intent,held_pence=p_amount,checkout_session=p_session,
    status=case when p_final then 'payment_pending' else 'scheduled' end,
    updated_at=clock_timestamp() where id=j.id returning * into j;
  if not p_final then
    insert into public.notifications(user_id,title,body,href)
      select profile_id,'New handyman booking','A customer selected you for '||j.task_name||
        '. The card is held.','/handyman/jobs/'||j.id::text from public.providers where id=j.provider_id;
  end if;
  return jsonb_build_object('decision','attached','job',to_jsonb(j),'attempt',to_jsonb(a));
end $fn$;

create function public.finish_handyman_hold_release(p_attempt uuid,p_intent text)
returns void language plpgsql security definer set search_path=public as $fn$
declare a public.handyman_payment_attempts; j public.handyman_jobs;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  select * into a from public.handyman_payment_attempts where id=p_attempt;
  select * into j from public.handyman_jobs where id=a.job_id for update;
  if a.id is null or a.payment_intent is distinct from p_intent
    or a.status not in ('release_pending','released') or j.payment_intent=p_intent then
    raise exception 'Hold is not eligible for release';
  end if;
  update public.handyman_payment_attempts set status='released',updated_at=clock_timestamp()
    where id=a.id;
  update public.handyman_jobs set previous_payment_intent=null
    where id=j.id and previous_payment_intent=p_intent;
  if j.status='cancel_pending' and j.payment_intent is null and j.checkout_attempt_id=a.id then
    update public.handyman_jobs set status='cancelled',updated_at=clock_timestamp() where id=j.id;
  end if;
end $fn$;

-- Recovery of an expired handyman hold is customer-driven and preserves bill approval.
-- Cleaning's timing/off-session policy is deliberately not implemented here.
create function public.reauthorise_handyman_bill(p_job uuid,p_intent text)
returns public.handyman_jobs language plpgsql security definer set search_path=public as $fn$
declare j public.handyman_jobs;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  select * into j from public.handyman_jobs where id=p_job for update;
  if not found or j.status<>'payment_pending' or j.payment_intent is distinct from p_intent
    or j.bill is null or j.approved_at is null or j.transfer_ref is not null then
    raise exception 'Approved payment changed';
  end if;
  update public.handyman_jobs set status='awaiting_authorization',payment_claim_at=null,
    last_payment_error='The earlier card hold expired. Authorise the approved bill again.',
    updated_at=clock_timestamp() where id=j.id returning * into j;
  return j;
end $fn$;

revoke all on function public.begin_handyman_checkout(uuid,uuid,jsonb),
 public.record_handyman_session(uuid,text),public.expire_handyman_attempt(uuid,text),
 public.finalize_handyman_attempt(uuid,uuid,text,text,integer,boolean,timestamptz),
 public.finish_handyman_hold_release(uuid,text),public.reauthorise_handyman_bill(uuid,text)
 from public,anon,authenticated;
grant execute on function public.begin_handyman_checkout(uuid,uuid,jsonb),
 public.record_handyman_session(uuid,text),public.expire_handyman_attempt(uuid,text),
 public.finalize_handyman_attempt(uuid,uuid,text,text,integer,boolean,timestamptz),
 public.finish_handyman_hold_release(uuid,text),public.reauthorise_handyman_bill(uuid,text)
 to service_role;

-- The reviewed erasure workflow cannot discard unresolved authorisation attempts.
alter function public.prepare_account_erasure(uuid,text)
  rename to prepare_account_erasure_before_handyman_recovery;
revoke all on function public.prepare_account_erasure_before_handyman_recovery(uuid,text)
  from public,anon,authenticated,service_role;
create function public.prepare_account_erasure(p_request_id uuid,p_retention_note text)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare target uuid; professional uuid; result jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  select user_id into target from public.account_deletion_requests where id=p_request_id for update;
  perform 1 from public.profiles where id=target for update;
  select id into professional from public.providers where profile_id=target;
  perform 1 from public.handyman_jobs where customer_id=target or provider_id=professional for update;
  if exists(select 1 from public.handyman_payment_attempts a
    join public.handyman_jobs j on j.id=a.job_id
    where (j.customer_id=target or j.provider_id=professional)
      and a.status in ('creating','open','release_pending')) then
    raise exception 'Resolve open handyman authorisations and releases before erasure';
  end if;
  result:=public.prepare_account_erasure_before_handyman_recovery(p_request_id,p_retention_note);
  update public.handyman_payment_attempts a set parameters=null
    from public.handyman_jobs j where j.id=a.job_id and j.customer_id=target;
  return result;
end $fn$;
revoke all on function public.prepare_account_erasure(uuid,text) from public,anon,authenticated;
grant execute on function public.prepare_account_erasure(uuid,text) to service_role;
commit;
