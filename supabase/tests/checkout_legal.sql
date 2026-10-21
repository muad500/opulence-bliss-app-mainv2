-- Empty local/CI database only. No hosted fixture bootstrap.
\set ON_ERROR_STOP on
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.role() returns text language sql stable as $$select coalesce(current_setting('test.role',true),'service_role')$$;
create function public.is_admin() returns boolean language sql stable as $$select current_setting('test.admin',true)='true'$$;
create table public.profiles(id uuid primary key,account_deleted_at timestamptz);
create table public.legal_documents(slug text primary key,title text,version text,updated_at timestamptz,content_html text,published boolean);
create table public.regular_booking_series(id uuid primary key,checkout_session_id text);
create table public.bookings(id uuid primary key default gen_random_uuid(),customer_id uuid,checkout_session_id text,regular_series_id uuid);
create table public.booking_checkout_time_choices(checkout_session_id text primary key,customer_id uuid);
create table public.account_legal_acceptances(id bigint generated always as identity primary key,user_id uuid not null,document_slug text not null,version text not null,accepted_at timestamptz not null default now(),unique(user_id,document_slug,version));
\ir ../migrations/20261021000200_checkout_legal_acceptance.sql
create function public.test_assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAILED: %',label;end if;end$$;
select public.test_assert(not public.checkout_legal_consent_ready(),'phase A leaves new checkout blocked until writer deployment');
insert into public.profiles(id) values('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002');
-- Both old and new professional signup writers work during phase A.
insert into public.account_legal_acceptances(user_id,document_slug,version) values('10000000-0000-4000-8000-000000000001','professional-partner-agreement','1.0') on conflict(user_id,document_slug,version) do update set accepted_at=excluded.accepted_at;
insert into public.account_legal_acceptances(user_id,document_slug,version) values('10000000-0000-4000-8000-000000000001','professional-partner-agreement','1.0') on conflict(user_id,document_slug,version,booking_id) do update set accepted_at=excluded.accepted_at;
\ir ../migrations/20261021000300_activate_checkout_legal_acceptance.sql
select public.test_assert(public.checkout_legal_consent_ready(),'phase B activates new checkout');
insert into public.legal_documents select slug,slug,'2.0','2026-10-21T00:00:00Z','<p>Test policy</p>',true from unnest(array['terms','cancellation-refund','privacy']) slug;
do $$
declare uid uuid:='10000000-0000-4000-8000-000000000001'; docs jsonb; evidence uuid; series uuid:=gen_random_uuid(); b uuid; i integer; caught boolean:=false;
begin
 select jsonb_agg(jsonb_build_object('slug',slug,'version',version,'updatedAt',updated_at)) into docs from public.legal_documents;
 evidence:=public.prepare_booking_legal_consent(uid,docs);
 insert into public.booking_checkout_time_choices values('cs_test_single',uid,evidence,true);
 insert into public.bookings(customer_id,checkout_session_id) values(uid,'cs_test_single') returning id into b;
 perform public.test_assert((select count(*)=3 from public.account_legal_acceptances where booking_id=b),'one-off has exactly 3 document acceptances');
 perform public.test_assert((select bool_and(a.accepted_at=c.accepted_at and a.version='2.0' and a.user_id=uid) from public.account_legal_acceptances a join public.booking_checkout_legal_consents c on c.id=a.checkout_legal_consent_id where a.booking_id=b),'identity, exact versions and server timestamp preserved');
 evidence:=public.prepare_booking_legal_consent(uid,docs);
 insert into public.booking_checkout_time_choices values('cs_test_regular',uid,evidence,true);
 insert into public.regular_booking_series values(series,'cs_test_regular');
 for i in 1..6 loop insert into public.bookings(customer_id,checkout_session_id,regular_series_id) values(uid,case when i=1 then 'cs_test_regular' else null end,series);end loop;
 perform public.test_assert((select count(*)=18 from public.account_legal_acceptances a join public.bookings b on b.id=a.booking_id where b.regular_series_id=series),'six regular visits each have 3 acceptances');
 perform public.test_assert((select count(distinct accepted_at)=1 from public.account_legal_acceptances where checkout_legal_consent_id=evidence),'regular series shares one explicit acceptance time');
 insert into public.bookings(id,customer_id,checkout_session_id) values(b,uid,'cs_test_single') on conflict(id) do nothing;
 perform public.test_assert((select count(*)=3 from public.account_legal_acceptances where booking_id=b),'webhook retries do not duplicate evidence');
 insert into public.bookings(customer_id,checkout_session_id) values(uid,'cs_preexisting') returning id into b;
 perform public.test_assert((select count(*)=0 from public.account_legal_acceptances where booking_id=b),'old checkout unchanged, no invented evidence');
 update public.legal_documents set version='1.0',updated_at='2026-10-22T00:00:00Z';
 begin perform public.prepare_booking_legal_consent(uid,docs);exception when serialization_failure then caught:=true;end;
 perform public.test_assert(caught,'stale client cannot accept old version');
 select jsonb_agg(jsonb_build_object('slug',slug,'version',version,'updatedAt',updated_at)) into docs from public.legal_documents;
 evidence:=public.prepare_booking_legal_consent(uid,docs);
 perform public.test_assert((select bool_and(item->>'version'='1.0') from public.booking_checkout_legal_consents c,jsonb_array_elements(c.documents) item where c.id=evidence),'final 1.0 policies picked up without code change');
 update public.legal_documents set published=false where slug='privacy';caught:=false;
 begin perform public.prepare_booking_legal_consent(uid,docs);exception when serialization_failure then caught:=true;end;
 perform public.test_assert(caught,'unpublished document blocks checkout');
 -- A forged user association rolls the entire booking insert back.
 insert into public.booking_checkout_time_choices values('cs_forged','10000000-0000-4000-8000-000000000002',evidence,true);caught:=false;
 begin insert into public.bookings(customer_id,checkout_session_id) values('10000000-0000-4000-8000-000000000002','cs_forged');exception when no_data_found then caught:=true;end;
 perform public.test_assert(caught and not exists(select 1 from public.bookings where checkout_session_id='cs_forged'),'no cross-user acceptance or partial booking');
end;
$$;
-- Production may have no Terms row: the trusted server supplies the exact
-- built-in public document, without inserting or modifying legal documents.
do $$
declare uid uuid:='10000000-0000-4000-8000-000000000001'; docs jsonb; fallback jsonb; evidence uuid;
begin
 delete from public.legal_documents where slug='terms';
 update public.legal_documents set published=true;
 fallback:=jsonb_build_array(jsonb_build_object('slug','terms','title','Customer Terms & Conditions','version','2.0','updatedAt',null,'isFallback',true,'contentHash','test-built-in-hash'));
 select jsonb_agg(jsonb_build_object('slug',slug,'version',version,'updatedAt',updated_at)) into docs from public.legal_documents;
 docs:=docs||jsonb_build_array(jsonb_build_object('slug','terms','version','2.0','updatedAt',null,'isFallback',true));
 evidence:=public.prepare_booking_legal_consent(uid,docs,fallback);
 perform public.test_assert((select count(*)=0 from public.legal_documents where slug='terms'),'fallback does not publish a Terms record');
 perform public.test_assert((select count(*)=1 from public.booking_checkout_legal_consents c,jsonb_array_elements(c.documents) item where c.id=evidence and item->>'slug'='terms' and item->>'version'='2.0' and (item->>'isFallback')::boolean),'built-in public Terms version retained in snapshot');
end;
$$;
select public.test_assert(not has_function_privilege('authenticated','public.prepare_booking_legal_consent(uuid,jsonb,jsonb)','EXECUTE'),'client cannot forge server acceptance');
select public.test_assert(not has_table_privilege('authenticated','public.booking_checkout_legal_consents','SELECT'),'prepared evidence private');
select 'Checkout legal SQL contracts passed' as result;
