begin;
create table public.cleaning_job_evidence_control (
  id boolean primary key default true check(id), enabled boolean not null default false
);
insert into public.cleaning_job_evidence_control(id,enabled) values(true,false);
alter table public.cleaning_job_evidence_control enable row level security;
revoke all on public.cleaning_job_evidence_control from public,anon,authenticated;
grant select,update on public.cleaning_job_evidence_control to service_role;
create table public.cleaning_job_evidence (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  package_name text not null,
  required boolean not null default false,
  tasks jsonb not null check(jsonb_typeof(tasks)='array'),
  scope_confirmed_at timestamptz,
  hazards_reviewed_at timestamptz,
  hazard_note text check(char_length(hazard_note)<=2000),
  completed_tasks jsonb not null default '{}' check(jsonb_typeof(completed_tasks)='object'),
  photo_note text check(char_length(photo_note)<=1000),
  finished_at timestamptz,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
create table public.cleaning_job_photos (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.cleaning_job_evidence(booking_id) on delete cascade,
  provider_id uuid not null references public.providers(id),
  stage text not null check(stage in ('before','after')),
  storage_path text not null unique,
  created_at timestamptz not null default now()
);
alter table public.cleaning_job_evidence enable row level security;
alter table public.cleaning_job_photos enable row level security;
revoke all on public.cleaning_job_evidence,public.cleaning_job_photos from public,anon,authenticated;
grant select on public.cleaning_job_evidence,public.cleaning_job_photos to authenticated;
grant all on public.cleaning_job_evidence,public.cleaning_job_photos to service_role;
create policy "booking participants read work evidence" on public.cleaning_job_evidence for select to authenticated
using(public.is_admin() or exists(select 1 from public.bookings b where b.id=booking_id
  and (b.customer_id=auth.uid() or b.provider_id=public.current_provider_id())));
create policy "booking participants read work photo metadata" on public.cleaning_job_photos for select to authenticated
using(public.is_admin() or exists(select 1 from public.bookings b where b.id=booking_id
  and (b.customer_id=auth.uid() or b.provider_id=public.current_provider_id())));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('cleaning-job-photos','cleaning-job-photos',false,2097152,array['image/jpeg']);
-- There are deliberately no public/direct Storage policies. Routes verify the
-- live booking participant before streaming a file; EXIF is stripped on upload.

create function public.snapshot_cleaning_job_evidence()
returns trigger language plpgsql security definer set search_path=public as $fn$
declare p public.packages;
begin
  select * into p from public.packages where id=new.package_id and service_type='cleaning';
  if found and coalesce(cardinality(p.inclusions),0)>0 then
    insert into public.cleaning_job_evidence(booking_id,package_name,tasks,required)
    values(new.id,p.name,to_jsonb(p.inclusions),coalesce((select enabled from public.cleaning_job_evidence_control where id),false));
  end if;
  return new;
end;
$fn$;
revoke all on function public.snapshot_cleaning_job_evidence() from public,anon,authenticated,service_role;
-- No retrospective checklist requirement for existing bookings.
create trigger snapshot_cleaning_job_evidence after insert on public.bookings
for each row execute function public.snapshot_cleaning_job_evidence();

create function public.add_cleaning_job_photo(p_booking uuid,p_user uuid,p_stage text,p_path text)
returns void language plpgsql security definer set search_path=public as $fn$
declare b public.bookings;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service role required'; end if;
  select * into strict b from public.bookings where id=p_booking for update;
  if not exists(select 1 from public.providers where id=b.provider_id and profile_id=p_user and not is_suspended)
    or b.status::text not in ('scheduled','in_progress') or p_stage not in ('before','after')
    or not starts_with(p_path,p_booking::text||'/') or p_path !~ '\.jpg$'
    or exists(select 1 from public.cleaning_job_evidence where booking_id=p_booking and finished_at is not null)
    then raise exception 'This visit cannot receive work photos'; end if;
  if (select count(*) from public.cleaning_job_photos where booking_id=p_booking and stage=p_stage)>=6
    then raise exception 'Six photos per stage maximum'; end if;
  insert into public.cleaning_job_photos(booking_id,provider_id,stage,storage_path)
  values(p_booking,b.provider_id,p_stage,p_path);
end;
$fn$;
revoke all on function public.add_cleaning_job_photo(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.add_cleaning_job_photo(uuid,uuid,text,text) to service_role;

create function public.save_cleaning_job_evidence(p_booking uuid,p_scope boolean,p_hazards boolean,
 p_hazard_note text,p_tasks jsonb,p_photo_note text,p_finish boolean)
returns void language plpgsql security definer set search_path=public as $fn$
declare b public.bookings; e public.cleaning_job_evidence; entry record;
begin
  select * into strict b from public.bookings where id=p_booking for update;
  if b.provider_id is distinct from public.current_provider_id() or auth.uid() is null
    or b.status::text not in ('scheduled','in_progress') then
    raise exception 'Only the assigned cleaner can record work on an active visit' using errcode='insufficient_privilege';
  end if;
  select * into strict e from public.cleaning_job_evidence where booking_id=p_booking for update;
  if e.finished_at is not null then raise exception 'The completed checklist is already saved'; end if;
  if char_length(coalesce(p_hazard_note,''))>2000 or char_length(coalesce(p_photo_note,''))>1000
    or jsonb_typeof(p_tasks) is distinct from 'object' then raise exception 'Check the job notes'; end if;
  for entry in select * from jsonb_each(p_tasks) loop
    if entry.key !~ '^(0|[1-9][0-9]{0,2})$' or entry.key::integer>=jsonb_array_length(e.tasks)
      or coalesce(entry.value->>'result','') not in ('done','not_applicable')
      or char_length(coalesce(entry.value->>'reason',''))>500
      or (entry.value->>'result'='not_applicable' and char_length(btrim(coalesce(entry.value->>'reason','')))<5)
      then raise exception 'Complete each task or explain why it does not apply'; end if;
  end loop;
  if p_finish then
    if b.status::text<>'in_progress' or e.scope_confirmed_at is null or e.hazards_reviewed_at is null
      or (select count(*) from jsonb_object_keys(p_tasks))<>jsonb_array_length(e.tasks)
      then raise exception 'Review the agreed scope and complete every checklist item'; end if;
    if not exists(select 1 from public.cleaning_job_photos where booking_id=p_booking and stage='after')
      and char_length(btrim(coalesce(p_photo_note,'')))<10 then
      raise exception 'Add finished-work photos or explain why they were not required or safe'; end if;
  end if;
  -- Never force somebody to photograph a hazard when it is unsafe. Preserve a
  -- factual note and notify staff; photos are collected where safe/appropriate.
  if char_length(btrim(coalesce(p_hazard_note,'')))>0 and e.hazard_note is distinct from nullif(btrim(p_hazard_note),'') then
    insert into public.notifications(user_id,title,body,href)
    select id,'Work hazard reported','An assigned cleaner recorded pre-existing damage or a hazard. Review the work record and contact them.','/admin/bookings?booking='||p_booking
    from public.profiles where role::text='admin' and account_deleted_at is null;
  end if;
  update public.cleaning_job_evidence set
    scope_confirmed_at=case when p_scope then coalesce(scope_confirmed_at,now()) else scope_confirmed_at end,
    hazards_reviewed_at=case when p_hazards then coalesce(hazards_reviewed_at,now()) else hazards_reviewed_at end,
    hazard_note=nullif(btrim(p_hazard_note),''), completed_tasks=p_tasks,
    photo_note=nullif(btrim(p_photo_note),''),finished_at=case when p_finish then now() end,
    updated_by=auth.uid(),updated_at=now() where booking_id=p_booking;
end;
$fn$;
revoke all on function public.save_cleaning_job_evidence(uuid,boolean,boolean,text,jsonb,text,boolean)
from public,anon,authenticated,service_role;
grant execute on function public.save_cleaning_job_evidence(uuid,boolean,boolean,text,jsonb,text,boolean) to authenticated;

create function public.guard_cleaning_job_evidence()
returns trigger language plpgsql security definer set search_path=public as $fn$
declare e public.cleaning_job_evidence;
begin
  if new.status is not distinct from old.status then return new; end if;
  select * into e from public.cleaning_job_evidence where booking_id=new.id;
  if not found or not e.required then return new; end if;
  if new.status::text='in_progress' and (e.scope_confirmed_at is null or e.hazards_reviewed_at is null) then
    raise exception 'Complete the before-work checklist before check-in';
  end if;
  if new.status::text='completed' and e.finished_at is null then
    raise exception 'Complete the job checklist and photo step before checking out'; end if;
  return new;
end;
$fn$;
revoke all on function public.guard_cleaning_job_evidence() from public,anon,authenticated,service_role;
create trigger guard_cleaning_job_evidence before update of status on public.bookings
for each row execute function public.guard_cleaning_job_evidence();

-- Extend the existing audited/hold-aware file cleanup, not a separate deletion cron.
alter function public.retention_candidates() rename to retention_candidates_before_work_photos;
revoke all on function public.retention_candidates_before_work_photos() from public,anon,authenticated,service_role;
create function public.retention_candidates()
returns table(category text,entity_id text,scope jsonb,files jsonb)
language sql stable security definer set search_path=public as $fn$
select * from public.retention_candidates_before_work_photos()
union all
select 'job_photos',p.id::text,jsonb_build_object('booking',b.id,'type','cleaning_work'),
 jsonb_build_array(jsonb_build_object('bucket','cleaning-job-photos','path',p.storage_path))
from public.cleaning_job_photos p join public.bookings b on b.id=p.booking_id
where b.status::text in ('completed','cancelled') and b.retention_ended_at<=now()-interval '12 months';
$fn$;
revoke all on function public.retention_candidates() from public,anon,authenticated;
grant execute on function public.retention_candidates() to service_role;
alter function public.apply_retention_candidate(text,text,jsonb) rename to apply_retention_candidate_before_work_photos;
revoke all on function public.apply_retention_candidate_before_work_photos(text,text,jsonb) from public,anon,authenticated,service_role;
create function public.apply_retention_candidate(p_category text,p_entity text,p_scope jsonb)
returns void language plpgsql security definer set search_path=public as $fn$
begin
  if p_category='job_photos' and p_scope->>'type'='cleaning_work' then
    if not public.retention_delete_authorised() or public.retention_has_hold(p_scope) then raise exception 'Record is protected'; end if;
    if not exists(select 1 from public.retention_candidates() where category=p_category and entity_id=p_entity and scope=p_scope)
      then raise exception 'Retention candidate changed'; end if;
    delete from public.cleaning_job_photos where id=p_entity::uuid;
  else perform public.apply_retention_candidate_before_work_photos(p_category,p_entity,p_scope); end if;
end;
$fn$;
revoke all on function public.apply_retention_candidate(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.apply_retention_candidate(text,text,jsonb) to service_role;
commit;
