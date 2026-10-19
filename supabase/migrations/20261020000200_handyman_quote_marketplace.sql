-- I2: quote-only property maintenance. No environment switches or legal wording
-- are published here. Old financial history is retained for reconciliation only.
begin;

alter table public.handyman_jobs
  add column quote_mode boolean not null default false,
  add column request_key uuid,
  add column preferred_dates date[] not null default '{}',
  add column selected_quote_id uuid,
  add column pending_quote_id uuid,
  add column total_pence integer not null default 0 check(total_pence between 0 and 1000000),
  add column paid_pence integer not null default 0,
  add column refunded_pence integer not null default 0,
  add column commission_bps integer check(commission_bps between 0 and 5000),
  add column refund_bands jsonb,
  add column terms_version text,
  add column confirm_after timestamptz,
  add column quote_reserved_until timestamptz,
  add column cancel_refund_percent integer,
  add column payout_round integer not null default 0,
  alter column provider_id drop not null,
  alter column scheduled_at drop not null,
  alter column estimated_minutes drop not null,
  alter column hourly_rate_pence drop not null,
  alter column payout_account_id drop not null,
  alter column held_pence set default 0,
  alter column vat_bps set default 0,
  alter column address set default '';
alter table public.handyman_jobs drop constraint handyman_jobs_status_check;
alter table public.handyman_jobs add constraint handyman_jobs_status_check check(status in(
  'draft','posted','checkout_pending','scheduled','in_progress','awaiting_customer',
  'revision_pending','awaiting_authorization','payment_pending','cancel_pending','disputed','completed','cancelled'));
alter table public.handyman_jobs drop constraint handyman_jobs_task_name_check;
alter table public.handyman_jobs add constraint handyman_jobs_task_name_check check(task_name in(
  'Mounting and hanging','Furniture assembly','Minor repairs','Curtains and blinds','Furniture moving','Minor decorating',
  'Plumbing','Bathroom installations','Kitchen installations','Emergency repairs'));
alter table public.handyman_jobs add constraint handyman_quote_no_hourly_price check(
  not quote_mode or (hourly_rate_pence is null and vat_bps = 0 and materials_budget_pence = 0));
create unique index handyman_post_retry on public.handyman_jobs(customer_id,request_key) where quote_mode;

create table public.handyman_quote_settings(
  id boolean primary key default true check(id), commission_bps integer not null default 2000 check(commission_bps between 0 and 5000),
  version integer not null default 1, updated_by uuid references public.profiles(id), updated_at timestamptz not null default now()
);
insert into public.handyman_quote_settings(id) values(true);
create table public.handyman_categories(
  name text primary key, position integer not null unique, required_terms_version text,
  certificate_required boolean not null default true
);
insert into public.handyman_categories(name,position) values
 ('Mounting and hanging',1),('Furniture assembly',2),('Minor repairs',3),
 ('Curtains and blinds',4),('Furniture moving',5),('Minor decorating',6);
-- These cannot be exposed merely by deploying this migration. Staff must tie
-- each one to a NEW, actually published Handyman Terms version in a later release.
insert into public.handyman_categories(name,position,required_terms_version) values
 ('Plumbing',7,'UNPUBLISHED'),('Bathroom installations',8,'UNPUBLISHED'),
 ('Kitchen installations',9,'UNPUBLISHED'),('Emergency repairs',10,'UNPUBLISHED');
create table public.handyman_quotes(
  id uuid primary key default gen_random_uuid(), job_id uuid not null references public.handyman_jobs(id),
  provider_id uuid not null references public.providers(id), request_key uuid not null,
  kind text not null check(kind in('quote','site_visit','revision')),
  total_pence integer not null check(total_pence between 0 and 1000000),
  scope text not null check(length(scope) between 10 and 4000),
  duration_minutes integer not null check(duration_minutes between 30 and 480 and duration_minutes % 30 = 0),
  earliest_at timestamptz not null,
  status text not null default 'sent' check(status in('sent','selected','closed','superseded','visit_agreed','declined')),
  created_at timestamptz not null default now(), unique(job_id,provider_id,request_key),
  check((kind='site_visit' and total_pence=0) or (kind<>'site_visit' and total_pence>=50))
);
alter table public.handyman_jobs add foreign key(selected_quote_id) references public.handyman_quotes(id),
  add foreign key(pending_quote_id) references public.handyman_quotes(id);
create index handyman_quotes_job on public.handyman_quotes(job_id,created_at);
create table public.handyman_invitations(
  job_id uuid not null references public.handyman_jobs(id),provider_id uuid not null references public.providers(id),
  rank_position integer not null, ranking jsonb not null, available_at timestamptz not null,
  notified_at timestamptz, outcome text not null default 'waiting' check(outcome in('waiting','offered','quoted','declined','lost','accepted')),
  primary key(job_id,provider_id)
);
create table public.handyman_site_visits(
  quote_id uuid primary key references public.handyman_quotes(id),job_id uuid not null references public.handyman_jobs(id),
  provider_id uuid not null references public.providers(id),scheduled_at timestamptz not null,duration_minutes integer not null,
  address text not null,status text not null default 'scheduled' check(status in('scheduled','completed','cancelled'))
);
create table public.handyman_quote_operations(
  id uuid primary key default gen_random_uuid(),job_id uuid not null references public.handyman_jobs(id),
  quote_id uuid references public.handyman_quotes(id),source_id uuid references public.handyman_quote_operations(id),
  kind text not null check(kind in('charge','refund','transfer','reversal')),
  amount_pence integer not null check(amount_pence between 1 and 1000000),
  operation_key text not null unique,
  status text not null default 'queued' check(status in('queued','processing','pending','succeeded','expired','held')),
  parameters jsonb,session_id text unique,payment_intent text unique,charge_id text,stripe_ref text unique,
  claimed_at timestamptz,claim_token uuid,last_error text,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index handyman_quote_recovery on public.handyman_quote_operations(status,updated_at);
create table public.handyman_disputes(
  id uuid primary key default gen_random_uuid(),job_id uuid not null references public.handyman_jobs(id),
  opened_by uuid references public.profiles(id),reason text not null check(length(reason) between 10 and 4000),
  previous_status text not null,status text not null default 'open' check(status in('open','resolved')),
  resolution text,resolved_by uuid references public.profiles(id),resolved_at timestamptz,created_at timestamptz not null default now()
);
create unique index handyman_one_open_dispute on public.handyman_disputes(job_id) where status='open';
create table public.handyman_quote_events(
  id bigint generated always as identity primary key,job_id uuid not null references public.handyman_jobs(id),
  actor_id uuid references public.profiles(id),action text not null,details jsonb not null default '{}',created_at timestamptz not null default now()
);
do $permissions$
declare t text;
begin
 foreach t in array array['handyman_quote_settings','handyman_categories','handyman_quotes','handyman_invitations',
   'handyman_site_visits','handyman_quote_operations','handyman_disputes','handyman_quote_events'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $permissions$;
grant usage,select on sequence public.handyman_quote_events_id_seq to service_role;

create function public.handyman_category_open(p_task text)
returns boolean language sql stable security definer set search_path=public as $fn$
 select exists(select 1 from public.handyman_categories c where c.name=p_task and
   (c.required_terms_version is null or (c.required_terms_version<>'UNPUBLISHED' and exists(
    select 1 from public.legal_documents l where l.slug='handyman-terms' and l.published and l.version=c.required_terms_version))));
$fn$;

-- Eligibility is rechecked at invitation, quote submission, acceptance and start.
create function public.handyman_quote_eligible(p_provider uuid,p_job uuid,p_day date default current_date)
returns boolean language sql stable security definer set search_path=public as $fn$
 select exists(select 1 from public.handyman_jobs j join public.providers p on p.id=p_provider
  join public.profiles u on u.id=p.profile_id join public.provider_profile_settings s on s.provider_id=p.id
  where j.id=p_job and j.quote_mode and p.profile_id<>j.customer_id and u.account_deleted_at is null
   and public.handyman_category_open(j.task_name) and public.provider_service_approved(p.id,'handyman')
   and p.dbs_verified and p.stripe_account_id is not null
   and public.professional_verification_block(p.id,p_day) is null
   and j.task_name=any(s.maintenance_tasks)
   and exists(select 1 from unnest(s.coverage_postcodes) code where
     replace(upper(code),' ','') in(replace(j.postcode,' ',''),public._offer_outcode(j.postcode)))
   and not exists(select 1 from (values('photo_id'),('public_liability_insurance'),('trade_certificate')) needed(type)
     where not exists(select 1 from public.provider_verification_items v join storage.objects o
      on o.bucket_id='provider-verification' and o.name=v.document_storage_path
      where v.provider_id=p.id and v.document_type=needed.type and v.status='verified' and v.uploaded_at is not null
       and (v.expires_at is null or v.expires_at>=p_day) and (v.next_check_at is null or v.next_check_at>=p_day)
       and (needed.type<>'public_liability_insurance' or v.expires_at is not null))));
$fn$;

-- Same weights as cleaning: loyalty, district distance, ratings, experience,
-- response history and reliability. Competitors never receive these factors.
create function public.handyman_quote_ranking(p_job uuid)
returns table(provider_id uuid,score numeric,factors jsonb)
language sql stable security definer set search_path=public as $fn$
 with candidates as (
  select p.id,
   case when exists(select 1 from public.customer_favourite_providers f where f.user_id=j.customer_id and f.provider_id=p.id) then 2
    when exists(select 1 from public.handyman_jobs old where old.customer_id=j.customer_id and old.provider_id=p.id and old.status='completed')
      or exists(select 1 from public.bookings b where b.customer_id=j.customer_id and b.provider_id=p.id and b.status::text='completed') then 1 else 0 end loyalty,
   case when origin.latitude is not null and destination.latitude is not null then 6371.0*2*asin(least(1.0,sqrt(
     power(sin(radians(destination.latitude-origin.latitude)/2),2)+cos(radians(origin.latitude))*cos(radians(destination.latitude))*power(sin(radians(destination.longitude-origin.longitude)/2),2)))) end distance_km,
   coalesce((select avg(r.rating) from public.handyman_reviews r join public.handyman_jobs done on done.id=r.job_id where done.provider_id=p.id and done.status='completed'),3) rating,
   (select count(*) from public.handyman_jobs done where done.provider_id=p.id and done.status='completed') completed,
   (select count(*) from public.handyman_invitations i where i.provider_id=p.id and i.outcome in('quoted','accepted')) responded,
   (select count(*) from public.handyman_invitations i where i.provider_id=p.id and i.outcome in('quoted','accepted','declined')) decided,
   (select count(*) from public.handyman_quote_events e join public.handyman_jobs old on old.id=e.job_id
     where old.provider_id=p.id and e.actor_id=p.profile_id and e.action='cancel' and e.created_at>old.scheduled_at-interval '24 hours') late_cancellations
  from public.handyman_jobs j cross join public.providers p join public.profiles u on u.id=p.profile_id
  left join public.provider_profile_settings s on s.provider_id=p.id
  left join public.offer_geo_outcodes origin on origin.outcode=public._offer_outcode(coalesce(s.home_postcode,u.postcode))
  left join public.offer_geo_outcodes destination on destination.outcode=public._offer_outcode(j.postcode)
  where j.id=p_job and public.handyman_quote_eligible(p.id,j.id)
 ) select id,round((loyalty*1000+coalesce(40/(1+distance_km/5),0)+20*rating/5
    +10*least(1,ln(1+completed)/ln(101)) +15*(responded+1.0)/(decided+2.0)
    +15*(1.0-least(1.0,late_cancellations::numeric/greatest(1,completed+late_cancellations))))::numeric,6),
   jsonb_build_object('loyaltyTier',loyalty,'distanceKm',distance_km,'distanceBasis','postcode district centroids',
    'rating',rating,'completedJobs',completed,'responseRate',(responded+1.0)/(decided+2.0),'lateCancellations',late_cancellations)
  from candidates;
$fn$;

create function public.handyman_quote_notify(p_job uuid)
returns integer language plpgsql security definer set search_path=public as $fn$
declare i record;n integer:=0;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required';end if;
 perform 1 from public.handyman_jobs where id=p_job and status='posted' for update;
 if not found then return 0;end if;
 for i in select invitation.*,p.profile_id from public.handyman_invitations invitation join public.providers p on p.id=invitation.provider_id
   where invitation.job_id=p_job and invitation.available_at<=now() and invitation.notified_at is null order by rank_position for update of invitation loop
  if public.handyman_quote_eligible(i.provider_id,p_job) then
   insert into public.notifications(user_id,title,body,href) values(i.profile_id,'New property maintenance request',
    'A customer has posted a job in your area. View the details to send a fixed quote or propose a free site visit.','/handyman/jobs/'||p_job);
   update public.handyman_invitations set notified_at=now(),outcome='offered' where job_id=p_job and provider_id=i.provider_id;
   n:=n+1;
  end if;
 end loop;
 return n;
end $fn$;

create function public.handyman_quote_slot(p_provider uuid,p_job uuid,p_slot timestamptz,p_minutes integer,p_visit uuid default null)
returns boolean language sql stable security definer set search_path=public as $fn$
 select ((j.status='in_progress' and j.provider_id=p_provider and p_slot=j.scheduled_at)
    or (p_slot>now()+interval '2 hours' and p_slot<now()+interval '1 year'))
  and public.handyman_quote_eligible(p_provider,p_job,(p_slot at time zone 'Europe/London')::date)
  and public.handyman_available(p_provider,j.customer_id,j.postcode,p_slot,p_minutes,p_job)
  and not exists(select 1 from public.handyman_site_visits v where v.provider_id=p_provider
    and v.quote_id is distinct from p_visit and v.status='scheduled'
    and v.scheduled_at<p_slot+make_interval(mins=>p_minutes) and v.scheduled_at+make_interval(mins=>v.duration_minutes)>p_slot)
  and not exists(select 1 from public.handyman_jobs other where other.provider_id=p_provider and other.id<>p_job and other.quote_mode
    and other.status in('checkout_pending','scheduled','in_progress','revision_pending','awaiting_customer','payment_pending','disputed','cancel_pending')
    and other.scheduled_at<p_slot+make_interval(mins=>p_minutes) and other.scheduled_at+make_interval(mins=>other.estimated_minutes)>p_slot)
  and (select coalesce(sum(duration),0)+p_minutes from (
    select coalesce(b.duration_minutes,120) duration from public.bookings b where b.provider_id=p_provider
      and b.status::text in('scheduled','in_progress','completed','needs_review')
      and (b.scheduled_at at time zone 'Europe/London')::date=(p_slot at time zone 'Europe/London')::date
    union all select other.estimated_minutes from public.handyman_jobs other where other.provider_id=p_provider and other.id<>p_job
      and other.status in('checkout_pending','scheduled','in_progress','revision_pending','awaiting_customer','payment_pending','completed','disputed','cancel_pending')
      and (other.scheduled_at at time zone 'Europe/London')::date=(p_slot at time zone 'Europe/London')::date
    union all select v.duration_minutes from public.handyman_site_visits v where v.provider_id=p_provider and v.status='scheduled' and v.quote_id is distinct from p_visit
      and (v.scheduled_at at time zone 'Europe/London')::date=(p_slot at time zone 'Europe/London')::date
   ) calendar) <= (select coalesce(max_daily_hours,8)*60 from public.provider_profile_settings where provider_id=p_provider)
 from public.handyman_jobs j where j.id=p_job;
$fn$;

-- Use the existing cross-service locks, including free visits. This only adds
-- conflicts for handyman visits; it does not change cleaning's pricing or rules.
create function public.guard_handyman_site_visit_calendar()
returns trigger language plpgsql security definer set search_path=public as $fn$
declare used integer;maximum integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('professional-schedule:'||new.provider_id::text,0));
 if exists(select 1 from public.handyman_site_visits v where v.provider_id=new.provider_id and v.status='scheduled'
  and v.scheduled_at<new.scheduled_at+make_interval(mins=>coalesce(new.duration_minutes,120))
  and v.scheduled_at+make_interval(mins=>v.duration_minutes)>new.scheduled_at) then raise exception 'Professional has a free site visit at this time';end if;
 if exists(select 1 from public.handyman_jobs j where j.provider_id=new.provider_id and j.quote_mode
  and j.status in('checkout_pending','scheduled','in_progress','revision_pending','awaiting_customer','payment_pending','disputed','cancel_pending')
  and j.scheduled_at<new.scheduled_at+make_interval(mins=>coalesce(new.duration_minutes,120))
  and j.scheduled_at+make_interval(mins=>j.estimated_minutes)>new.scheduled_at) then raise exception 'Professional has a quoted job at this time';end if;
 select coalesce(sum(duration),0) into used from (
  select coalesce(b.duration_minutes,120) duration from public.bookings b where b.provider_id=new.provider_id and b.id<>new.id
   and b.status::text in('scheduled','in_progress','completed','needs_review') and (b.scheduled_at at time zone 'Europe/London')::date=(new.scheduled_at at time zone 'Europe/London')::date
  union all select j.estimated_minutes from public.handyman_jobs j where j.provider_id=new.provider_id
   and j.status in('checkout_pending','scheduled','in_progress','revision_pending','awaiting_customer','payment_pending','completed','disputed','cancel_pending')
   and (j.scheduled_at at time zone 'Europe/London')::date=(new.scheduled_at at time zone 'Europe/London')::date
  union all select v.duration_minutes from public.handyman_site_visits v where v.provider_id=new.provider_id and v.status='scheduled'
   and (v.scheduled_at at time zone 'Europe/London')::date=(new.scheduled_at at time zone 'Europe/London')::date
 ) calendar;
 select coalesce(max_daily_hours,8)*60 into maximum from public.provider_profile_settings where provider_id=new.provider_id;
 if used+coalesce(new.duration_minutes,120)>coalesce(maximum,480) then raise exception 'Professional daily hours exceeded';end if;
 return new;
end $fn$;
create trigger handyman_site_visit_cleaning before insert or update of provider_id,scheduled_at,status,duration_minutes on public.bookings
 for each row when(new.provider_id is not null and new.status::text='scheduled') execute function public.guard_handyman_site_visit_calendar();

-- Freeze quote identities and destination after selection. Historical rate/VAT
-- snapshots remain immutable; no new quote job can contain an hourly price.
create or replace function public.freeze_handyman_booking_terms()
returns trigger language plpgsql security definer set search_path=public as $fn$
begin
 if new.quote_mode then
  if tg_op='UPDATE' and (new.customer_id<>old.customer_id or new.quote_mode<>old.quote_mode or
    (old.selected_quote_id is not null and (new.provider_id is distinct from old.provider_id
      or new.payout_account_id is distinct from old.payout_account_id))) then raise exception 'Quoted identities and payout destination are immutable';end if;
  return new;
 end if;
 if tg_op='INSERT' then raise exception 'Property maintenance is quote only';end if;
 if new.provider_id is distinct from old.provider_id or new.customer_id is distinct from old.customer_id
  or new.hourly_rate_pence is distinct from old.hourly_rate_pence or new.vat_bps is distinct from old.vat_bps
  or new.payout_account_id is distinct from old.payout_account_id then raise exception 'Historical financial terms are immutable';end if;
 return new;
end $fn$;
revoke execute on function public.reserve_handyman_job(uuid,uuid,text,text,text,text,timestamptz,integer,integer) from service_role;

-- Preserve every existing approval/MFA/evidence guard and change ONLY the
-- obsolete hourly-rate prerequisite. Fail closed if the upstream body changes.
do $approval$
declare original text;replacement text;definition text;
begin
 select prosrc,pg_get_functiondef(oid) into original,definition from pg_proc
  where oid='public.review_professional_service_before_client_documents(uuid,text,text,text)'::regprocedure;
 replacement:=replace(original,
  'if not exists (select 1 from public.provider_task_rates where provider_id = p_provider) then',
  'if not exists (select 1 from public.provider_profile_settings s, unnest(s.maintenance_tasks) task where s.provider_id = p_provider and public.handyman_category_open(task)) then');
 replacement:=replace(replacement,'Set at least one handyman task and hourly rate','Select at least one published property maintenance category');
 if replacement=original or position('provider_task_rates' in replacement)>0 then raise exception 'Handyman approval prerequisite changed upstream; review before applying';end if;
 execute replace(definition,original,replacement);
end $approval$;

-- Cleaning's SELECT is unchanged. Handyman listings require categories, not
-- obsolete saved rates; shared verification and genuine-review rules remain.
create or replace view public.professional_service_ratings with(security_barrier=true) as
 select provider.id as provider_id,'cleaning'::text as service,avg(review.rating)::numeric as rating_avg,count(review.id)::integer as rating_count
 from public.providers provider join public.public_eligible_provider_ids() eligible on eligible.id=provider.id
 left join public.bookings booking on booking.provider_id=provider.id and booking.status::text='completed'
 left join public.reviews review on review.booking_id=booking.id and review.reviewer='client'
 where provider.show_on_our_pros and provider.vetting_status='approved' and not provider.is_suspended
  and 'cleaning'=any(provider.services) and provider.service_approvals->>'cleaning'='approved'
 group by provider.id
 union all
 select provider.id as provider_id,'handyman'::text as service,avg(review.rating)::numeric as rating_avg,count(review.job_id)::integer as rating_count
 from public.providers provider join public.public_eligible_provider_ids() eligible on eligible.id=provider.id
 left join public.handyman_jobs job on job.provider_id=provider.id and job.status='completed'
 left join public.handyman_reviews review on review.job_id=job.id
 where provider.show_on_our_pros and provider.vetting_status='approved' and not provider.is_suspended
  and 'handyman'=any(provider.services) and provider.service_approvals->>'handyman'='approved'
  and exists(select 1 from public.provider_verification_items item join storage.objects file on file.bucket_id='provider-verification' and file.name=item.document_storage_path
    where item.provider_id=provider.id and item.document_type='public_liability_insurance' and item.status='verified' and item.uploaded_at is not null and item.expires_at>=current_date)
  and exists(select 1 from public.provider_profile_settings s,unnest(s.maintenance_tasks) task
    where s.provider_id=provider.id and public.handyman_category_open(task))
 group by provider.id;
revoke all on public.professional_service_ratings from public;
grant select on public.professional_service_ratings to anon,authenticated,service_role;

create function public.handyman_post_job(p_user uuid,p_key uuid,p_task text,p_description text,p_postcode text,p_dates date[])
returns public.handyman_jobs language plpgsql security definer set search_path=public as $fn$
declare j public.handyman_jobs;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required';end if;
 if not exists(select 1 from public.profiles where id=p_user and account_deleted_at is null and role::text<>'admin')
  or not public.handyman_category_open(p_task) or length(p_description) not between 10 and 2000
  or p_postcode !~ '^[A-Z]{1,2}[0-9][A-Z0-9]? [0-9][A-Z]{2}$'
  or cardinality(p_dates) not between 1 and 10 or exists(select 1 from unnest(p_dates) d where d<current_date or d>current_date+366)
  then raise exception 'Check the job details';end if;
 insert into public.handyman_jobs(customer_id,task_name,description,postcode,preferred_dates,quote_mode,request_key,status)
  values(p_user,p_task,p_description,p_postcode,p_dates,true,p_key,'draft')
  on conflict(customer_id,request_key) where quote_mode do nothing;
 select * into j from public.handyman_jobs where customer_id=p_user and request_key=p_key and quote_mode;
 if j.task_name<>p_task or j.description<>p_description or j.postcode<>p_postcode or j.preferred_dates<>p_dates then raise exception 'Retry key belongs to another job';end if;
 return j;
end $fn$;

-- Refund allocations live in a durable ledger, including partial refunds over
-- multiple revised-scope payments. Prior successful transfers are reversed first.
create function public.handyman_queue_refund(p_job uuid,p_target integer)
returns void language plpgsql security definer set search_path=public as $fn$
declare j public.handyman_jobs;c public.handyman_quote_operations;available integer;remaining integer;amount integer;
begin
 select * into j from public.handyman_jobs where id=p_job for update;
 remaining:=p_target-coalesce((select sum(amount_pence) from public.handyman_quote_operations where job_id=p_job and kind='refund' and status<>'expired'),0);
 if remaining<0 or p_target>j.paid_pence then raise exception 'Invalid refund total';end if;
 if remaining=0 then return;end if;
 for c in select * from public.handyman_quote_operations where job_id=p_job and kind='transfer' and status='succeeded' order by created_at loop
  insert into public.handyman_quote_operations(job_id,source_id,kind,amount_pence,operation_key)
   values(p_job,c.id,'reversal',c.amount_pence,'reversal:'||c.id) on conflict(operation_key) do nothing;
 end loop;
 for c in select * from public.handyman_quote_operations where job_id=p_job and kind='charge' and status='succeeded' order by created_at desc,id loop
  available:=c.amount_pence-coalesce((select sum(amount_pence) from public.handyman_quote_operations where source_id=c.id and kind='refund' and status<>'expired'),0);
  amount:=least(available,remaining);
  if amount>0 then
   insert into public.handyman_quote_operations(job_id,source_id,kind,amount_pence,operation_key)
    values(p_job,c.id,'refund',amount,'refund:'||c.id||':'||p_target);
   remaining:=remaining-amount;
  end if;
  exit when remaining=0;
 end loop;
 if remaining<>0 then raise exception 'Refund funding does not reconcile';end if;
end $fn$;

create function public.handyman_queue_payout(p_job uuid)
returns void language plpgsql security definer set search_path=public as $fn$
declare j public.handyman_jobs;c public.handyman_quote_operations;remaining integer;available integer;amount integer;
begin
 select * into j from public.handyman_jobs where id=p_job for update;
 if j.status<>'payment_pending' or exists(select 1 from public.handyman_disputes where job_id=p_job and status='open') then return;end if;
 if exists(select 1 from public.handyman_quote_operations where job_id=p_job and kind in('charge','refund','reversal') and status not in('succeeded','expired')) then return;end if;
 remaining:=j.paid_pence-j.refunded_pence-round((j.paid_pence-j.refunded_pence)::numeric*j.commission_bps/10000)::integer;
 for c in select * from public.handyman_quote_operations where job_id=p_job and kind='charge' and status='succeeded' order by created_at,id loop
  available:=c.amount_pence-coalesce((select sum(amount_pence) from public.handyman_quote_operations where source_id=c.id and kind='refund' and status='succeeded'),0);
  amount:=least(available,remaining);
  if amount>0 then
   insert into public.handyman_quote_operations(job_id,source_id,kind,amount_pence,operation_key)
    values(p_job,c.id,'transfer',amount,'payout:'||p_job||':'||j.payout_round||':'||c.id) on conflict(operation_key) do nothing;
   remaining:=remaining-amount;
  end if;
 end loop;
 if remaining<>0 then raise exception 'Payout funding does not reconcile';end if;
end $fn$;

create function public.handyman_stripe_review(p_job uuid,p_charge text,p_reason text)
returns void language plpgsql security definer set search_path=public as $fn$
declare j public.handyman_jobs;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required';end if;
 select * into j from public.handyman_jobs where id=p_job and quote_mode for update;
 if j.id is null or not exists(select 1 from public.handyman_quote_operations where job_id=j.id and kind='charge' and charge_id=p_charge and status='succeeded') then raise exception 'Unknown funding charge';end if;
 insert into public.handyman_disputes(job_id,opened_by,reason,previous_status)
  values(j.id,null,left(p_reason,4000),j.status) on conflict(job_id) where status='open' do nothing;
 update public.handyman_jobs set status='disputed' where id=j.id;
 insert into public.handyman_quote_events(job_id,action,details) values(j.id,'stripe_review',jsonb_build_object('charge',p_charge,'reason',p_reason));
end $fn$;

create function public.handyman_quote_command(p_job uuid,p_user uuid,p_action text,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare j public.handyman_jobs;q public.handyman_quotes;pid uuid;worker uuid;category text;amount integer;
 slot timestamptz;minutes integer;bands jsonb;terms text;refund integer;ranked record;settings public.job_offer_settings;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required';end if;
 select * into j from public.handyman_jobs where id=p_job and quote_mode for update;
 if not found then raise exception 'Quote job not found';end if;
 select id into pid from public.providers where profile_id=p_user;
 select profile_id into worker from public.providers where id=j.provider_id;
 if not exists(select 1 from public.profiles where id=p_user and account_deleted_at is null) then raise exception 'Account is unavailable';end if;
 if p_action='publish' then
  if p_user<>j.customer_id then raise exception 'Customer only';end if;
  if j.status='draft' then
   if not public.handyman_category_open(j.task_name) then raise exception 'Category is not published';end if;
   update public.handyman_jobs set status='posted' where id=j.id;
   select * into settings from public.job_offer_settings where id;
   insert into public.handyman_invitations(job_id,provider_id,rank_position,ranking,available_at)
    select j.id,r.provider_id,row_number() over(order by r.score desc,r.provider_id),r.factors,
     now()+make_interval(mins=>((row_number() over(order by r.score desc,r.provider_id)-1)/settings.first_wave_size)::integer*settings.second_wave_after_minutes)
    from public.handyman_quote_ranking(j.id) r;
   perform public.handyman_quote_notify(j.id);
  elsif j.status<>'posted' then raise exception 'Job is already booked';end if;
 elsif p_action in('quote','site_visit','revision') then
  if not public.handyman_quote_eligible(pid,j.id) then raise exception 'Approved and current checks, category and area required';end if;
  if p_action='revision' then
   if pid is distinct from j.provider_id or j.status<>'in_progress' then raise exception 'Scope changes belong to the assigned professional during work';end if;
  elsif j.status<>'posted' or not exists(select 1 from public.handyman_invitations where job_id=j.id and provider_id=pid and notified_at is not null and outcome in('offered','quoted')) then raise exception 'Invitation is unavailable';end if;
  amount:=case when p_action='site_visit' then 0 else (p_data->>'totalPence')::integer end;
  slot:=case when p_action='revision' then j.scheduled_at else (p_data->>'earliestAt')::timestamptz end;minutes:=(p_data->>'durationMinutes')::integer;
  if amount is null or (p_action<>'site_visit' and amount not between 50 and 1000000) or length(p_data->>'scope') not between 10 and 4000
    or minutes not between 30 and 480 or minutes%30<>0 or slot is null
    or not coalesce(public.handyman_quote_slot(pid,j.id,slot,minutes),false) then raise exception 'Check total, included work, estimated time and available date';end if;
  -- Revision time is a scheduling estimate only, never a price multiplier.
  insert into public.handyman_quotes(job_id,provider_id,request_key,kind,total_pence,scope,duration_minutes,earliest_at)
   values(j.id,pid,(p_data->>'requestKey')::uuid,p_action,amount,p_data->>'scope',minutes,slot)
   on conflict(job_id,provider_id,request_key) do nothing returning * into q;
  if q.id is null then
   select * into q from public.handyman_quotes where job_id=j.id and provider_id=pid and request_key=(p_data->>'requestKey')::uuid;
   if q.kind<>p_action or q.total_pence<>amount or q.scope is distinct from p_data->>'scope'
     or q.duration_minutes<>minutes or q.earliest_at<>slot then raise exception 'Retry key belongs to another proposal';end if;
  else
   update public.handyman_quotes set status='superseded' where job_id=j.id and provider_id=pid and kind=p_action and status='sent' and id<>q.id;
   update public.handyman_invitations set outcome='quoted' where job_id=j.id and provider_id=pid;
   insert into public.notifications(user_id,title,body,href) values(j.customer_id,'Property maintenance update',
    case when p_action='site_visit' then 'A professional proposed a free site visit.' when p_action='revision' then 'Review a revised fixed quote before any scope or payment changes.' else 'A professional sent a fixed quote, including materials.' end,'/handyman/jobs/'||j.id);
  end if;
  return to_jsonb(q);
 elsif p_action in('accept','accept_revision','accept_visit') then
  if p_user<>j.customer_id then raise exception 'Customer approval required';end if;
  select * into q from public.handyman_quotes where id=(p_data->>'quoteId')::uuid and job_id=j.id for update;
  if q.id is null then raise exception 'Quote not found';end if;
  if (j.selected_quote_id=q.id or j.pending_quote_id=q.id or q.status='visit_agreed') and q.status in('selected','visit_agreed') then return to_jsonb(j);end if;
  if q.status<>'sent' then raise exception 'Quote is no longer available';end if;
  perform pg_advisory_xact_lock(hashtextextended('professional-schedule:'||q.provider_id::text,0));
  if not coalesce(public.handyman_quote_slot(q.provider_id,j.id,q.earliest_at,q.duration_minutes),false) then raise exception 'Professional, checks or time is no longer available';end if;
  if p_action='accept_visit' then
   if j.status<>'posted' or q.kind<>'site_visit' or length(btrim(p_data->>'address')) not between 5 and 300 then raise exception 'Confirm the free visit and address';end if;
   insert into public.handyman_site_visits(quote_id,job_id,provider_id,scheduled_at,duration_minutes,address)
    values(q.id,j.id,q.provider_id,q.earliest_at,q.duration_minutes,btrim(p_data->>'address'));
   update public.handyman_quotes set status='visit_agreed' where id=q.id;
  elsif p_action='accept' then
   if j.status<>'posted' or q.kind<>'quote' or length(btrim(p_data->>'address')) not between 5 and 300 then raise exception 'Accept an available quote and provide the service address';end if;
   select l.version into terms from public.legal_documents l where slug='handyman-terms' and published;
   if terms is null then raise exception 'Handyman Terms must be published';end if;
   if p_data->>'termsVersion' is distinct from terms then raise exception 'Read and accept the current Handyman Terms';end if;
   select c.terms->'cancellationRefundPercent' into bands from public.cleaning_billing_settings c order by c.id desc limit 1;
   if bands is null then raise exception 'Cancellation settings are unavailable';end if;
   update public.handyman_jobs set provider_id=q.provider_id,selected_quote_id=q.id,total_pence=q.total_pence,
    payout_account_id=(select stripe_account_id from public.providers where id=q.provider_id),
    commission_bps=(select commission_bps from public.handyman_quote_settings where id),refund_bands=bands,terms_version=terms,
    scheduled_at=q.earliest_at,estimated_minutes=q.duration_minutes,address=btrim(p_data->>'address'),status='checkout_pending',quote_reserved_until=now()+interval '1 hour',
    bill=jsonb_build_object('gross',q.total_pence,'platform',round(q.total_pence::numeric*(select commission_bps from public.handyman_quote_settings where id)/10000)::integer,
      'provider',q.total_pence-round(q.total_pence::numeric*(select commission_bps from public.handyman_quote_settings where id)/10000)::integer)
    where id=j.id;
   update public.handyman_quotes set status=case when id=q.id then 'selected' else 'closed' end where job_id=j.id and status in('sent','visit_agreed');
   update public.handyman_site_visits set status='cancelled' where job_id=j.id and status='scheduled';
   update public.handyman_invitations set outcome=case when provider_id=q.provider_id then 'accepted' else 'lost' end where job_id=j.id;
   insert into public.handyman_quote_operations(job_id,quote_id,kind,amount_pence,operation_key) values(j.id,q.id,'charge',q.total_pence,'accept:'||q.id);
  else
   if j.status<>'in_progress' or q.kind<>'revision' or q.provider_id is distinct from j.provider_id then raise exception 'Revision cannot be approved';end if;
   update public.handyman_quotes set status='selected' where id=q.id;
   update public.handyman_quotes set status='closed' where job_id=j.id and kind='revision' and id<>q.id and status='sent';
   update public.handyman_jobs set pending_quote_id=q.id,status='revision_pending' where id=j.id;
   if q.total_pence>j.total_pence then
    insert into public.handyman_quote_operations(job_id,quote_id,kind,amount_pence,operation_key) values(j.id,q.id,'charge',q.total_pence-j.total_pence,'revision:'||q.id);
   elsif q.total_pence<j.total_pence then perform public.handyman_queue_refund(j.id,j.refunded_pence+j.total_pence-q.total_pence);
   end if;
  end if;
  insert into public.notifications(user_id,title,body,href) select profile_id,'Property maintenance update',
   case when p_action='accept_visit' then 'Your free site visit was agreed. View the address and date.' else 'The customer accepted your quote. Payment status is shown on the job.' end,'/handyman/jobs/'||j.id from public.providers where id=q.provider_id;
 elsif p_action='retry_payment' then
  if p_user<>j.customer_id or j.status not in('checkout_pending','revision_pending') then raise exception 'No customer payment is pending';end if;
  if exists(select 1 from public.handyman_quote_operations where job_id=j.id and kind='charge' and status not in('succeeded','expired')) then return to_jsonb(j);end if;
  select * into q from public.handyman_quotes where id=coalesce(j.pending_quote_id,j.selected_quote_id);
  amount:=q.total_pence-(j.paid_pence-j.refunded_pence);
  if amount>0 then
   insert into public.handyman_quote_operations(job_id,quote_id,kind,amount_pence,operation_key)
    values(j.id,q.id,'charge',amount,'retry:'||j.id||':'||(p_data->>'requestKey')) on conflict(operation_key) do nothing;
  end if;
 elsif p_action='decline' then
  if pid is null or j.status<>'posted' then raise exception 'Invitation is unavailable';end if;
  update public.handyman_invitations set outcome='declined' where job_id=j.id and provider_id=pid and notified_at is not null;
  if not found then raise exception 'Invitation not found';end if;
  update public.handyman_quotes set status='declined' where job_id=j.id and provider_id=pid and status='sent';
 elsif p_action='start' then
  if p_user is distinct from worker or j.status<>'scheduled' or now()<j.scheduled_at-interval '30 minutes'
   or j.paid_pence-j.refunded_pence<>j.total_pence or not public.handyman_quote_eligible(pid,j.id) then raise exception 'Paid, approved and scheduled work is required';end if;
  perform pg_advisory_xact_lock(hashtextextended('professional-work:'||j.provider_id::text,0));
  if exists(select 1 from public.handyman_jobs other where other.id<>j.id and other.provider_id=j.provider_id and other.status='in_progress')
   or exists(select 1 from public.bookings where provider_id=j.provider_id and status::text='in_progress') then raise exception 'Another job is in progress';end if;
  update public.handyman_jobs set status='in_progress',started_at=now() where id=j.id;
 elsif p_action='finish' then
  if p_user is distinct from worker or j.status<>'in_progress' then raise exception 'Only the assigned professional can finish active work';end if;
  update public.handyman_jobs set status='awaiting_customer',ended_at=now(),confirm_after=now()+interval '48 hours' where id=j.id;
  insert into public.notifications(user_id,title,body,href) values(j.customer_id,'Confirm your completed job',
   'Review the work. Confirm completion or raise a dispute within 48 hours.','/handyman/jobs/'||j.id);
 elsif p_action='confirm' then
  if p_user<>j.customer_id or j.status<>'awaiting_customer' then raise exception 'Completion is not awaiting your approval';end if;
  update public.handyman_jobs set status='payment_pending',approved_at=now() where id=j.id;
  perform public.handyman_queue_payout(j.id);
 elsif p_action='cancel' then
  if p_user<>j.customer_id and p_user is distinct from worker then raise exception 'Only a participant can cancel';end if;
  if j.status='cancelled' then return to_jsonb(j);end if;
  if j.status not in('draft','posted','checkout_pending','scheduled','cancel_pending') then raise exception 'Use the resolution desk once work starts';end if;
  refund:=case when p_user is not distinct from worker or j.status in('draft','posted','checkout_pending') then 100
   when (j.scheduled_at at time zone 'Europe/London')::date<=(now() at time zone 'Europe/London')::date then (j.refund_bands->>'none')::integer
   when j.scheduled_at>=now()+interval '48 hours' then (j.refund_bands->>'full')::integer
   when j.scheduled_at>=now()+interval '24 hours' then (j.refund_bands->>'three_quarter')::integer else (j.refund_bands->>'half')::integer end;
  update public.handyman_jobs set status='cancel_pending',cancel_refund_percent=coalesce(j.cancel_refund_percent,refund) where id=j.id;
  perform public.handyman_queue_refund(j.id,round(j.paid_pence::numeric*coalesce(j.cancel_refund_percent,refund)/100)::integer);
  update public.handyman_quotes set status='closed' where job_id=j.id and status='sent';
  update public.handyman_site_visits set status='cancelled' where job_id=j.id;
 elsif p_action='dispute' then
  if p_user<>j.customer_id and p_user is distinct from worker then raise exception 'Job is private';end if;
  if j.status not in('in_progress','awaiting_customer','payment_pending','completed','disputed','revision_pending') or length(p_data->>'reason') not between 10 and 4000 then raise exception 'Describe the dispute';end if;
  if exists(select 1 from public.handyman_quote_operations where job_id=j.id and kind in('transfer','refund','reversal') and status='processing' and claimed_at>now()-interval '2 minutes') then raise exception 'A settlement is processing; refresh before raising the dispute';end if;
  insert into public.handyman_disputes(job_id,opened_by,reason,previous_status) values(j.id,p_user,p_data->>'reason',j.status)
   on conflict(job_id) where status='open' do nothing;
  update public.handyman_jobs set status='disputed' where id=j.id;
 else raise exception 'Unknown quote action';end if;
 update public.handyman_jobs set updated_at=now() where id=j.id returning * into j;
 insert into public.handyman_quote_events(job_id,actor_id,action,details) values(j.id,p_user,p_action,jsonb_build_object('quoteId',q.id));
 return to_jsonb(j);
end $fn$;

-- Claim tokens prevent a stale process acknowledging another worker's operation.
create function public.handyman_claim_operation(p_id uuid,p_parameters jsonb default null,p_reconcile_only boolean default false)
returns public.handyman_quote_operations language plpgsql security definer set search_path=public as $fn$
declare o public.handyman_quote_operations;j public.handyman_jobs;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required';end if;
 select * into o from public.handyman_quote_operations where id=p_id;
 select * into j from public.handyman_jobs where id=o.job_id for update;
 select * into o from public.handyman_quote_operations where id=p_id for update;
 if o.status in('succeeded','expired') then return o;end if;
 if o.status='processing' and o.claimed_at>now()-interval '2 minutes' then raise exception 'Operation is already processing';end if;
 if o.kind<>'charge' and j.status='disputed' and not(o.kind='transfer' and p_reconcile_only and o.status in('processing','pending','held')) then raise exception 'Resolve the dispute before moving money';end if;
 if o.kind='transfer' then
  if (j.status<>'payment_pending' or exists(select 1 from public.handyman_disputes where job_id=j.id and status='open')) and not(j.status='disputed' and p_reconcile_only and o.status in('processing','pending','held')) then raise exception 'Payout is blocked';end if;
  if not p_reconcile_only and (j.payout_account_id is null or j.payout_account_id is distinct from(select stripe_account_id from public.providers where id=j.provider_id)) then
   update public.handyman_quote_operations set status='held',last_error='Provider payout account is not configured' where id=o.id returning * into o;return o;
  end if;
 end if;
 if o.kind='refund' and exists(select 1 from public.handyman_quote_operations where job_id=j.id and kind='reversal' and status<>'succeeded') then raise exception 'Reverse prior transfers before refunding';end if;
 if o.kind='charge' and j.status not in('checkout_pending','revision_pending','cancel_pending','disputed') then raise exception 'Payment is not awaiting checkout';end if;
 if o.parameters is null and p_parameters is not null then
  o.parameters:=p_parameters;
  if o.kind='charge' and j.status='checkout_pending' then
   update public.handyman_jobs set quote_reserved_until=to_timestamp((p_parameters->>'expires_at')::double precision) where id=j.id;
  end if;
 end if;
 update public.handyman_quote_operations set parameters=o.parameters,status='processing',claim_token=gen_random_uuid(),claimed_at=now(),updated_at=now(),last_error=null
  where id=o.id returning * into o;return o;
end $fn$;

create function public.handyman_record_operation(p_id uuid,p_token uuid,p_status text,p_ref text default null,p_intent text default null,p_charge text default null,p_error text default null)
returns void language plpgsql security definer set search_path=public as $fn$
declare o public.handyman_quote_operations;j public.handyman_jobs;q public.handyman_quotes;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required';end if;
 select * into o from public.handyman_quote_operations where id=p_id;
 select * into j from public.handyman_jobs where id=o.job_id for update;
 select * into o from public.handyman_quote_operations where id=p_id for update;
 if o.status='succeeded' then
  if p_status='succeeded' and o.stripe_ref is not distinct from p_ref then return;end if;
  raise exception 'Successful operation is immutable';
 end if;
 if o.claim_token is distinct from p_token or p_token is null then raise exception 'Operation lease changed';end if;
 if p_status not in('pending','succeeded','expired','held') then raise exception 'Invalid operation status';end if;
 if p_status='succeeded' and (p_ref is null or (o.kind='charge' and (p_intent is null or p_charge is null))) then raise exception 'Verified Stripe references required';end if;
 update public.handyman_quote_operations set status=p_status,stripe_ref=case when p_status='succeeded' then p_ref else stripe_ref end,
  session_id=case when kind='charge' and p_status in('pending','succeeded') then p_ref else session_id end,
  payment_intent=coalesce(p_intent,payment_intent),charge_id=coalesce(p_charge,charge_id),
  last_error=p_error,claimed_at=null,claim_token=null,updated_at=now() where id=o.id;
 if p_status='succeeded' then
  if o.kind='charge' then update public.handyman_jobs set paid_pence=paid_pence+o.amount_pence where id=j.id;
  elsif o.kind='refund' then update public.handyman_jobs set refunded_pence=refunded_pence+o.amount_pence where id=j.id;
  end if;
 end if;
 select * into j from public.handyman_jobs where id=j.id;
 if j.status='checkout_pending' and j.paid_pence=j.total_pence then
  -- A late payment cannot silently assign an expired, suspended or self provider.
  if not coalesce(public.handyman_quote_slot(j.provider_id,j.id,j.scheduled_at,j.estimated_minutes),false) then
   update public.handyman_jobs set status='cancel_pending',cancel_refund_percent=100 where id=j.id;
   perform public.handyman_queue_refund(j.id,j.paid_pence);
  else update public.handyman_jobs set status='scheduled' where id=j.id;end if;
 elsif j.status='revision_pending' and not exists(select 1 from public.handyman_quote_operations where job_id=j.id and kind in('charge','refund','reversal') and status not in('succeeded','expired')) then
  select * into q from public.handyman_quotes where id=j.pending_quote_id;
  if j.paid_pence-j.refunded_pence=q.total_pence then
   update public.handyman_jobs set selected_quote_id=q.id,pending_quote_id=null,total_pence=q.total_pence,estimated_minutes=q.duration_minutes,status='in_progress',
    bill=jsonb_build_object('gross',q.total_pence,'platform',round(q.total_pence::numeric*j.commission_bps/10000)::integer,'provider',q.total_pence-round(q.total_pence::numeric*j.commission_bps/10000)::integer)
    where id=j.id;
  end if;
 elsif j.status='cancel_pending' then
  perform public.handyman_queue_refund(j.id,round(j.paid_pence::numeric*j.cancel_refund_percent/100)::integer);
  if not exists(select 1 from public.handyman_quote_operations where job_id=j.id and status not in('succeeded','expired')) then
   update public.handyman_jobs set status='cancelled' where id=j.id;
  end if;
 elsif j.status='payment_pending' then
  perform public.handyman_queue_payout(j.id);
  if not exists(select 1 from public.handyman_quote_operations where job_id=j.id and status not in('succeeded','expired')) then
   update public.handyman_jobs set status='completed',transfer_ref=(select stripe_ref from public.handyman_quote_operations where job_id=j.id and kind='transfer' and status='succeeded' order by created_at desc limit 1),
    bill=jsonb_build_object('gross',j.paid_pence-j.refunded_pence,'platform',round((j.paid_pence-j.refunded_pence)::numeric*j.commission_bps/10000)::integer,
     'provider',j.paid_pence-j.refunded_pence-round((j.paid_pence-j.refunded_pence)::numeric*j.commission_bps/10000)::integer) where id=j.id;
  end if;
 end if;
end $fn$;

create function public.handyman_quote_maintenance()
returns integer language plpgsql security definer set search_path=public as $fn$
declare j record;n integer:=0;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required';end if;
 for j in select id,status from public.handyman_jobs where quote_mode and
  (status in('posted','cancel_pending','revision_pending','payment_pending') or(status='awaiting_customer' and confirm_after<=now())
    or(status='checkout_pending' and quote_reserved_until<=now()))
  order by updated_at limit 100 for update skip locked loop
  if j.status='checkout_pending' then
   update public.handyman_jobs set status='cancel_pending',cancel_refund_percent=100 where id=j.id;
   perform public.handyman_queue_refund(j.id,(select paid_pence from public.handyman_jobs where id=j.id));
  elsif j.status='posted' then perform public.handyman_quote_notify(j.id);
  elsif j.status='awaiting_customer' then
   update public.handyman_jobs set status='payment_pending',approved_at=now() where id=j.id and status='awaiting_customer' and confirm_after<=now();
   if found then perform public.handyman_queue_payout(j.id);end if;
  elsif j.status='payment_pending' then
   perform public.handyman_queue_payout(j.id);
   if not exists(select 1 from public.handyman_quote_operations where job_id=j.id and status not in('succeeded','expired')) then
    update public.handyman_jobs job set status='completed',transfer_ref=(select stripe_ref from public.handyman_quote_operations where job_id=j.id and kind='transfer' and status='succeeded' order by created_at desc limit 1),
     bill=jsonb_build_object('gross',job.paid_pence-job.refunded_pence,'platform',round((job.paid_pence-job.refunded_pence)::numeric*job.commission_bps/10000)::integer,
      'provider',job.paid_pence-job.refunded_pence-round((job.paid_pence-job.refunded_pence)::numeric*job.commission_bps/10000)::integer) where job.id=j.id;
   end if;
  elsif j.status='cancel_pending' and not exists(select 1 from public.handyman_quote_operations where job_id=j.id and status not in('succeeded','expired')) then
   update public.handyman_jobs set status='cancelled' where id=j.id;
  elsif j.status='revision_pending' then
   -- Equal-price revisions need no external payment operation.
   update public.handyman_jobs job set selected_quote_id=q.id,pending_quote_id=null,estimated_minutes=q.duration_minutes,status='in_progress'
    from public.handyman_quotes q where job.id=j.id and q.id=job.pending_quote_id and q.total_pence=job.total_pence and job.paid_pence-job.refunded_pence=q.total_pence;
  end if;n:=n+1;
 end loop;
 return n;
end $fn$;

-- Staff calls still require the existing AAL2/TOTP admin API before a service-role
-- RPC is made. Staff identity and reasoning are recorded in the same transaction.
create function public.handyman_resolve_dispute(p_dispute uuid,p_admin uuid,p_refund integer,p_reason text)
returns void language plpgsql security definer set search_path=public as $fn$
declare d public.handyman_disputes;j public.handyman_jobs;
begin
 if auth.role() is distinct from 'service_role' or not exists(select 1 from public.profiles where id=p_admin and role::text='admin' and account_deleted_at is null)
  then raise exception 'Staff required';end if;
 select * into d from public.handyman_disputes where id=p_dispute;
 select * into j from public.handyman_jobs where id=d.job_id for update;
 select * into d from public.handyman_disputes where id=p_dispute for update;
 if d.status='resolved' then return;end if;
 if length(p_reason) not between 10 and 4000 or p_refund not between 0 and j.paid_pence-j.refunded_pence then raise exception 'Valid reason and refund required';end if;
 if exists(select 1 from public.handyman_quote_operations where job_id=j.id and status='processing' and claimed_at>now()-interval '2 minutes') then raise exception 'Payment operation is processing';end if;
 if exists(select 1 from public.handyman_quote_operations where job_id=j.id and kind='transfer' and status in('processing','pending','held')) then raise exception 'Reconcile the previous payout outcome before resolving this case';end if;
 if exists(select 1 from public.handyman_quote_operations where job_id=j.id and kind='charge' and status not in('succeeded','expired')) then raise exception 'Reconcile pending checkout before resolution';end if;
 -- A disputed revision may never become effective without its customer payment.
 update public.handyman_disputes set status='resolved',resolution=p_reason,resolved_by=p_admin,resolved_at=now() where id=d.id;
 update public.handyman_jobs set status='payment_pending',approved_at=now(),payout_round=payout_round+case when p_refund>0 then 1 else 0 end,pending_quote_id=null where id=j.id;
 if p_refund>0 then update public.handyman_quote_operations set status='expired' where job_id=j.id and kind='transfer' and status='queued';end if;
 perform public.handyman_queue_refund(j.id,j.refunded_pence+p_refund);
 perform public.handyman_queue_payout(j.id);
 insert into public.handyman_quote_events(job_id,actor_id,action,details) values(j.id,p_admin,'resolve_dispute',jsonb_build_object('refundPence',p_refund,'reason',p_reason));
end $fn$;

-- New photos remain private and cannot silently become chargeable materials.
alter function public.add_handyman_file(uuid,uuid,text,text,text,text,integer) rename to add_handyman_file_before_quotes;
create function public.add_handyman_file(p_job uuid,p_user uuid,p_kind text,p_path text,p_name text,p_mime text,p_amount integer default null)
returns void language plpgsql security definer set search_path=public as $fn$
declare j public.handyman_jobs;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required';end if;
 select * into j from public.handyman_jobs where id=p_job for update;
 if not j.quote_mode then perform public.add_handyman_file_before_quotes(p_job,p_user,p_kind,p_path,p_name,p_mime,p_amount);return;end if;
 if p_user<>j.customer_id or j.status not in('draft','posted') or p_kind<>'photo' or p_amount is not null or p_mime not in('image/jpeg','image/png')
  or not starts_with(p_path,j.id::text||'/') or not exists(select 1 from storage.objects where bucket_id='handyman-job-files' and name=p_path)
  or (select count(*) from public.handyman_files where job_id=j.id)>=10 then raise exception 'Choose up to ten job photos';end if;
 insert into public.handyman_files(job_id,kind,storage_path,original_name,mime_type,uploaded_by) values(j.id,'photo',p_path,p_name,p_mime,p_user);
end $fn$;

-- Private RPCs only: anon/authenticated cannot call financial commands or inspect
-- rivals' quotes/ranking. Existing legacy RPCs are not usable for quote jobs.
do $permissions$
declare f record;
begin
 for f in select p.oid::regprocedure as name from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in('handyman_category_open','handyman_quote_eligible','handyman_quote_ranking','handyman_quote_notify',
   'handyman_quote_slot','handyman_post_job','handyman_queue_refund','handyman_queue_payout','handyman_quote_command','handyman_claim_operation',
   'handyman_record_operation','handyman_quote_maintenance','handyman_resolve_dispute','handyman_stripe_review','add_handyman_file') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.name);
  execute format('grant execute on function %s to service_role',f.name);
 end loop;
end $permissions$;
revoke all on function public.guard_handyman_site_visit_calendar() from public,anon,authenticated,service_role;
revoke all on function public.add_handyman_file_before_quotes(uuid,uuid,text,text,text,text,integer) from public,anon,authenticated,service_role;
-- The public ratings view evaluates this Boolean only; no private information
-- is exposed by the category gate itself.
grant execute on function public.handyman_category_open(text) to anon,authenticated;
commit;
notify pgrst, 'reload schema';
