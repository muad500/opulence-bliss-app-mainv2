-- Isolated CI fixture database, never Supabase staging or Production.
create role anon;
create role authenticated;
create role service_role;
create schema auth;
create function auth.role() returns text language sql stable as $fn$
 select coalesce(current_setting('test.auth_role',true),'service_role');
$fn$;
create table public.profiles(id uuid primary key);
create table public.providers(id uuid primary key,profile_id uuid);
create table public.notifications(user_id uuid,title text,body text,href text);
create table public.account_deletion_requests(id uuid primary key,user_id uuid);
create table public.handyman_jobs(
 id uuid primary key,customer_id uuid,provider_id uuid,
 task_name text,postcode text,scheduled_at timestamptz,estimated_minutes integer,
 held_pence integer,status text,checkout_session text,payment_intent text,
 previous_payment_intent text,transfer_ref text,bill jsonb,approved_at timestamptz,
 payment_claim_at timestamptz,last_payment_error text,
 created_at timestamptz default now(),updated_at timestamptz default now(),
 description text,address text
);
create function public.handyman_available(uuid,uuid,text,timestamptz,integer,uuid)
returns boolean language sql stable as $fn$
 select coalesce(nullif(current_setting('test.available',true),''),'true')::boolean;
$fn$;
create function public.finalize_handyman_hold(uuid,text,text,integer,boolean)
returns void language sql as 'select';
create function public.prepare_account_erasure(uuid,text)
returns jsonb language sql as $fn$ select '{}'::jsonb; $fn$;

\ir ../migrations/20261003002000_handyman_payment_recovery.sql

begin;
do $test$
declare
 customer uuid:='00000000-0000-0000-0000-000000000001';
 provider uuid:='00000000-0000-0000-0000-000000000002';
 job_id uuid:='00000000-0000-0000-0000-000000000003';
 rejected_id uuid:='00000000-0000-0000-0000-000000000004';
 req uuid:='00000000-0000-0000-0000-000000000005';
 first_attempt public.handyman_payment_attempts;
 retry_attempt public.handyman_payment_attempts;
 final_attempt public.handyman_payment_attempts;
 params jsonb; result jsonb; caught boolean;
begin
 insert into public.profiles values(customer);
 insert into public.providers values(provider,customer);
 insert into public.handyman_jobs(
  id,customer_id,provider_id,task_name,postcode,scheduled_at,
  estimated_minutes,held_pence,status
 ) values(job_id,customer,provider,'Furniture assembly','SW3 1AA',
  now()+interval '3 hours',60,5000,'checkout_pending');
 params:=jsonb_build_object(
  'client_reference_id',customer::text,'customer','cus_fixture',
  'metadata',jsonb_build_object('kind','handyman','job_id',job_id,'revision','initial'),
  'payment_intent_data',jsonb_build_object('metadata',jsonb_build_object('kind','handyman')),
  'line_items',jsonb_build_array(jsonb_build_object(
    'price_data',jsonb_build_object('unit_amount',5000)))
 );
 first_attempt:=public.begin_handyman_checkout(job_id,customer,params);
 retry_attempt:=public.begin_handyman_checkout(job_id,customer,
  params||jsonb_build_object('success_url','changed.example'));
 if first_attempt.id<>retry_attempt.id or first_attempt.parameters<>retry_attempt.parameters then
  raise exception '105: checkout retry changed its attempt or parameters';
 end if;
 perform public.record_handyman_session(first_attempt.id,'cs_initial');
 result:=public.finalize_handyman_attempt(job_id,first_attempt.id,
  'cs_initial','pi_initial',5000,false,now()+interval '7 days');
 if result->>'decision'<>'attached' then raise exception 'Initial hold not attached'; end if;
 result:=public.finalize_handyman_attempt(job_id,first_attempt.id,
  'cs_initial','pi_initial',5000,false,null);
 if result->>'decision'<>'attached'
  or (select count(*) from public.notifications)<>1 then
  raise exception 'Duplicate finalisation was not idempotent';
 end if;

 update public.handyman_jobs set status='payment_pending',
  bill='{"gross":5000,"provider":4000}',approved_at=now() where id=job_id;
 perform public.reauthorise_handyman_bill(job_id,'pi_initial');
 if (select status from public.handyman_jobs where id=job_id)<>'awaiting_authorization'
  or (select bill->>'gross' from public.handyman_jobs where id=job_id)<>'5000' then
  raise exception '106: expired hold lost bill approval or recovery state';
 end if;
 final_attempt:=public.begin_handyman_checkout(job_id,customer,params);
 if final_attempt.id=first_attempt.id or final_attempt.revision<>'final' then
  raise exception '106: replacement authorisation reused old attempt';
 end if;
 perform public.record_handyman_session(final_attempt.id,'cs_final');
 result:=public.finalize_handyman_attempt(job_id,final_attempt.id,
  'cs_final','pi_final',5000,true,now()+interval '7 days');
 if result->>'decision'<>'attached'
  or (select status from public.handyman_payment_attempts where id=first_attempt.id)<>'release_pending'
  or (select previous_payment_intent from public.handyman_jobs where id=job_id)<>'pi_initial' then
  raise exception '108: replacement did not preserve old-hold release work';
 end if;
 perform public.finish_handyman_hold_release(first_attempt.id,'pi_initial');
 perform public.finish_handyman_hold_release(first_attempt.id,'pi_initial');
 if (select payment_intent from public.handyman_jobs where id=job_id)<>'pi_final'
  or (select previous_payment_intent from public.handyman_jobs where id=job_id) is not null then
  raise exception '108: old-hold acknowledgement modified the new payment';
 end if;
 result:=public.finalize_handyman_attempt(job_id,first_attempt.id,
  'cs_initial','pi_initial',5000,false,null);
 if result->>'decision'<>'released' then
  raise exception '109: delayed replaced attempt was reattached';
 end if;
 caught:=false;
 begin perform public.finish_handyman_hold_release(final_attempt.id,'pi_final');
 exception when others then caught:=true; end;
 if not caught then raise exception 'Current payment eligible for recovery cancellation'; end if;

 insert into public.handyman_jobs(
  id,customer_id,provider_id,task_name,postcode,scheduled_at,
  estimated_minutes,held_pence,status
 ) values(rejected_id,customer,provider,'Furniture assembly','SW3 1AA',
  now()+interval '3 hours',60,5000,'checkout_pending');
 params:=jsonb_set(params,'{metadata,job_id}',to_jsonb(rejected_id::text));
 first_attempt:=public.begin_handyman_checkout(rejected_id,customer,params);
 perform public.record_handyman_session(first_attempt.id,'cs_rejected');
 update public.handyman_jobs set created_at=now()-interval '2 hours' where id=rejected_id;
 result:=public.finalize_handyman_attempt(rejected_id,first_attempt.id,
  'cs_rejected','pi_rejected',5000,false,null);
 if result->>'decision'<>'release'
  or (select payment_intent from public.handyman_payment_attempts where id=first_attempt.id)<>'pi_rejected'
  or (select payment_intent from public.handyman_jobs where id=rejected_id) is not null then
  raise exception '107: rejected hold was not recorded separately for release';
 end if;
 insert into public.account_deletion_requests values(req,customer);
 caught:=false;
 begin perform public.prepare_account_erasure(req,'Fixture retention reason');
 exception when others then
  if sqlerrm not like 'Resolve open handyman authorisations%' then raise; end if;
  caught:=true;
 end;
 if not caught then raise exception 'Pending release failed to block erasure'; end if;
 perform public.finish_handyman_hold_release(first_attempt.id,'pi_rejected');
 if (select status from public.handyman_jobs where id=rejected_id)<>'cancelled' then
  raise exception '107: released rejected reservation not closed';
 end if;
 perform public.prepare_account_erasure(req,'Fixture retention reason');

 perform set_config('test.auth_role','authenticated',true);
 caught:=false;
 begin perform public.reauthorise_handyman_bill(job_id,'pi_final');
 exception when others then caught:=true; end;
 if not caught then raise exception 'Private payment RPC accepted authenticated role'; end if;
 if has_table_privilege('authenticated','public.handyman_payment_attempts','SELECT')
  or has_function_privilege('authenticated',
   'public.finalize_handyman_attempt(uuid,uuid,text,text,integer,boolean,timestamptz)','EXECUTE') then
  raise exception 'Payment recovery exposes private authorisation history';
 end if;
end $test$;
rollback;
