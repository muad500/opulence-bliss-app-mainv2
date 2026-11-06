begin;

create table public.staff_role_memberships (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  staff_role text not null check (staff_role in ('onboarding', 'manager', 'second_signoff', 'developer')),
  active boolean not null default true,
  assigned_by uuid references public.profiles(id),
  assigned_at timestamptz not null default now()
);
-- Preserve existing administrators; no new DBS entitlement is granted here.
insert into public.staff_role_memberships (profile_id, staff_role)
  select id, 'manager' from public.profiles where role::text = 'admin' and account_deleted_at is null;
alter table public.staff_role_memberships enable row level security;
revoke all on public.staff_role_memberships from public, anon, authenticated;
grant select on public.staff_role_memberships to authenticated;
grant all on public.staff_role_memberships to service_role;

create table public.staff_role_audit (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id),
  actor_id uuid not null references public.profiles(id),
  previous_role text,
  staff_role text not null,
  active boolean not null,
  reason text not null,
  created_at timestamptz not null default now()
);
alter table public.staff_role_audit enable row level security;
revoke all on public.staff_role_audit from public, anon, authenticated;
grant select on public.staff_role_audit to authenticated;
grant all on public.staff_role_audit to service_role;
create trigger staff_role_audit_immutable before update or delete on public.staff_role_audit
  for each row execute function public.booking_events_immutable();

-- Preserve is_admin's OID: existing RLS policies depend on that object.
-- Renaming it would leave those policies attached to the unrestricted helper.
create function public.staff_session_mfa()
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce(auth.jwt() ->> 'aal' = 'aal2', false)
    and exists (select 1 from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) entry
      where entry ->> 'method' = 'totp')
    and exists (select 1 from public.profiles where id = auth.uid() and role::text = 'admin' and
      account_deleted_at is null)
    and exists (select 1 from auth.mfa_factors where user_id = auth.uid() and factor_type = 'totp' and
      status = 'verified');
$fn$;
revoke all on function public.staff_session_mfa() from public, anon, authenticated, service_role;

-- Identity is deliberately available before MFA, only to the caller themselves.
-- It grants no access to staff data or operations.
create function public.current_staff_role()
returns text language sql stable security definer set search_path = public as $fn$
  select s.staff_role from public.staff_role_memberships s join public.profiles p on p.id = s.profile_id
  where s.profile_id = auth.uid() and s.active and p.role::text = 'admin' and p.account_deleted_at is null;
$fn$;
create function public.staff_has_permission(p_permission text)
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce(public.staff_session_mfa() and case public.current_staff_role()
    when 'manager' then p_permission in ('manage', 'onboarding', 'first_review', 'second_signoff',
      'suspend', 'private_evidence')
    when 'onboarding' then p_permission in ('onboarding', 'first_review', 'suspend', 'private_evidence')
    when 'second_signoff' then p_permission in ('onboarding', 'second_signoff')
    else false end, false);
$fn$;
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $fn$
  select public.staff_has_permission('manage');
$fn$;
create function public.can_review_professional()
returns boolean language sql stable security definer set search_path = public as $fn$
  select public.staff_has_permission('onboarding');
$fn$;
revoke all on function public.current_staff_role(), public.staff_has_permission(text), public.is_admin(),
  public.can_review_professional()
  from public, anon;
grant execute on function public.current_staff_role(), public.staff_has_permission(text),
  public.is_admin(), public.can_review_professional()
  to authenticated, service_role;
create policy staff_role_self_read on public.staff_role_memberships
  for select to authenticated using (profile_id = (select auth.uid()) or (select public.is_admin()));
create policy staff_role_audit_manager_read on public.staff_role_audit
  for select to authenticated using ((select public.is_admin()));

create function public.assign_staff_role(p_profile uuid, p_role text, p_active boolean, p_reason text)
returns void language plpgsql security definer set search_path = public as $fn$
declare previous text;
begin
  if not public.is_admin() then raise exception 'Manager authenticator sign-in required' using errcode =
    'insufficient_privilege'; end if;
  if p_profile = auth.uid() then raise exception 'A Manager cannot change their own staff access'; end if;
  if p_role not in ('onboarding', 'manager', 'second_signoff', 'developer') or p_active is null
    or length(btrim(coalesce(p_reason, ''))) < 10 then raise exception
      'Choose a role and record a reason'; end if;
  perform pg_advisory_xact_lock(hashtextextended('opulence-staff-role-assignments', 0));
  if not exists (select 1 from public.profiles where id = p_profile and role::text = 'admin' and
    account_deleted_at is null) then
    raise exception 'Choose an existing active named staff account'; end if;
  select staff_role into previous from public.staff_role_memberships where profile_id = p_profile;
  insert into public.staff_role_memberships (profile_id, staff_role, active, assigned_by)
    values (p_profile, p_role, p_active, auth.uid())
    on conflict (profile_id) do update set staff_role = excluded.staff_role, active = excluded.active,
      assigned_by = excluded.assigned_by, assigned_at = clock_timestamp();
  insert into public.staff_role_audit (profile_id, actor_id, previous_role, staff_role, active, reason)
    values (p_profile, auth.uid(), previous, p_role, p_active, left(btrim(p_reason), 1000));
end;
$fn$;
revoke all on function public.assign_staff_role(uuid, text, boolean, text) from public, anon;
grant execute on function public.assign_staff_role(uuid, text, boolean, text) to authenticated;

create function public.default_new_staff_scope()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if new.role::text = 'admin' then
    insert into public.staff_role_memberships (profile_id, staff_role) values (new.id, 'onboarding') on
      conflict do nothing;
  end if;
  return new;
end;
$fn$;
create trigger new_staff_default_scope after insert or update of role on public.profiles
  for each row execute function public.default_new_staff_scope();
revoke all on function public.default_new_staff_scope() from public, anon, authenticated, service_role;

-- Reuse PR #59's fingerprint, first reviewer, document-checker and inviter
-- guards. Only their staff predicate becomes role-aware; no approval bypass.
do $adapt_review_guards$
declare signature text; source text; definition text; revised text;
begin
  foreach signature in array array[
    'public.professional_approval_review_state(uuid,text)',
    'public.review_professional_service(uuid,text,text,text)',
    'public.review_professional_service_before_two_person(uuid,text,text,text)',
    'public.review_professional_service_before_client_documents(uuid,text,text,text)',
    'public.guard_independent_professional_activation()',
    'public.guard_professional_service_approvals()'
  ] loop
    if to_regprocedure(signature) is null then raise exception 'Required PR 59 guard missing: %',
      signature; end if;
    select prosrc, pg_get_functiondef(oid) into source, definition from pg_proc where oid =
      signature::regprocedure;
    revised := replace(source, 'public.is_admin()', 'public.can_review_professional()');
    if revised = source then raise exception 'Review guard changed; inspect before adapting: %',
      signature; end if;
    execute replace(definition, source, revised);
  end loop;
end;
$adapt_review_guards$;

do $preserve_review_state$
declare definition text; copied text;
begin
  select pg_get_functiondef('public.professional_approval_review_state(uuid,text)'::regprocedure) into
    definition;
  copied := regexp_replace(definition,
    '^CREATE OR REPLACE FUNCTION public\.professional_approval_review_state\(',
    'CREATE OR REPLACE FUNCTION public.professional_approval_review_state_before_staff_scope(');
  if copied = definition then raise exception 'Review state source changed; inspect before wrapping'; end if;
  execute copied;
end;
$preserve_review_state$;
create or replace function public.professional_approval_review_state(p_provider uuid, p_service text)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare state jsonb;
begin
  state := public.professional_approval_review_state_before_staff_scope(p_provider, p_service);
  if state ->> 'phase' in ('first', 'second') and not public.staff_has_permission(
    case when state ->> 'phase' = 'second' then 'second_signoff' else 'first_review' end
  ) then
    state := state || jsonb_build_object('canReview', false, 'message',
      case when state ->> 'phase' = 'second' then
        'Ask an independent second sign-off member or Manager to complete activation.'
      else 'An onboarding member or Manager must record the first review.' end);
  end if;
  return state;
end;
$fn$;
revoke all on function public.professional_approval_review_state_before_staff_scope(uuid, text) from
  public, anon, authenticated, service_role;

do $preserve_review_action$
declare definition text; copied text;
begin
  select pg_get_functiondef('public.review_professional_service(uuid,text,text,text)'::regprocedure)
    into definition;
  copied := regexp_replace(definition, '^CREATE OR REPLACE FUNCTION public\.review_professional_service\(',
    'CREATE OR REPLACE FUNCTION public.review_professional_service_before_staff_scope(');
  if copied = definition then raise exception 'Review action source changed; inspect before wrapping'; end if;
  execute copied;
end;
$preserve_review_action$;
create or replace function public.review_professional_service(p_provider uuid, p_service text, p_status text,
  p_reason text default null)
returns void language plpgsql security definer set search_path = public as $fn$
declare review jsonb;
begin
  if not public.can_review_professional() then raise exception 'Staff authenticator sign-in required'
    using errcode = 'insufficient_privilege'; end if;
  if p_status = 'approved' then
    review := public.professional_approval_review_state(p_provider, p_service);
    if not public.staff_has_permission(case when review ->> 'phase' = 'second' then 'second_signoff' else
      'first_review' end) then
      raise exception 'Your staff role cannot perform this review stage' using errcode =
        'insufficient_privilege'; end if;
  elsif p_status = 'suspended' then
    if not public.staff_has_permission('suspend') then
      raise exception 'Your staff role cannot suspend a service' using errcode = 'insufficient_privilege';
    end if;
  elsif not public.is_admin() then
    raise exception 'A Manager must decide or reopen an application' using errcode = 'insufficient_privilege';
  end if;
  perform public.review_professional_service_before_staff_scope(p_provider, p_service, p_status, p_reason);
end;
$fn$;
revoke all on function public.review_professional_service_before_staff_scope(uuid, text, text, text) from
  public, anon, authenticated, service_role;
revoke all on function public.review_professional_service(uuid, text, text, text) from public, anon;
grant execute on function public.review_professional_service(uuid, text, text, text) to authenticated;

create policy approval_reviews_scoped_staff on public.professional_approval_reviews
  for select to authenticated using ((select public.can_review_professional()));
create policy approval_audit_scoped_staff on public.professional_approval_audit
  for select to authenticated using ((select public.can_review_professional()));
create policy professional_onboarding_read on public.providers
  for select to authenticated using ((select public.can_review_professional()));

create or replace function public.can_view_dbs()
returns boolean language sql stable security definer set search_path = public as $fn$
  select public.staff_has_permission('private_evidence') and exists (
    select 1 from public.dbs_onboarding_staff where profile_id = auth.uid()
  );
$fn$;

create table public.private_evidence_access_events (
  id bigint generated always as identity primary key,
  actor_id uuid not null references public.profiles(id),
  provider_id uuid,
  document_type text not null,
  action text not null check (action in ('record_view', 'document_view', 'review')),
  allowed boolean not null,
  created_at timestamptz not null default now()
);
alter table public.private_evidence_access_events enable row level security;
revoke all on public.private_evidence_access_events from public, anon, authenticated;
grant select on public.private_evidence_access_events to authenticated;
grant all on public.private_evidence_access_events to service_role;
create policy evidence_audit_manager on public.private_evidence_access_events
  for select to authenticated using ((select public.is_admin()));
create trigger evidence_access_immutable before update or delete on public.private_evidence_access_events
  for each row execute function public.booking_events_immutable();

-- Returning a denial (rather than raising) makes the denied-attempt audit
-- durable. Private rows are never returned when the named/MFA check fails.
create function public.staff_open_verification_record(p_provider uuid, p_type text, p_action text default
  'record_view')
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare allowed boolean; record jsonb;
begin
  if auth.uid() is null then return jsonb_build_object('allowed', false); end if;
  if p_action not in ('record_view', 'document_view', 'review') or length(p_type) > 60 then raise
    exception 'Invalid access purpose'; end if;
  allowed := public.can_view_dbs();
  insert into public.private_evidence_access_events(actor_id, provider_id, document_type, action, allowed)
    values (auth.uid(), p_provider, p_type, p_action, allowed);
  if not allowed then return jsonb_build_object('allowed', false); end if;
  select to_jsonb(v) into record from public.provider_verification_items v where v.provider_id =
    p_provider and v.document_type = p_type;
  return jsonb_build_object('allowed', true, 'record', record);
end;
$fn$;
create function public.staff_open_dbs_record(p_provider uuid, p_action text default 'record_view')
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare allowed boolean; record jsonb;
begin
  if auth.uid() is null then return jsonb_build_object('allowed', false); end if;
  if p_action not in ('record_view', 'certificate_view', 'review') then raise exception
    'Invalid access purpose'; end if;
  allowed := public.can_view_dbs();
  insert into public.dbs_access_events(actor_id, provider_id, action, details)
    values (auth.uid(), p_provider, p_action, jsonb_build_object('allowed', allowed));
  if not allowed then return jsonb_build_object('allowed', false); end if;
  select to_jsonb(d) into record from public.provider_dbs_checks d where d.provider_id = p_provider;
  return jsonb_build_object('allowed', true, 'record', record);
end;
$fn$;
revoke all on function public.staff_open_verification_record(uuid, text, text),
  public.staff_open_dbs_record(uuid, text) from public, anon;
grant execute on function public.staff_open_verification_record(uuid, text, text),
  public.staff_open_dbs_record(uuid, text) to authenticated;

create or replace function public.staff_view_dbs_record(p_provider uuid, p_action text default 'record_view')
returns setof public.provider_dbs_checks
language plpgsql security definer set search_path = public as $fn$
declare access jsonb;
begin
  access := public.staff_open_dbs_record(p_provider, p_action);
  if access ->> 'allowed' = 'true' and access -> 'record' <> 'null'::jsonb then
    return query select * from jsonb_populate_record(null::public.provider_dbs_checks, access -> 'record');
  end if;
end;
$fn$;

-- Private staff reads must use an explicit audited opening, not a page render.
create policy verification_staff_reads_audited on public.provider_verification_items
  as restrictive for select to authenticated using (
    not exists (select 1 from public.staff_role_memberships s where s.profile_id = (select auth.uid()))
    or provider_id = public.current_provider_id()
  );
create policy verification_staff_files_audited on storage.objects
  as restrictive for select to authenticated using (
    bucket_id <> 'provider-verification'
    or not exists (select 1 from public.staff_role_memberships s where s.profile_id = (select auth.uid()))
    or (storage.foldername(name))[1] = public.current_provider_id()::text
  );

commit;
notify pgrst, 'reload schema';
