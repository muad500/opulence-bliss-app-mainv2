-- Standalone isolated PostgreSQL fixture. No Supabase or Stripe credentials.
\set ON_ERROR_STOP on
do $$declare role_name text;begin foreach role_name in array array['anon','authenticated','service_role'] loop
 if not exists(select 1 from pg_roles where rolname=role_name) then execute format('create role %I',role_name);end if;
end loop;end$$;
create schema auth; create schema storage;
create function auth.role() returns text language sql stable as $$select coalesce(current_setting('test.auth_role',true),'service_role')$$;
create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
create table public.profiles(id uuid primary key,role text default 'customer',account_deleted_at timestamptz,postcode text);
create table public.providers(id uuid primary key,profile_id uuid references public.profiles(id),vetting_status text default 'approved',dbs_verified boolean default true,
 is_suspended boolean default false,show_on_our_pros boolean default true,services text[] default '{handyman}',stripe_account_id text,service_approvals jsonb default '{"handyman":"approved"}');
create table public.provider_profile_settings(provider_id uuid primary key,maintenance_tasks text[] default '{Furniture assembly}',coverage_postcodes text[] default '{E14}',home_postcode text,
 availability_configured boolean default true,accepts_same_day boolean default true,max_daily_hours integer default 8,max_travel_miles integer,brings_equipment boolean,vat_number text);
create table public.provider_verification_items(provider_id uuid,document_type text,status text,uploaded_at timestamptz default now(),document_storage_path text,expires_at date,next_check_at date);
create table storage.objects(bucket_id text,name text);
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit integer,allowed_mime_types text[]);
create table public.provider_availability(provider_id uuid,weekday integer,start_time time,end_time time);
create table public.provider_time_off(provider_id uuid,starts_at timestamptz,ends_at timestamptz);
create table public.bookings(id uuid primary key default gen_random_uuid(),customer_id uuid,provider_id uuid,status text,scheduled_at timestamptz,duration_minutes integer);
create table public.notifications(user_id uuid,title text,body text,href text);
create table public.reviews(id uuid,booking_id uuid,reviewer text,rating integer);
create function public.public_eligible_provider_ids() returns table(id uuid) language sql as $$select id from public.providers where vetting_status='approved' and dbs_verified and not is_suspended$$;
create function public.review_professional_service_before_client_documents(p_provider uuid,p_service text,p_status text,p_reason text default null)
returns void language plpgsql as $$begin
 if not exists (select 1 from public.provider_task_rates where provider_id = p_provider) then
  raise exception 'Set at least one handyman task and hourly rate';
 end if;
end$$;
create table public.account_deletion_requests(id uuid primary key,user_id uuid);
create table public.provider_task_rates(provider_id uuid,task_name text,hourly_rate_pence integer);
create table public.provider_onboarding_details(provider_id uuid primary key,resident_status text,self_employed_confirmed boolean,date_of_birth date);
create function public.professional_verification_block(uuid,date default current_date) returns text language sql stable as $$select null::text$$;
create function public.prepare_account_erasure(uuid,text) returns jsonb language sql as $$select '{}'::jsonb$$;
create function public.provider_service_approved(p uuid,s text) returns boolean language sql stable as $$
 select exists(select 1 from public.providers where id=p and vetting_status='approved' and not is_suspended and service_approvals->>s='approved');$$;
create function public._offer_outcode(text) returns text language sql immutable as $$select split_part(upper($1),' ',1)$$;
create table public.customer_favourite_providers(user_id uuid,provider_id uuid);
create table public.legal_documents(slug text primary key,published boolean,version text);
insert into public.legal_documents values('handyman-terms',true,'2026-09-28');
create table public.cleaning_billing_settings(id integer,terms jsonb);
insert into public.cleaning_billing_settings values(1,'{"cancellationRefundPercent":{"full":100,"three_quarter":75,"half":50,"none":0}}');
create table public.offer_geo_outcodes(outcode text primary key,latitude float8,longitude float8);
create table public.job_offer_settings(id boolean,first_wave_size integer,second_wave_after_minutes integer);
insert into public.job_offer_settings values(true,5,10);
\ir ../migrations/20261003001700_disabled_handyman_marketplace.sql
\ir ../migrations/20261003001800_handyman_booking_terms_snapshot.sql
\ir ../migrations/20261003001900_handyman_worked_hours_capacity.sql
-- Replaced by per-service approval in 20261010000100 on staging.
drop trigger handyman_approval on public.providers;
\ir ../migrations/20261020000200_handyman_quote_marketplace.sql

create function public.test_assert(ok boolean,message text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAILED: %',message;end if;end$$;
create function public.test_paid(p_job uuid,p_key text)
returns void language plpgsql as $$declare o public.handyman_quote_operations;begin
 select * into o from public.handyman_quote_operations where job_id=p_job and kind='charge' and status='queued' order by created_at desc limit 1;
 o:=public.handyman_claim_operation(o.id,'{}');
 perform public.handyman_record_operation(o.id,o.claim_token,'succeeded','cs_'||p_key,'pi_'||p_key,'ch_'||p_key);
end$$;

insert into public.profiles(id,role,postcode) values
 ('00000000-0000-0000-0000-000000000001','customer','E14 1AA'),
 ('00000000-0000-0000-0000-000000000002','provider','E14 1AA'),
 ('00000000-0000-0000-0000-000000000003','provider','E14 1AA'),
 ('00000000-0000-0000-0000-000000000004','admin','E14 1AA');
insert into public.providers(id,profile_id,stripe_account_id) values
 ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000002','acct_own_a'),
 ('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000003','acct_own_b'),
 ('00000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000001','acct_self');
insert into public.provider_profile_settings(provider_id,home_postcode) select id,'E14 1AA' from public.providers;
insert into public.provider_availability select id,day,'07:00','20:00' from public.providers cross join generate_series(0,6) day;
insert into storage.objects select 'provider-verification',id::text||'/'||kind from public.providers cross join unnest(array['photo_id','public_liability_insurance','trade_certificate']) kind;
insert into public.provider_verification_items(provider_id,document_type,status,document_storage_path,expires_at)
 select id,kind,'verified',id::text||'/'||kind,current_date+400 from public.providers cross join unnest(array['photo_id','public_liability_insurance','trade_certificate']) kind;
insert into public.offer_geo_outcodes values('E14',51.5,-0.01);
insert into public.customer_favourite_providers values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000012');

do $test$
declare customer uuid:='00000000-0000-0000-0000-000000000001';worker uuid:='00000000-0000-0000-0000-000000000002';worker2 uuid:='00000000-0000-0000-0000-000000000003';
 a uuid:='00000000-0000-0000-0000-000000000011';b uuid:='00000000-0000-0000-0000-000000000012';
 j public.handyman_jobs;other public.handyman_jobs;q public.handyman_quotes;r public.handyman_quotes;o public.handyman_quote_operations;before integer;slot timestamptz;result jsonb;caught boolean;
begin
 slot:=((current_date+5)::text||' 10:00 Europe/London')::timestamptz;
 perform public.test_assert(not public.handyman_category_open('Plumbing'),'new categories stay hidden despite old published Terms');
 j:=public.handyman_post_job(customer,gen_random_uuid(),'Furniture assembly','Assemble a wooden bookcase','E14 1AA',array[current_date+5]);
 other:=public.handyman_post_job(customer,j.request_key,j.task_name,j.description,j.postcode,j.preferred_dates);
 perform public.test_assert(j.id=other.id and j.total_pence=0 and j.provider_id is null and j.hourly_rate_pence is null,'post is price-free and retry-safe');
 perform public.handyman_quote_command(j.id,customer,'publish');
 perform public.handyman_quote_command(j.id,customer,'publish');
 perform public.test_assert((select count(*) from public.handyman_invitations where job_id=j.id)=2,'exclude self-booking provider');
 perform public.test_assert((select count(*) from public.notifications)=2,'notifications deduplicated');
 perform public.test_assert((select provider_id from public.handyman_invitations where job_id=j.id order by rank_position limit 1)=b,'customer loyalty ranks first');
 update public.providers set is_suspended=true where id=a;
 perform public.test_assert(not public.handyman_quote_eligible(a,j.id),'suspension blocks quote eligibility');
 update public.providers set is_suspended=false where id=a;
 update public.provider_verification_items set expires_at=current_date-1 where provider_id=a and document_type='trade_certificate';
 perform public.test_assert(not public.handyman_quote_eligible(a,j.id),'expired certification blocks quotes');
 update public.provider_verification_items set expires_at=current_date+400 where provider_id=a;
 result:=public.handyman_quote_command(j.id,worker,'quote',jsonb_build_object('requestKey',gen_random_uuid(),'totalPence',12500,'scope','Bookcase assembly including every material','durationMinutes',120,'earliestAt',slot));
 select * into q from public.handyman_quotes where id=(result->>'id')::uuid;
 result:=public.handyman_quote_command(j.id,worker2,'quote',jsonb_build_object('requestKey',gen_random_uuid(),'totalPence',13000,'scope','Fixed price including assembly and all materials','durationMinutes',120,'earliestAt',slot));
 select * into r from public.handyman_quotes where id=(result->>'id')::uuid;
 perform public.handyman_quote_command(j.id,customer,'accept',jsonb_build_object('quoteId',q.id,'address','1 Test Road','termsVersion','2026-09-28'));
 begin perform public.handyman_quote_command(j.id,customer,'accept',jsonb_build_object('quoteId',r.id,'address','1 Test Road','termsVersion','2026-09-28'));caught:=false;exception when others then caught:=true;end;
 perform public.test_assert(caught,'a second acceptance loses the race');
 perform public.handyman_quote_command(j.id,customer,'accept',jsonb_build_object('quoteId',q.id));
 select * into j from public.handyman_jobs where id=j.id;
 perform public.test_assert(j.status='checkout_pending' and j.total_pence=12500 and j.commission_bps=2000 and j.vat_bps=0,'accepted fixed total and commission snapshot');
 perform public.test_assert((select count(*) from public.handyman_quote_operations where job_id=j.id)=1,'acceptance retries cannot double-charge');
 update public.handyman_quote_settings set commission_bps=3000;
 perform public.test_paid(j.id,'first');
 select * into j from public.handyman_jobs where id=j.id;
 perform public.test_assert(j.status='scheduled' and j.paid_pence=12500 and j.commission_bps=2000,'full payment schedules job, old fee unchanged');
 -- Start at the scheduled time without relying on wall-clock sleeps.
 update public.handyman_jobs set scheduled_at=now()-interval '10 minutes' where id=j.id;
 perform public.handyman_quote_command(j.id,worker,'start');
 -- Preserve a valid reserved daytime slot while testing revisions independent
 -- of the actual UTC hour at which this fixture is executed.
 update public.handyman_jobs set scheduled_at=slot where id=j.id;
 result:=public.handyman_quote_command(j.id,worker,'revision',jsonb_build_object('requestKey',gen_random_uuid(),'totalPence',15000,'scope','Bookcase assembly and additional fixed shelf materials','durationMinutes',120,'earliestAt',slot));
 perform public.handyman_quote_command(j.id,customer,'accept_revision',jsonb_build_object('quoteId',result->>'id'));
 perform public.test_assert((select amount_pence from public.handyman_quote_operations where job_id=j.id and kind='charge' and status='queued')=2500,'scope increase charges only difference');
 perform public.test_paid(j.id,'revision');
 select * into j from public.handyman_jobs where id=j.id;
 perform public.test_assert(j.status='in_progress' and j.total_pence=15000 and j.paid_pence=15000,'scope takes effect only after payment');
 result:=public.handyman_quote_command(j.id,worker,'revision',jsonb_build_object('requestKey',gen_random_uuid(),'totalPence',10000,'scope','Reduced fixed scope including the final materials','durationMinutes',120,'earliestAt',slot));
 perform public.handyman_quote_command(j.id,customer,'accept_revision',jsonb_build_object('quoteId',result->>'id'));
 perform public.test_assert((select sum(amount_pence) from public.handyman_quote_operations where job_id=j.id and kind='refund')=5000,'decrease refunds difference across both funding charges');
 for o in select * from public.handyman_quote_operations where job_id=j.id and kind='refund' order by id loop
  o:=public.handyman_claim_operation(o.id);perform public.handyman_record_operation(o.id,o.claim_token,'succeeded','re_'||o.id);
 end loop;
 select * into j from public.handyman_jobs where id=j.id;
 perform public.test_assert(j.status='in_progress' and j.total_pence=10000 and j.refunded_pence=5000,'refunds reconcile before revised scope applies');
 perform public.handyman_quote_command(j.id,worker,'finish');
 perform public.handyman_quote_maintenance();
 perform public.test_assert((select status from public.handyman_jobs where id=j.id)='awaiting_customer','no premature automatic confirmation');
 update public.handyman_jobs set confirm_after=now()-interval '1 second' where id=j.id;
 perform public.handyman_quote_maintenance();
 perform public.test_assert((select status from public.handyman_jobs where id=j.id)='payment_pending','automatic completion after 48-hour deadline');
 perform public.test_assert((select sum(amount_pence) from public.handyman_quote_operations where job_id=j.id and kind='transfer')=8000,'payout is quote less 20 percent including materials');
 update public.providers set stripe_account_id=null where id=a;
 select * into o from public.handyman_quote_operations where job_id=j.id and kind='transfer' limit 1;
 o:=public.handyman_claim_operation(o.id);
 perform public.test_assert(o.status='held' and o.last_error='Provider payout account is not configured','missing own payout account is held');
 update public.providers set stripe_account_id='acct_own_a' where id=a;
 for o in select * from public.handyman_quote_operations where job_id=j.id and kind='transfer' order by id loop
  o:=public.handyman_claim_operation(o.id);perform public.handyman_record_operation(o.id,o.claim_token,'succeeded','tr_'||o.id);
  perform public.handyman_record_operation(o.id,o.claim_token,'succeeded','tr_'||o.id);
 end loop;
 perform public.test_assert((select status from public.handyman_jobs where id=j.id)='completed','recorded payout finalises once');
 perform public.test_assert(not has_function_privilege('authenticated','public.handyman_quote_command(uuid,uuid,text,jsonb)','execute'),'authenticated cannot impersonate financial commands');
 perform public.test_assert(not has_table_privilege('anon','public.handyman_quotes','select'),'rivals and anonymous cannot read private quotes');
 raise notice 'PASS: quote post, ranking, self-booking, checks, selection race, full payment, scope differences, 48h confirmation, fee snapshot, own-account holds, idempotency and grants';
end $test$;

-- Used by the separate two-connection PostgreSQL concurrency regression.
create table public.test_handyman_quote_race(job_id uuid,quote_a uuid,quote_b uuid,customer_id uuid);
do $$
declare j public.handyman_jobs;qa jsonb;qb jsonb;slot timestamptz:=((current_date+30)::text||' 10:00 Europe/London')::timestamptz;
 customer uuid:='00000000-0000-0000-0000-000000000001';
begin
 j:=public.handyman_post_job(customer,gen_random_uuid(),'Furniture assembly','Concurrent acceptance synthetic fixture','E14 1AA',array[current_date+30]);
 perform public.handyman_quote_command(j.id,customer,'publish');
 qa:=public.handyman_quote_command(j.id,'00000000-0000-0000-0000-000000000002','quote',jsonb_build_object('requestKey',gen_random_uuid(),'totalPence',10000,'scope','First fixed quote with materials included','durationMinutes',120,'earliestAt',slot));
 qb:=public.handyman_quote_command(j.id,'00000000-0000-0000-0000-000000000003','quote',jsonb_build_object('requestKey',gen_random_uuid(),'totalPence',11000,'scope','Second fixed quote with materials included','durationMinutes',120,'earliestAt',slot));
 insert into public.test_handyman_quote_race values(j.id,(qa->>'id')::uuid,(qb->>'id')::uuid,customer);
end$$;

create function public.test_quote_job(p_day integer,p_total integer)
returns uuid language plpgsql as $$
declare customer uuid:='00000000-0000-0000-0000-000000000001';worker uuid:='00000000-0000-0000-0000-000000000002';
 j public.handyman_jobs;r jsonb;
begin
 j:=public.handyman_post_job(customer,gen_random_uuid(),'Furniture assembly','Assemble the agreed furniture including materials','E14 1AA',array[current_date+p_day]);
 perform public.handyman_quote_command(j.id,customer,'publish');
 r:=public.handyman_quote_command(j.id,worker,'quote',jsonb_build_object('requestKey',gen_random_uuid(),'totalPence',p_total,'scope','Fixed assembly quote including all materials','durationMinutes',120,'earliestAt',((current_date+p_day)::text||' 10:00 Europe/London')::timestamptz));
 perform public.handyman_quote_command(j.id,customer,'accept',jsonb_build_object('quoteId',r->>'id','address','1 Test Road','termsVersion','2026-09-28'));
 return j.id;
end$$;
do $test$
declare customer uuid:='00000000-0000-0000-0000-000000000001';worker uuid:='00000000-0000-0000-0000-000000000002';
 admin uuid:='00000000-0000-0000-0000-000000000004';a uuid:='00000000-0000-0000-0000-000000000011';
 j uuid;old uuid;d uuid;r jsonb;q uuid;o public.handyman_quote_operations;caught boolean;draft public.handyman_jobs;
begin
 update public.handyman_quote_settings set commission_bps=2000;
 j:=public.test_quote_job(10,10000);perform public.test_paid(j,'cancel_full');
 perform public.handyman_quote_command(j,customer,'cancel');
 perform public.test_assert((select sum(amount_pence) from public.handyman_quote_operations where job_id=j and kind='refund')=10000,'48+ hour cancellation uses full refund');
 for o in select * from public.handyman_quote_operations where job_id=j and kind='refund' loop
  o:=public.handyman_claim_operation(o.id);perform public.handyman_record_operation(o.id,o.claim_token,'succeeded','re_'||o.id);
 end loop;
 perform public.test_assert((select status from public.handyman_jobs where id=j)='cancelled','refund completes cancellation');
 perform public.test_assert(not exists(select 1 from public.handyman_quote_operations where job_id=j and kind='transfer'),'no payout for cancelled work');

 j:=public.test_quote_job(11,10000);perform public.test_paid(j,'cancel_band');
 update public.cleaning_billing_settings set terms='{"cancellationRefundPercent":{"full":90,"three_quarter":60,"half":25,"none":0}}';
 update public.handyman_jobs set scheduled_at=now()+interval '36 hours' where id=j;
 perform public.handyman_quote_command(j,customer,'cancel');
 perform public.test_assert((select sum(amount_pence) from public.handyman_quote_operations where job_id=j and kind='refund')=7500,'existing job keeps agreed cleaning refund bands after an edit');

 j:=public.test_quote_job(12,10000);perform public.test_paid(j,'new_band');
 update public.handyman_jobs set scheduled_at=now()+interval '36 hours' where id=j;
 perform public.handyman_quote_command(j,customer,'cancel');
 perform public.test_assert((select sum(amount_pence) from public.handyman_quote_operations where job_id=j and kind='refund')=6000,'new job uses edited cleaning refund bands');

 j:=public.test_quote_job(13,10000);
 perform public.handyman_quote_command(j,customer,'cancel');
 perform public.test_paid(j,'cancel_race');
 perform public.test_assert((select sum(amount_pence) from public.handyman_quote_operations where job_id=j and kind='refund')=10000,'late success racing cancellation queues a full refund');

 j:=public.test_quote_job(14,10000);
 update public.handyman_jobs set created_at=now()-interval '2 days' where id=j;
 begin insert into public.bookings(customer_id,provider_id,status,scheduled_at,duration_minutes)
  select customer,a,'scheduled',scheduled_at,120 from public.handyman_jobs where id=j;
  caught:=false;exception when others then caught:=true;end;
 perform public.test_assert(caught,'old posted request still reserves its newly accepted quote while unpaid');
 update public.handyman_jobs set quote_reserved_until=now()-interval '1 second' where id=j;
 perform public.handyman_quote_maintenance();
 perform public.test_assert((select status from public.handyman_jobs where id=j)='cancel_pending','abandoned checkout expires safely before releasing capacity');

 select id into old from public.handyman_jobs where status='completed' order by created_at limit 1;
 perform public.handyman_quote_command(old,customer,'dispute','{"reason":"Customer reports incomplete work and asks for review"}');
 select id into d from public.handyman_disputes where job_id=old and status='open';
 perform public.handyman_quote_maintenance();
 perform public.test_assert((select status from public.handyman_jobs where id=old)='disputed','automatic completion cannot bypass a dispute');
 perform public.handyman_resolve_dispute(d,admin,2000,'Reviewed the work and approved a partial refund of twenty pounds');
 select * into o from public.handyman_quote_operations where job_id=old and kind='refund' and status='queued' limit 1;
 begin perform public.handyman_claim_operation(o.id);caught:=false;exception when others then caught:=true;end;
 perform public.test_assert(caught,'refund waits for reversal of an already paid professional');
 for o in select * from public.handyman_quote_operations where job_id=old and kind='reversal' and status='queued' loop
  o:=public.handyman_claim_operation(o.id);perform public.handyman_record_operation(o.id,o.claim_token,'succeeded','trr_'||o.id);
 end loop;
 for o in select * from public.handyman_quote_operations where job_id=old and kind='refund' and status='queued' loop
  o:=public.handyman_claim_operation(o.id);perform public.handyman_record_operation(o.id,o.claim_token,'succeeded','re_'||o.id);
 end loop;
 for o in select * from public.handyman_quote_operations where job_id=old and kind='transfer' and status='queued' loop
  o:=public.handyman_claim_operation(o.id);perform public.handyman_record_operation(o.id,o.claim_token,'succeeded','tr_'||o.id);
 end loop;
 perform public.test_assert((select bill->>'provider' from public.handyman_jobs where id=old)='6400','admin partial refund reconciles reversal, refund and remaining payout');

 draft:=public.handyman_post_job(customer,gen_random_uuid(),'Furniture assembly','Inspect furniture for a free site visit','E14 1AA',array[current_date+20]);
 j:=draft.id;
 perform public.handyman_quote_command(j,customer,'publish');
 r:=public.handyman_quote_command(j,worker,'site_visit',jsonb_build_object('requestKey',gen_random_uuid(),'scope','Free visit to inspect the assembly work','durationMinutes',60,'earliestAt',((current_date+20)::text||' 10:00 Europe/London')::timestamptz));
 q:=(r->>'id')::uuid;
 perform public.handyman_quote_command(j,customer,'accept_visit',jsonb_build_object('quoteId',q,'address','2 Test Road'));
 perform public.test_assert(not exists(select 1 from public.handyman_quote_operations where job_id=j),'free visits do not create a charge');
 begin insert into public.bookings(customer_id,provider_id,status,scheduled_at,duration_minutes)
  values(customer,a,'scheduled',((current_date+20)::text||' 10:00 Europe/London')::timestamptz,60);
  caught:=false;exception when others then caught:=true;end;
 perform public.test_assert(caught,'free site visit blocks overlapping cleaning work');
 perform public.handyman_quote_command(j,customer,'cancel');
 perform public.handyman_quote_maintenance();
 perform public.test_assert((select status from public.handyman_site_visits where quote_id=q)='cancelled','cancelling request cancels free visits');
 raise notice 'PASS: cancellation snapshots and edited bands, cancel/payment race, abandoned checkouts, cross-service reservation, dispute lock, admin refund/reversal and free site visits';
end $test$;
