begin;
-- Service-only storage. The server checks the feature switch AND membership.
create table public.handyman_jobs(
 id uuid primary key default gen_random_uuid(),customer_id uuid not null references public.profiles(id),provider_id uuid not null references public.providers(id),
 task_name text not null check(task_name in('Mounting and hanging','Furniture assembly','Minor repairs','Curtains and blinds','Furniture moving','Minor decorating')),
 description text not null check(length(description) between 10 and 2000),address text not null,postcode text not null,scheduled_at timestamptz not null,
 estimated_minutes integer not null check(estimated_minutes between 60 and 480 and estimated_minutes%30=0),
 hourly_rate_pence integer not null check(hourly_rate_pence between 100 and 100000),vat_bps integer not null check(vat_bps in(0,2000)),
 materials_budget_pence integer not null default 0 check(materials_budget_pence between 0 and 500000),held_pence integer not null,
 status text not null default 'checkout_pending' check(status in('checkout_pending','scheduled','in_progress','awaiting_customer','awaiting_authorization','payment_pending','cancel_pending','completed','cancelled')),
 checkout_session text unique,payment_intent text unique,previous_payment_intent text,transfer_ref text unique,
 started_at timestamptz,ended_at timestamptz,worked_minutes integer,bill jsonb,approved_at timestamptz,
 payment_claim_at timestamptz,last_payment_error text,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index handyman_jobs_provider_calendar on public.handyman_jobs(provider_id,scheduled_at,status);
create index handyman_jobs_customer on public.handyman_jobs(customer_id,created_at);
create table public.handyman_files(
 id uuid primary key default gen_random_uuid(),job_id uuid not null references public.handyman_jobs(id),kind text not null check(kind in('photo','receipt')),
 storage_path text not null unique,original_name text not null,mime_type text not null check(mime_type in('image/jpeg','image/png','application/pdf')),
 amount_pence integer check(amount_pence between 1 and 500000),decision text not null default 'pending' check(decision in('pending','approved','rejected')),decided_at timestamptz,
 uploaded_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),check(kind='photo' or amount_pence is not null)
);
create table public.handyman_reviews(job_id uuid primary key references public.handyman_jobs(id),rating integer not null check(rating between 1 and 5),comment text check(length(comment)<=2000),is_public boolean not null default false,reviewed_at timestamptz not null default now());
alter table public.handyman_jobs enable row level security;
alter table public.handyman_files enable row level security;
alter table public.handyman_reviews enable row level security;
revoke all on public.handyman_jobs,public.handyman_files,public.handyman_reviews from public,anon,authenticated;
grant all on public.handyman_jobs,public.handyman_files,public.handyman_reviews to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('handyman-job-files','handyman-job-files',false,4194304,array['image/jpeg','image/png','application/pdf']) on conflict(id) do nothing;

create or replace function public.handyman_bill(p_rate integer,p_minutes integer,p_vat integer,p_materials integer)
returns jsonb language plpgsql immutable set search_path=public as $fn$
declare labour integer; vat integer; fee integer;
begin
 if p_rate not between 100 and 100000 or p_minutes not between 0 and 960 or p_vat not in(0,2000) or p_materials not between 0 and 500000 then raise exception 'Invalid bill'; end if;
 labour:=round(p_rate::numeric*greatest(60,p_minutes)/60)::integer;vat:=round(labour::numeric*p_vat/10000)::integer;fee:=round(labour::numeric/5)::integer;
 return jsonb_build_object('billedMinutes',greatest(60,p_minutes),'labour',labour,'vat',vat,'materials',p_materials,'platform',fee,'gross',labour+vat+p_materials,'provider',labour+vat+p_materials-fee);
end $fn$;

create or replace function public.handyman_available(p_provider uuid,p_customer uuid,p_postcode text,p_slot timestamptz,p_minutes integer,p_exclude uuid default null)
returns boolean language plpgsql stable security definer set search_path=public as $fn$
declare p public.providers;s public.provider_profile_settings;local_start timestamp:=p_slot at time zone 'Europe/London';local_end timestamp:=(p_slot+make_interval(mins=>p_minutes)) at time zone 'Europe/London';day_minutes integer;
begin
 select * into p from public.providers where id=p_provider;
 if not found or p.profile_id=p_customer or p.vetting_status<>'approved' or not p.dbs_verified or p.is_suspended or not('handyman'=any(p.services)) or p.stripe_account_id is null or public.professional_verification_block(p.id) is not null then return false;end if;
 if exists(select 1 from(values('photo_id'),('public_liability_insurance')) required(type) where not exists(select 1 from public.provider_verification_items v join storage.objects o on o.bucket_id='provider-verification' and o.name=v.document_storage_path where v.provider_id=p.id and v.document_type=required.type and v.status='verified' and v.uploaded_at is not null and(v.expires_at is null or v.expires_at>=local_start::date) and(v.next_check_at is null or v.next_check_at>=local_start::date) and(required.type<>'public_liability_insurance' or v.expires_at is not null))) then return false;end if;
 -- Checks must remain current through the selected job date, not only today.
 if public.professional_verification_block(p.id,local_start::date) is not null then return false;end if;
 select * into s from public.provider_profile_settings where provider_id=p.id;
 if not found or not s.availability_configured or cardinality(s.coverage_postcodes)=0 or not exists(select 1 from unnest(s.coverage_postcodes) c where regexp_replace(upper(c),'\s','','g') in(regexp_replace(upper(p_postcode),'\s','','g'),regexp_replace(upper(split_part(p_postcode,' ',1)),'\s','','g'))) then return false;end if;
 if not s.accepts_same_day and local_start::date=(now() at time zone 'Europe/London')::date then return false;end if;
 if local_start::date<>local_end::date or local_start::time<'07:00' or local_end::time>'20:00' or not exists(select 1 from public.provider_availability a where a.provider_id=p.id and a.weekday=extract(dow from local_start)::integer and a.start_time<=local_start::time and a.end_time>=local_end::time) then return false;end if;
 if exists(select 1 from public.provider_time_off t where t.provider_id=p.id and t.starts_at<p_slot+make_interval(mins=>p_minutes) and t.ends_at>p_slot) then return false;end if;
 if exists(select 1 from public.bookings b where b.provider_id=p.id and b.status::text in('scheduled','in_progress','needs_review') and b.scheduled_at<p_slot+make_interval(mins=>p_minutes) and b.scheduled_at+make_interval(mins=>coalesce(b.duration_minutes,120))>p_slot) then return false;end if;
 if exists(select 1 from public.handyman_jobs j where j.provider_id=p.id and j.id is distinct from p_exclude and(j.status in('scheduled','in_progress','awaiting_customer','awaiting_authorization','payment_pending','cancel_pending') or(j.status='checkout_pending' and j.created_at>now()-interval '1 hour')) and j.scheduled_at<p_slot+make_interval(mins=>p_minutes) and j.scheduled_at+make_interval(mins=>j.estimated_minutes)>p_slot) then return false;end if;
 select coalesce(sum(minutes),0) into day_minutes from(select coalesce(b.duration_minutes,120) as minutes from public.bookings b where b.provider_id=p.id and b.status::text in('scheduled','in_progress','completed','needs_review') and(b.scheduled_at at time zone 'Europe/London')::date=local_start::date union all select j.estimated_minutes from public.handyman_jobs j where j.provider_id=p.id and j.id is distinct from p_exclude and(j.status in('scheduled','in_progress','awaiting_customer','awaiting_authorization','payment_pending','cancel_pending','completed') or(j.status='checkout_pending' and j.created_at>now()-interval '1 hour')) and(j.scheduled_at at time zone 'Europe/London')::date=local_start::date) daily;
 return day_minutes+p_minutes<=coalesce(s.max_daily_hours,8)*60;
end $fn$;

create or replace function public.reserve_handyman_job(p_customer uuid,p_provider uuid,p_task text,p_description text,p_address text,p_postcode text,p_slot timestamptz,p_minutes integer,p_materials integer)
returns public.handyman_jobs language plpgsql security definer set search_path=public as $fn$
declare j public.handyman_jobs;rate integer;vat integer;amount jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required';end if;
 perform 1 from public.profiles where id=p_customer and account_deleted_at is null for share;if not found then raise exception 'Customer account is unavailable';end if;
 perform 1 from public.profiles u join public.providers p on p.profile_id=u.id where p.id=p_provider and u.account_deleted_at is null for share of u;if not found then raise exception 'Professional account is unavailable';end if;
 perform pg_advisory_xact_lock(hashtextextended('professional-schedule:'||p_provider::text,0));
 if p_slot<now()+interval '2 hours' or p_slot>now()+interval '6 days' or not public.handyman_available(p_provider,p_customer,p_postcode,p_slot,p_minutes) then raise exception 'Professional is unavailable for this time';end if;
 if(select count(*) from public.handyman_jobs where customer_id=p_customer and created_at>now()-interval '1 day')>=10 then raise exception 'Too many booking requests today';end if;
 select hourly_rate_pence into rate from public.provider_task_rates where provider_id=p_provider and task_name=p_task;
 if rate is null then raise exception 'This task is not offered';end if;
 select case when nullif(vat_number,'') is null then 0 else 2000 end into vat from public.provider_profile_settings where provider_id=p_provider;
 amount:=public.handyman_bill(rate,p_minutes,vat,p_materials);
 insert into public.handyman_jobs(customer_id,provider_id,task_name,description,address,postcode,scheduled_at,estimated_minutes,hourly_rate_pence,vat_bps,materials_budget_pence,held_pence) values(p_customer,p_provider,p_task,p_description,p_address,p_postcode,p_slot,p_minutes,rate,vat,p_materials,(amount->>'gross')::integer) returning * into j;
 return j;
end $fn$;

create or replace function public.handyman_action(p_job uuid,p_user uuid,p_action text,p_file uuid default null,p_approve boolean default null)
returns public.handyman_jobs language plpgsql security definer set search_path=public as $fn$
declare j public.handyman_jobs;worker uuid;materials integer;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required';end if;
 select * into j from public.handyman_jobs where id=p_job for update;if not found then raise exception 'Job not found';end if;
 select profile_id into worker from public.providers where id=j.provider_id;
 if p_user is distinct from j.customer_id and p_user is distinct from worker then raise exception 'Job is private';end if;
 if p_action='cancel' then
  if j.status not in('checkout_pending','scheduled','cancel_pending') then raise exception 'An active or completed job cannot be cancelled through this action';end if;
  update public.handyman_jobs set status='cancel_pending' where id=j.id;
 elsif p_action='start' then
  if p_user is distinct from worker or j.status<>'scheduled' or now()<j.scheduled_at-interval '30 minutes' then raise exception 'Job cannot be started yet';end if;
  perform pg_advisory_xact_lock(hashtextextended('professional-work:'||j.provider_id::text,0));
  if exists(select 1 from public.handyman_jobs other where other.provider_id=j.provider_id and other.id<>j.id and other.status='in_progress') or exists(select 1 from public.bookings b where b.provider_id=j.provider_id and b.status::text='in_progress') then raise exception 'Professional already has work in progress';end if;
  update public.handyman_jobs set status='in_progress',started_at=clock_timestamp() where id=j.id;
 elsif p_action='finish' then
  if p_user is distinct from worker or j.status<>'in_progress' or j.started_at is null or now()<j.started_at then raise exception 'Job is not in progress';end if;
  if extract(epoch from(now()-j.started_at))/60>960 then raise exception 'Worked time needs support review';end if;
  update public.handyman_jobs set status='awaiting_customer',ended_at=clock_timestamp(),worked_minutes=ceil(extract(epoch from(clock_timestamp()-j.started_at))/60)::integer where id=j.id;
 elsif p_action='receipt' then
  if p_user is distinct from j.customer_id or j.status<>'awaiting_customer' or p_approve is null then raise exception 'Receipt decision is unavailable';end if;
  update public.handyman_files set decision=case when p_approve then 'approved' else 'rejected' end,decided_at=now() where id=p_file and job_id=j.id and kind='receipt';if not found then raise exception 'Receipt not found';end if;
 elsif p_action='approve_bill' then
  if p_user is distinct from j.customer_id or j.status<>'awaiting_customer' then raise exception 'Bill cannot be approved';end if;
  if exists(select 1 from public.handyman_files where job_id=j.id and kind='receipt' and decision='pending') then raise exception 'Approve or reject every receipt first';end if;
  select coalesce(sum(amount_pence),0) into materials from public.handyman_files where job_id=j.id and kind='receipt' and decision='approved';
  update public.handyman_jobs set bill=public.handyman_bill(j.hourly_rate_pence,j.worked_minutes,j.vat_bps,materials),approved_at=clock_timestamp(),status=case when(public.handyman_bill(j.hourly_rate_pence,j.worked_minutes,j.vat_bps,materials)->>'gross')::integer>j.held_pence then 'awaiting_authorization' else 'payment_pending' end where id=j.id;
 elsif p_action='claim_payment' then
  if p_user is distinct from j.customer_id or j.status<>'payment_pending' or(j.payment_claim_at is not null and j.payment_claim_at>now()-interval '2 minutes') then raise exception 'Payment is not ready or is already processing';end if;
  update public.handyman_jobs set payment_claim_at=clock_timestamp() where id=j.id;
 else raise exception 'Unsupported job action';end if;
 update public.handyman_jobs set updated_at=clock_timestamp() where id=j.id returning * into j;return j;
end $fn$;

-- Cleaning and handyman reservations share the same schedule lock.
create or replace function public.guard_cleaning_against_handyman_jobs()
returns trigger language plpgsql security definer set search_path=public as $fn$
declare day_minutes integer;maximum integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('professional-schedule:'||new.provider_id::text,0));
 if exists(select 1 from public.handyman_jobs j where j.provider_id=new.provider_id and(j.status in('scheduled','in_progress','awaiting_customer','awaiting_authorization','payment_pending','cancel_pending') or(j.status='checkout_pending' and j.created_at>now()-interval '1 hour')) and j.scheduled_at<new.scheduled_at+make_interval(mins=>coalesce(new.duration_minutes,120)) and j.scheduled_at+make_interval(mins=>j.estimated_minutes)>new.scheduled_at) then raise exception 'Professional has a handyman reservation at this time' using errcode='check_violation';end if;
 select coalesce(max_daily_hours,8)*60 into maximum from public.provider_profile_settings where provider_id=new.provider_id;
 select coalesce(sum(minutes),0) into day_minutes from(select coalesce(b.duration_minutes,120) minutes from public.bookings b where b.provider_id=new.provider_id and b.id<>new.id and b.status::text in('scheduled','in_progress','completed','needs_review') and(b.scheduled_at at time zone 'Europe/London')::date=(new.scheduled_at at time zone 'Europe/London')::date union all select j.estimated_minutes from public.handyman_jobs j where j.provider_id=new.provider_id and(j.status in('scheduled','in_progress','awaiting_customer','awaiting_authorization','payment_pending','cancel_pending','completed') or(j.status='checkout_pending' and j.created_at>now()-interval '1 hour')) and(j.scheduled_at at time zone 'Europe/London')::date=(new.scheduled_at at time zone 'Europe/London')::date) daily;
 if day_minutes+coalesce(new.duration_minutes,120)>coalesce(maximum,480) then raise exception 'Professional daily hours exceeded' using errcode='check_violation';end if;return new;
end $fn$;
create trigger handyman_calendar_cleaning_insert before insert on public.bookings for each row when(new.provider_id is not null and new.status::text='scheduled') execute function public.guard_cleaning_against_handyman_jobs();
create trigger handyman_calendar_cleaning_change before update of provider_id,scheduled_at,status on public.bookings for each row when(new.provider_id is not null and new.status::text='scheduled' and(old.status::text='offered' or new.provider_id is distinct from old.provider_id or new.scheduled_at is distinct from old.scheduled_at)) execute function public.guard_cleaning_against_handyman_jobs();

create or replace function public.add_handyman_file(p_job uuid,p_user uuid,p_kind text,p_path text,p_name text,p_mime text,p_amount integer default null)
returns uuid language plpgsql security definer set search_path=public as $fn$
declare j public.handyman_jobs;worker uuid;fid uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required';end if;
 select * into j from public.handyman_jobs where id=p_job for update;if not found then raise exception 'Job not found';end if;
 select profile_id into worker from public.providers where id=j.provider_id;
 if p_kind='photo' then
  if p_user is distinct from j.customer_id or j.status not in('checkout_pending','scheduled') or p_mime='application/pdf' or(select count(*) from public.handyman_files where job_id=j.id and kind='photo')>=8 then raise exception 'Job photos cannot be added';end if;
 elsif p_kind='receipt' then
  if p_user is distinct from worker or j.status not in('in_progress','awaiting_customer') or p_amount is null or(select count(*) from public.handyman_files where job_id=j.id and kind='receipt')>=20 or coalesce((select sum(amount_pence) from public.handyman_files where job_id=j.id and kind='receipt'),0)+p_amount>500000 then raise exception 'Receipt cannot be added';end if;
 else raise exception 'Unsupported file';end if;
 if not starts_with(p_path,j.id::text||'/') then raise exception 'Invalid file path';end if;
 insert into public.handyman_files(job_id,kind,storage_path,original_name,mime_type,amount_pence,uploaded_by) values(j.id,p_kind,p_path,left(p_name,200),p_mime,case when p_kind='receipt' then p_amount else null end,p_user) returning id into fid;return fid;
end $fn$;

create or replace function public.finalize_handyman_hold(p_job uuid,p_session text,p_intent text,p_amount integer,p_final boolean)
returns public.handyman_jobs language plpgsql security definer set search_path=public as $fn$
declare j public.handyman_jobs;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required';end if;
 select * into j from public.handyman_jobs where id=p_job for update;
 if not found or j.checkout_session is distinct from p_session then raise exception 'Checkout does not match job';end if;
 if j.payment_intent=p_intent then return j;end if;
 if p_final then
  if j.status<>'awaiting_authorization' or p_amount<>(j.bill->>'gross')::integer then raise exception 'Final hold does not match approved bill';end if;
 else
  perform pg_advisory_xact_lock(hashtextextended('professional-schedule:'||j.provider_id::text,0));
  if j.status<>'checkout_pending' or j.created_at<now()-interval '1 hour' or p_amount<>j.held_pence or not public.handyman_available(j.provider_id,j.customer_id,j.postcode,j.scheduled_at,j.estimated_minutes,j.id) then raise exception 'Reservation is no longer available; support must release this hold';end if;
 end if;
 update public.handyman_jobs set previous_payment_intent=case when p_final then payment_intent else null end,payment_intent=p_intent,held_pence=p_amount,status=case when p_final then 'payment_pending' else 'scheduled' end,updated_at=clock_timestamp() where id=j.id returning * into j;
 if not p_final then insert into public.notifications(user_id,title,body,href) select profile_id,'New handyman booking','A customer selected you for '||j.task_name||'. The card is held.','/handyman/jobs/'||j.id::text from public.providers where id=j.provider_id;end if;return j;
end $fn$;

create or replace function public.guard_handyman_approval()
returns trigger language plpgsql security definer set search_path=public as $fn$
begin
 if new.vetting_status='approved' and 'handyman'=any(new.services) and not exists(select 1 from public.provider_verification_items v join storage.objects o on o.bucket_id='provider-verification' and o.name=v.document_storage_path where v.provider_id=new.id and v.document_type='public_liability_insurance' and v.status='verified' and v.uploaded_at is not null and v.expires_at>=current_date) then raise exception 'Handyman public liability insurance must be verified before approval';end if;return new;
end $fn$;
create trigger handyman_approval before insert or update of vetting_status,services on public.providers for each row execute function public.guard_handyman_approval();

create or replace function public.apply_handyman_trade(p_user uuid,p_details jsonb)
returns uuid language plpgsql security definer set search_path=public as $fn$
declare pid uuid;item record;period jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required';end if;
 perform 1 from public.profiles where id=p_user for update;if not found then raise exception 'Account not found';end if;
 update public.profiles set full_name=p_details->>'legalName' where id=p_user;
 select id into pid from public.providers where profile_id=p_user;
 if pid is null then insert into public.providers(profile_id,display_name,services,vetting_status,show_on_our_pros) values(p_user,p_details->>'displayName',array['handyman'],'pending',false) returning id into pid;
 else update public.providers set services=(select array_agg(distinct skill) from unnest(services||array['handyman']) skill),vetting_status='pending' where id=pid;end if;
 update public.providers set bio=p_details->>'bio',years_experience=(p_details->>'yearsExperience')::integer where id=pid;
 insert into public.provider_onboarding_details(provider_id,resident_status,self_employed_confirmed,date_of_birth) values(pid,p_details->>'residentStatus',true,(p_details->>'dateOfBirth')::date) on conflict(provider_id) do update set resident_status=excluded.resident_status,date_of_birth=excluded.date_of_birth;
 insert into public.provider_profile_settings(provider_id,coverage_postcodes,max_travel_miles,max_daily_hours,accepts_same_day,brings_equipment,availability_configured) values(pid,array(select jsonb_array_elements_text(p_details->'coveragePostcodes')),(p_details->>'maxTravelMiles')::integer,(p_details->>'maxDailyHours')::integer,(p_details->>'acceptsSameDay')::boolean,(p_details->>'bringsEquipment')::boolean,true) on conflict(provider_id) do update set coverage_postcodes=excluded.coverage_postcodes,max_travel_miles=excluded.max_travel_miles,max_daily_hours=excluded.max_daily_hours,accepts_same_day=excluded.accepts_same_day,brings_equipment=excluded.brings_equipment,availability_configured=true;
 update public.provider_profile_settings set home_postcode=p_details->>'homePostcode' where provider_id=pid;
 delete from public.provider_task_rates where provider_id=pid;
 for item in select key,value from jsonb_each_text(p_details->'rates') loop insert into public.provider_task_rates(provider_id,task_name,hourly_rate_pence) values(pid,item.key,item.value::integer);end loop;
 delete from public.provider_availability where provider_id=pid;
 for period in select value from jsonb_array_elements(p_details->'availability') loop insert into public.provider_availability(provider_id,weekday,start_time,end_time) values(pid,(period->>'weekday')::integer,(period->>'start')::time,(period->>'end')::time);end loop;
 return pid;
end $fn$;

revoke all on function public.handyman_bill(integer,integer,integer,integer),public.handyman_available(uuid,uuid,text,timestamptz,integer,uuid),public.reserve_handyman_job(uuid,uuid,text,text,text,text,timestamptz,integer,integer),public.handyman_action(uuid,uuid,text,uuid,boolean),public.apply_handyman_trade(uuid,jsonb),public.guard_cleaning_against_handyman_jobs(),public.guard_handyman_approval() from public,anon,authenticated;
grant execute on function public.handyman_bill(integer,integer,integer,integer),public.handyman_available(uuid,uuid,text,timestamptz,integer,uuid),public.reserve_handyman_job(uuid,uuid,text,text,text,text,timestamptz,integer,integer),public.handyman_action(uuid,uuid,text,uuid,boolean),public.apply_handyman_trade(uuid,jsonb) to service_role;
revoke all on function public.add_handyman_file(uuid,uuid,text,text,text,text,integer),public.finalize_handyman_hold(uuid,text,text,integer,boolean) from public,anon,authenticated;
grant execute on function public.add_handyman_file(uuid,uuid,text,text,text,text,integer),public.finalize_handyman_hold(uuid,text,text,integer,boolean) to service_role;
create or replace function public.guard_cleaning_checkin_against_handyman()
returns trigger language plpgsql security definer set search_path=public as $fn$
begin
 perform pg_advisory_xact_lock(hashtextextended('professional-work:'||new.provider_id::text,0));
 if exists(select 1 from public.handyman_jobs j where j.provider_id=new.provider_id and j.status='in_progress') then raise exception 'Professional already has a handyman job in progress';end if;return new;
end $fn$;
create trigger handyman_cleaning_checkin before update of status on public.bookings for each row when(new.status::text='in_progress' and old.status::text<>'in_progress' and new.provider_id is not null) execute function public.guard_cleaning_checkin_against_handyman();
revoke all on function public.guard_cleaning_checkin_against_handyman() from public,anon,authenticated,service_role;

-- Extend the existing reviewed erasure transaction without deleting ledgers.
alter function public.prepare_account_erasure(uuid,text) rename to prepare_account_erasure_before_handyman;
revoke all on function public.prepare_account_erasure_before_handyman(uuid,text) from public,anon,authenticated,service_role;
create or replace function public.prepare_account_erasure(p_request_id uuid,p_retention_note text)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare target uuid;professional uuid;result jsonb;extra jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required';end if;
 select user_id into target from public.account_deletion_requests where id=p_request_id for update;
 perform 1 from public.profiles where id=target for update;select id into professional from public.providers where profile_id=target;
 perform 1 from public.handyman_jobs where customer_id=target or provider_id=professional for update;
 if exists(select 1 from public.handyman_jobs where(customer_id=target or provider_id=professional) and status not in('completed','cancelled')) then raise exception 'Resolve unfinished handyman jobs and card holds before erasure';end if;
 select coalesce(jsonb_agg(jsonb_build_object('bucket','handyman-job-files','path',f.storage_path)),'[]') into extra from public.handyman_files f join public.handyman_jobs j on j.id=f.job_id where(j.customer_id=target or j.provider_id=professional) and(f.kind='photo' or f.uploaded_by=target);
 result:=public.prepare_account_erasure_before_handyman(p_request_id,p_retention_note);
 update public.handyman_jobs set description='Deleted account',address='Deleted',postcode='Deleted' where customer_id=target;
 update public.handyman_reviews r set comment=null from public.handyman_jobs j where j.id=r.job_id and j.customer_id=target;
 update public.handyman_files f set original_name='Deleted file' from public.handyman_jobs j where j.id=f.job_id and(j.customer_id=target or j.provider_id=professional);
 update public.account_erasure_jobs set files=files||extra where request_id=p_request_id;
 return result||jsonb_build_object('files',(select files from public.account_erasure_jobs where request_id=p_request_id));
end $fn$;
revoke all on function public.prepare_account_erasure(uuid,text) from public,anon,authenticated;
grant execute on function public.prepare_account_erasure(uuid,text) to service_role;
commit;
