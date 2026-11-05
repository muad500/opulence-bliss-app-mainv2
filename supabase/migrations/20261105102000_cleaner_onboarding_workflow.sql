begin;

-- These records precede an account. All mutating staff operations use the
-- caller's JWT, preserve the ordered stages and never create a provider.
alter table public.cleaner_applications add column declaration_ip inet;

create schema cleaner_onboarding_private;
revoke all on schema cleaner_onboarding_private
  from public, anon, authenticated, service_role;

create table cleaner_onboarding_private.source_readiness (
  source_key text primary key,
  supplied_version text,
  ready boolean not null default false,
  check (not ready or nullif(btrim(supplied_version), '') is not null)
);
insert into cleaner_onboarding_private.source_readiness(source_key) values
  ('deskScreening'), ('interviewCriteria'), ('liveIdentityCheck');
-- No UI/API can mark a missing source as supplied. Seed approved versions only
-- after the client sends them; until then affected completion stays blocked.

create table cleaner_onboarding_private.stages (
  application_id uuid not null references public.cleaner_applications(id) on delete cascade,
  stage text not null check (stage in (
    'screened', 'interviewed', 'id_rtw_verified', 'dbs_recorded', 'experience_checked'
  )),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  recorded_by uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),
  completed_by uuid,
  completed_at timestamptz,
  primary key (application_id, stage)
);
create table cleaner_onboarding_private.case_locks (
  application_id uuid primary key references public.cleaner_applications(id) on delete cascade,
  opened_by uuid not null,
  opened_at timestamptz not null default clock_timestamp(),
  resolved_by uuid,
  resolved_at timestamptz
);
create table cleaner_onboarding_private.events (
  id bigint generated always as identity primary key,
  application_id uuid not null references public.cleaner_applications(id) on delete cascade,
  actor uuid not null,
  action text not null,
  stage text,
  note text not null,
  created_at timestamptz not null default clock_timestamp()
);
create table cleaner_onboarding_private.intake_limits (
  rate_key text not null check (rate_key ~ '^[a-f0-9]{64}$'),
  hour timestamptz not null,
  attempts integer not null default 1,
  primary key (rate_key, hour)
);
alter table cleaner_onboarding_private.source_readiness enable row level security;
alter table cleaner_onboarding_private.stages enable row level security;
alter table cleaner_onboarding_private.case_locks enable row level security;
alter table cleaner_onboarding_private.events enable row level security;
alter table cleaner_onboarding_private.intake_limits enable row level security;
revoke all on all tables in schema cleaner_onboarding_private
  from public, anon, authenticated, service_role;
revoke all on all sequences in schema cleaner_onboarding_private
  from public, anon, authenticated, service_role;
-- Bounded staff RPCs replace raw rows: a locked file must not remain readable
-- by calling PostgREST directly instead of using the console.
revoke select on public.cleaner_applications, public.cleaner_application_communications from authenticated;

create function public.intake_cleaner_application(
  p_details jsonb, p_declaration text, p_source text, p_privacy_version text,
  p_ip inet, p_rate_key text
)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare
  v_count integer;
  v_id uuid;
begin
  if p_rate_key is null or p_rate_key !~ '^[a-f0-9]{64}$' then
    raise exception 'Rate limit is unavailable.';
  end if;
  insert into cleaner_onboarding_private.intake_limits(rate_key, hour)
  values (p_rate_key, date_trunc('hour', clock_timestamp()))
  on conflict (rate_key, hour) do update
    set attempts = cleaner_onboarding_private.intake_limits.attempts + 1
  returning attempts into v_count;
  delete from cleaner_onboarding_private.intake_limits
    where hour < clock_timestamp() - interval '24 hours';
  if v_count > 5 then return jsonb_build_object('limited', true); end if;
  begin
    v_id := public.submit_cleaner_application(
      p_details, p_declaration, p_source, p_privacy_version
    );
  exception when check_violation then
    -- The same outward result avoids revealing whether an email/phone has
    -- applied, failed an assessment or is still within the reapplication wait.
    return jsonb_build_object('ok', true);
  end;
  update public.cleaner_applications set declaration_ip = p_ip where id = v_id;
  return jsonb_build_object('ok', true);
end;
$fn$;

create function cleaner_onboarding_private.assert_staff(p_application uuid, p_write boolean)
returns void language plpgsql security definer set search_path = '' as $fn$
begin
  if not public.staff_has_permission(case when p_write then 'first_review' else 'onboarding' end) then
    raise exception 'Onboarding authenticator sign-in required.' using errcode = 'insufficient_privilege';
  end if;
  perform 1 from public.cleaner_applications where id = p_application for update;
  if not found then raise exception 'Application not found.'; end if;
  if exists (
    select 1 from cleaner_onboarding_private.case_locks
    where application_id = p_application and resolved_at is null
  ) and not public.staff_has_permission('manage') then
    raise exception 'This file is locked for Manager review.' using errcode = 'insufficient_privilege';
  end if;
end;
$fn$;

create function public.staff_cleaner_applications()
returns jsonb language plpgsql security definer set search_path = '' as $fn$
begin
  if not public.staff_has_permission('onboarding') then
    raise exception 'Onboarding authenticator sign-in required.' using errcode = 'insufficient_privilege';
  end if;
  return coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc) from (
    select a.id, a.created_at, a.full_name, a.status, a.declaration_pending,
      exists (select 1 from cleaner_onboarding_private.case_locks l
        where l.application_id = a.id and l.resolved_at is null) as manager_review
    from public.cleaner_applications a order by a.created_at desc limit 100
  ) r), '[]'::jsonb);
end;
$fn$;

-- Explicit POST opening, not prefetch or polling: private ID/DBS records need
-- the same named access as existing professional records and a view audit.
create function public.staff_open_cleaner_application(p_application uuid, p_private boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare v_result jsonb;
begin
  perform cleaner_onboarding_private.assert_staff(p_application, false);
  if p_private and (not public.staff_has_permission('private_evidence') or not public.can_view_dbs()) then
    raise exception 'Named onboarding access required.' using errcode = 'insufficient_privilege';
  end if;
  insert into cleaner_onboarding_private.events(application_id, actor, action, note)
    values (p_application, auth.uid(), case when p_private then 'private_record_opened' else 'record_opened' end,
      'Deliberate staff record opening');
  select jsonb_build_object(
    'application', to_jsonb(a) - 'declaration_ip',
    'managerReview', exists (select 1 from cleaner_onboarding_private.case_locks l
      where l.application_id = a.id and l.resolved_at is null),
    'stages', coalesce((select jsonb_agg(to_jsonb(s)) from cleaner_onboarding_private.stages s
      where s.application_id = a.id and (p_private or s.stage not in ('id_rtw_verified', 'dbs_recorded'))), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc) from (
      select id, actor, action, stage, note, created_at from cleaner_onboarding_private.events
      where application_id = a.id and (p_private or stage is null or stage not in ('id_rtw_verified', 'dbs_recorded'))
      order by id desc limit 100
    ) e), '[]'::jsonb),
    'communications', coalesce((select jsonb_agg(jsonb_build_object('template', c.template_key, 'status', c.status))
      from public.cleaner_application_communications c where c.application_id = a.id), '[]'::jsonb)
  ) into v_result from public.cleaner_applications a where a.id = p_application;
  return v_result;
end;
$fn$;

create function public.staff_record_cleaner_application(
  p_application uuid, p_action text, p_stage text, p_details jsonb, p_note text
)
returns void language plpgsql security definer set search_path = '' as $fn$
declare
  v_status text;
  v_previous text;
  v_source text;
  v_details jsonb;
begin
  perform cleaner_onboarding_private.assert_staff(p_application, true);
  if p_action is null or p_action not in ('record', 'complete', 'escalate', 'resolve', 'reject')
    or char_length(btrim(coalesce(p_note, ''))) not between 10 and 2000 then
    raise exception 'Record a valid action and reason.';
  end if;
  select status into strict v_status from public.cleaner_applications where id = p_application;
  if v_status in ('active', 'suspended', 'closed', 'not_progressed') and p_action <> 'resolve' then
    raise exception 'This application stage is closed.';
  end if;
  if p_action in ('escalate', 'resolve', 'reject') then
    if p_action = 'escalate' then
      insert into cleaner_onboarding_private.case_locks(application_id, opened_by)
        values (p_application, auth.uid()) on conflict (application_id) do update
        set opened_by = auth.uid(), opened_at = clock_timestamp(), resolved_by = null, resolved_at = null;
    else
      if not public.staff_has_permission('manage') then
        raise exception 'Manager decision required.' using errcode = 'insufficient_privilege';
      end if;
      if p_action = 'resolve' then
        update cleaner_onboarding_private.case_locks set resolved_by = auth.uid(), resolved_at = clock_timestamp()
          where application_id = p_application and resolved_at is null;
        if not found then raise exception 'There is no open escalation.'; end if;
      else
        update public.cleaner_applications set status = 'not_progressed', decision_at = clock_timestamp(),
          retention_due_at = clock_timestamp() + interval '6 months' where id = p_application;
        insert into public.cleaner_application_communications(application_id, template_key)
          values (p_application, 'applicationRejected') on conflict do nothing;
        -- Rejection revokes an existing limited session. Late writing marking
        -- cannot reopen the application. No automatic score is changed.
        update cleaner_assessment_private.invitations set session_hash = null,
          expires_at = least(expires_at, clock_timestamp()) where application_id = p_application;
        update cleaner_assessment_private.attempts set phase = 'failed',
          failure_reason = 'application not progressed', decided_at = clock_timestamp()
          where invitation_id in (select id from cleaner_assessment_private.invitations
            where application_id = p_application)
            and phase in ('questions', 'writing', 'writing_review', 'manager_review');
        p_stage := v_status;
      end if;
    end if;
  else
    if p_stage is null or p_stage not in (
      'screened', 'interviewed', 'id_rtw_verified', 'dbs_recorded', 'experience_checked'
    ) then raise exception 'Choose a valid stage.'; end if;
    if p_stage in ('id_rtw_verified', 'dbs_recorded') and
      (not public.staff_has_permission('private_evidence') or not public.can_view_dbs()) then
      raise exception 'Named onboarding access required.' using errcode = 'insufficient_privilege';
    end if;
    if p_action = 'record' then
      if p_details is null or jsonb_typeof(p_details) <> 'object' or length(p_details::text) > 6000 then
        raise exception 'Check the stage details.';
      end if;
      -- Keep details deliberately bounded. In particular, do not accept full
      -- ID numbers, offence narratives, medical adjustment data or score input.
      if exists (select 1 from jsonb_object_keys(p_details) k where k <> all(case p_stage
        when 'screened' then array['note']
        when 'interviewed' then array['notes', 'score']
        when 'id_rtw_verified' then array['checked_on', 'document_type', 'outcome', 'expires_on', 'no_expiry', 'self_employment_permitted']
        when 'dbs_recorded' then array['certificate_name', 'certificate_number', 'issue_date', 'outcome', 'review_on']
        else array['evidence', 'manager_waiver'] end)) then
        raise exception 'Unsupported private record field.';
      end if;
      insert into cleaner_onboarding_private.stages(application_id, stage, details, recorded_by)
        values (p_application, p_stage, p_details, auth.uid())
      on conflict (application_id, stage) do update set details = excluded.details,
        recorded_by = auth.uid(), recorded_at = clock_timestamp()
        where cleaner_onboarding_private.stages.completed_at is null;
      if not found then raise exception 'A completed stage cannot be rewritten.'; end if;
    else
      v_previous := case p_stage when 'screened' then 'applied' when 'interviewed' then 'screened'
        when 'id_rtw_verified' then 'interviewed' when 'dbs_recorded' then 'id_rtw_verified'
        else 'dbs_recorded' end;
      if v_status <> v_previous then raise exception 'Complete the earlier stages first.'; end if;
      v_source := case p_stage when 'screened' then 'deskScreening' when 'interviewed' then 'interviewCriteria'
        when 'id_rtw_verified' then 'liveIdentityCheck' else null end;
      if v_source is not null and not exists (select 1 from cleaner_onboarding_private.source_readiness
        where source_key = v_source and ready) then
        raise exception 'The client source checklist has not been supplied.';
      end if;
      select details into v_details from cleaner_onboarding_private.stages
        where application_id = p_application and stage = p_stage and completed_at is null;
      if v_details is null then raise exception 'Record the stage evidence first.'; end if;
      if p_stage = 'id_rtw_verified' then
        if coalesce(v_details->>'checked_on', '') = '' or (v_details->>'checked_on')::date > current_date
          or nullif(btrim(v_details->>'document_type'), '') is null or v_details->>'outcome' is distinct from 'verified'
          or v_details->>'self_employment_permitted' is distinct from 'true'
          or not (coalesce((v_details->>'no_expiry')::boolean, false)
            or coalesce(nullif(v_details->>'expires_on', '')::date > current_date, false)) then
          raise exception 'Record a valid live right-to-work check permitting self-employment.';
        end if;
      elsif p_stage = 'dbs_recorded' then
        if nullif(btrim(v_details->>'certificate_name'), '') is null
          or coalesce(v_details->>'certificate_number', '') !~ '^[0-9]{12}$'
          or coalesce(v_details->>'issue_date', '') = '' or (v_details->>'issue_date')::date > current_date
          or (v_details->>'issue_date')::date + interval '3 years' <= clock_timestamp()
          or coalesce(v_details->>'outcome', '') not in ('clear', 'unspent_conviction') then
          raise exception 'Record the basic DBS outcome.';
        end if;
        if v_details->>'outcome' = 'unspent_conviction' and not public.staff_has_permission('manage') then
          raise exception 'A conviction needs the Manager decision.' using errcode = 'insufficient_privilege';
        end if;
      elsif p_stage = 'experience_checked' then
        if v_details->>'manager_waiver' = 'true' then
          if not public.staff_has_permission('manage') then
            raise exception 'Only a Manager can waive experience evidence.' using errcode = 'insufficient_privilege';
          end if;
        elsif nullif(btrim(v_details->>'evidence'), '') is null then
          raise exception 'Record a reference or proof of experience.';
        end if;
      end if;
      update cleaner_onboarding_private.stages set completed_by = auth.uid(), completed_at = clock_timestamp()
        where application_id = p_application and stage = p_stage;
      update public.cleaner_applications set status = p_stage where id = p_application;
    end if;
  end if;
  insert into cleaner_onboarding_private.events(application_id, actor, action, stage, note)
    values (p_application, auth.uid(), p_action, p_stage, btrim(p_note));
end;
$fn$;

-- Open escalations protect the application and its assessment even if a
-- Manager has not separately set a legal-hold flag.
create or replace function public.purge_expired_cleaner_applications()
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare v_attempts integer := 0; v_applications integer := 0;
begin
  with expired as (
    select a.id from cleaner_assessment_private.attempts a
    join cleaner_assessment_private.invitations i on i.id = a.invitation_id
    join public.cleaner_applications c on c.id = i.application_id
    where not c.legal_hold and not exists (
      select 1 from cleaner_onboarding_private.case_locks l
      where l.application_id = c.id and l.resolved_at is null
    ) and a.decided_at + interval '6 months' <= clock_timestamp()
      and a.phase in ('passed', 'failed') order by a.id limit 100 for update of c, a skip locked
  ), removed as (
    delete from cleaner_assessment_private.attempts where id in (select id from expired) returning id
  ) select count(*) into v_attempts from removed;
  with expired as (
    select c.id from public.cleaner_applications c where not c.legal_hold
      and not exists (select 1 from cleaner_onboarding_private.case_locks l
        where l.application_id = c.id and l.resolved_at is null)
      and c.status in ('not_progressed', 'closed') and c.retention_due_at <= clock_timestamp()
    order by c.id limit 100 for update skip locked
  ), removed as (
    delete from public.cleaner_applications where id in (select id from expired) returning id
  ) select count(*) into v_applications from removed;
  return jsonb_build_object('assessments', v_attempts, 'applications', v_applications);
end;
$fn$;

-- The existing assessment console is another route into the same file. Wrap
-- its reads and writes so a Manager lock cannot be bypassed through an older
-- RPC. Original marking/timing logic stays unchanged in the private schema.
alter function public.staff_cleaner_assessment_overview(uuid) set schema cleaner_onboarding_private;
alter function public.staff_adjust_cleaner_assessment(uuid,integer) set schema cleaner_onboarding_private;
alter function public.staff_cleaner_assessment_host(uuid,boolean,uuid,boolean,text) set schema cleaner_onboarding_private;
alter function public.staff_mark_cleaner_writing(uuid,boolean,text) set schema cleaner_onboarding_private;

create function public.staff_cleaner_assessment_overview(p_application uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare v_rows jsonb;
begin
  if not public.staff_has_permission('onboarding') then
    raise exception 'Onboarding authenticator sign-in required.' using errcode = 'insufficient_privilege';
  end if;
  v_rows := cleaner_onboarding_private.staff_cleaner_assessment_overview(p_application);
  return coalesce((select jsonb_agg(r) from jsonb_array_elements(v_rows) r
    where public.staff_has_permission('manage') or not exists (
      select 1 from cleaner_onboarding_private.case_locks l
      where l.application_id = (r->>'application_id')::uuid and l.resolved_at is null
    )), '[]'::jsonb);
end;
$fn$;
create function public.staff_adjust_cleaner_assessment(p_application uuid, p_multiplier integer)
returns void language plpgsql security definer set search_path = '' as $fn$
begin
  perform cleaner_onboarding_private.assert_staff(p_application, true);
  perform cleaner_onboarding_private.staff_adjust_cleaner_assessment(p_application, p_multiplier);
end;
$fn$;
create function public.staff_cleaner_assessment_host(
  p_host uuid, p_open boolean, p_application uuid, p_attended boolean, p_reason text
)
returns uuid language plpgsql security definer set search_path = '' as $fn$
declare v_id uuid;
begin
  if not public.staff_has_permission('first_review') then
    raise exception 'Onboarding authenticator sign-in required.' using errcode = 'insufficient_privilege';
  end if;
  if p_application is not null then
    perform cleaner_onboarding_private.assert_staff(p_application, true);
  elsif p_host is not null then
    for v_id in select application_id from cleaner_assessment_private.invitations
      where host_session_id = p_host order by application_id
    loop
      perform cleaner_onboarding_private.assert_staff(v_id, true);
    end loop;
  end if;
  return cleaner_onboarding_private.staff_cleaner_assessment_host(p_host, p_open, p_application, p_attended, p_reason);
end;
$fn$;
create function public.staff_mark_cleaner_writing(p_attempt uuid, p_passed boolean, p_reason text)
returns void language plpgsql security definer set search_path = '' as $fn$
declare v_application uuid;
begin
  select i.application_id into v_application from cleaner_assessment_private.invitations i
    join cleaner_assessment_private.attempts a on a.invitation_id = i.id where a.id = p_attempt;
  perform cleaner_onboarding_private.assert_staff(v_application, true);
  perform cleaner_onboarding_private.staff_mark_cleaner_writing(p_attempt, p_passed, p_reason);
end;
$fn$;

revoke all on all functions in schema cleaner_onboarding_private
  from public, anon, authenticated, service_role;
revoke all on function public.intake_cleaner_application(jsonb,text,text,text,inet,text),
  public.staff_cleaner_applications(), public.staff_open_cleaner_application(uuid,boolean),
  public.staff_record_cleaner_application(uuid,text,text,jsonb,text),
  public.staff_cleaner_assessment_overview(uuid), public.staff_adjust_cleaner_assessment(uuid,integer),
  public.staff_cleaner_assessment_host(uuid,boolean,uuid,boolean,text),
  public.staff_mark_cleaner_writing(uuid,boolean,text)
  from public, anon, authenticated, service_role;
grant execute on function public.intake_cleaner_application(jsonb,text,text,text,inet,text) to service_role;
grant execute on function public.staff_cleaner_applications(),
  public.staff_open_cleaner_application(uuid,boolean),
  public.staff_record_cleaner_application(uuid,text,text,jsonb,text),
  public.staff_cleaner_assessment_overview(uuid), public.staff_adjust_cleaner_assessment(uuid,integer),
  public.staff_cleaner_assessment_host(uuid,boolean,uuid,boolean,text),
  public.staff_mark_cleaner_writing(uuid,boolean,text) to authenticated;

notify pgrst, 'reload schema';
commit;
