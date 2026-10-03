begin;
-- Finished visits count their recorded time against the professional's day cap.
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
 select coalesce(sum(minutes),0) into day_minutes from(select coalesce(b.duration_minutes,120) as minutes from public.bookings b where b.provider_id=p.id and b.status::text in('scheduled','in_progress','completed','needs_review') and(b.scheduled_at at time zone 'Europe/London')::date=local_start::date union all select greatest(60,coalesce(j.worked_minutes,j.estimated_minutes)) from public.handyman_jobs j where j.provider_id=p.id and j.id is distinct from p_exclude and(j.status in('scheduled','in_progress','awaiting_customer','awaiting_authorization','payment_pending','cancel_pending','completed') or(j.status='checkout_pending' and j.created_at>now()-interval '1 hour')) and(j.scheduled_at at time zone 'Europe/London')::date=local_start::date) daily;
 return day_minutes+p_minutes<=coalesce(s.max_daily_hours,8)*60;
end $fn$;

create or replace function public.guard_cleaning_against_handyman_jobs()
returns trigger language plpgsql security definer set search_path=public as $fn$
declare day_minutes integer;maximum integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('professional-schedule:'||new.provider_id::text,0));
 if exists(select 1 from public.handyman_jobs j where j.provider_id=new.provider_id and(j.status in('scheduled','in_progress','awaiting_customer','awaiting_authorization','payment_pending','cancel_pending') or(j.status='checkout_pending' and j.created_at>now()-interval '1 hour')) and j.scheduled_at<new.scheduled_at+make_interval(mins=>coalesce(new.duration_minutes,120)) and j.scheduled_at+make_interval(mins=>j.estimated_minutes)>new.scheduled_at) then raise exception 'Professional has a handyman reservation at this time' using errcode='check_violation';end if;
 select coalesce(max_daily_hours,8)*60 into maximum from public.provider_profile_settings where provider_id=new.provider_id;
 select coalesce(sum(minutes),0) into day_minutes from(select coalesce(b.duration_minutes,120) minutes from public.bookings b where b.provider_id=new.provider_id and b.id<>new.id and b.status::text in('scheduled','in_progress','completed','needs_review') and(b.scheduled_at at time zone 'Europe/London')::date=(new.scheduled_at at time zone 'Europe/London')::date union all select greatest(60,coalesce(j.worked_minutes,j.estimated_minutes)) from public.handyman_jobs j where j.provider_id=new.provider_id and(j.status in('scheduled','in_progress','awaiting_customer','awaiting_authorization','payment_pending','cancel_pending','completed') or(j.status='checkout_pending' and j.created_at>now()-interval '1 hour')) and(j.scheduled_at at time zone 'Europe/London')::date=(new.scheduled_at at time zone 'Europe/London')::date) daily;
 if day_minutes+coalesce(new.duration_minutes,120)>coalesce(maximum,480) then raise exception 'Professional daily hours exceeded' using errcode='check_violation';end if;return new;
end $fn$;
commit;
