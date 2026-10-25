begin;

-- Empty by default: an MFA-signed-in administrator must explicitly name the
-- onboarding staff. Admin role alone is not permission to read DBS evidence.
create table public.dbs_onboarding_staff (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  granted_by uuid not null references public.profiles(id),
  granted_at timestamptz not null default now()
);
create table public.dbs_access_events (
  id bigint generated always as identity primary key,
  actor_id uuid not null references public.profiles(id),
  provider_id uuid,
  action text not null check (action in ('record_view','certificate_view','review','staff_list_changed')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.dbs_onboarding_staff enable row level security;
alter table public.dbs_access_events enable row level security;
revoke all on public.dbs_onboarding_staff, public.dbs_access_events from public, anon, authenticated;
grant select on public.dbs_onboarding_staff, public.dbs_access_events to authenticated;
grant all on public.dbs_onboarding_staff, public.dbs_access_events to service_role;
create policy "MFA admins read onboarding staff list" on public.dbs_onboarding_staff
for select to authenticated using (public.is_admin());
create policy "MFA admins read DBS access audit" on public.dbs_access_events
for select to authenticated using (public.is_admin());
create trigger dbs_access_events_append_only before update or delete on public.dbs_access_events
for each row execute function public.booking_events_immutable();

create or replace function public.can_view_dbs()
returns boolean language sql stable security definer set search_path = public as $fn$
  select public.is_admin() and exists (
    select 1 from public.dbs_onboarding_staff where profile_id = auth.uid()
  );
$fn$;
revoke all on function public.can_view_dbs() from public, anon;
grant execute on function public.can_view_dbs() to authenticated;

create or replace function public.set_dbs_onboarding_staff(p_ids uuid[])
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if not public.is_admin() then raise exception 'Authenticator staff sign-in required' using errcode='insufficient_privilege'; end if;
  if p_ids is null or cardinality(p_ids) > 100 or exists (
    select 1 from unnest(p_ids) u(id) left join public.profiles p on p.id=u.id
    where p.id is null or p.role::text <> 'admin' or p.account_deleted_at is not null
  ) then raise exception 'Choose active staff accounts only' using errcode='check_violation'; end if;
  perform pg_advisory_xact_lock(hashtextextended('dbs_onboarding_staff',0));
  insert into public.dbs_access_events(actor_id,action,details)
    values(auth.uid(),'staff_list_changed',jsonb_build_object(
      'previous',coalesce((select jsonb_agg(profile_id) from public.dbs_onboarding_staff),'[]'::jsonb),
      'selected',to_jsonb(p_ids)));
  delete from public.dbs_onboarding_staff where not (profile_id = any(p_ids));
  insert into public.dbs_onboarding_staff(profile_id,granted_by)
    select distinct id,auth.uid() from unnest(p_ids) u(id) on conflict do nothing;
end
$fn$;
revoke all on function public.set_dbs_onboarding_staff(uuid[]) from public, anon;
grant execute on function public.set_dbs_onboarding_staff(uuid[]) to authenticated;

-- Staff reads must use this RPC so access and audit commit together. No
-- unlogged direct table/storage read is allowed for staff, including named ones.
create or replace function public.staff_view_dbs_record(p_provider uuid, p_action text default 'record_view')
returns setof public.provider_dbs_checks
language plpgsql security definer set search_path = public as $fn$
begin
  if not public.can_view_dbs() then raise exception 'Only named onboarding staff can view DBS records' using errcode='insufficient_privilege'; end if;
  if p_action not in ('record_view','certificate_view','review') then
    raise exception 'Invalid DBS access purpose' using errcode='check_violation';
  end if;
  insert into public.dbs_access_events(actor_id,provider_id,action)
    values(auth.uid(),p_provider,p_action);
  return query select * from public.provider_dbs_checks where provider_id=p_provider;
end
$fn$;
revoke all on function public.staff_view_dbs_record(uuid,text) from public, anon;
grant execute on function public.staff_view_dbs_record(uuid,text) to authenticated;

drop policy "applicants and admins read DBS evidence" on public.provider_dbs_checks;
create policy "applicants read their own DBS evidence" on public.provider_dbs_checks
for select to authenticated using (provider_id = public.current_provider_id());
create policy "DBS direct reads restricted even if another permissive policy exists"
on public.provider_dbs_checks as restrictive for select to authenticated
using (provider_id = public.current_provider_id());
drop policy "applicants and admins read DBS certificates" on storage.objects;
create policy "applicants read their own DBS certificate" on storage.objects
for select to authenticated using (
  bucket_id='provider-dbs' and (storage.foldername(name))[1]=public.current_provider_id()::text
);
create policy "DBS files never inherit broader staff storage access"
on storage.objects as restrictive for select to authenticated
using (bucket_id<>'provider-dbs' or (storage.foldername(name))[1]=public.current_provider_id()::text);
comment on table public.provider_dbs_checks is
  'Applicant self-access; staff access only via the named-onboarding, MFA-gated, audited RPC.';

commit;
