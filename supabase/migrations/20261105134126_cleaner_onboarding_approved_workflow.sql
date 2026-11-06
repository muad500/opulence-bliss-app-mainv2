begin;

create table cleaner_onboarding_private.wording_versions (
  version text primary key,
  effective_date date not null,
  approval_received_on date not null,
  approved_by text not null check (approved_by = 'Opulence Bliss'),
  catalog jsonb not null,
  installed_at timestamptz not null default clock_timestamp()
);
create table cleaner_onboarding_private.checklist_ticks (
  id bigint generated always as identity primary key,
  application_id uuid not null references public.cleaner_applications(id) on delete cascade,
  version text not null references cleaner_onboarding_private.wording_versions(version),
  group_id text not null,
  item_id text not null,
  checked boolean not null,
  actor uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),
  note text not null check (char_length(note) between 10 and 2000)
);
create index cleaner_checklist_latest on cleaner_onboarding_private.checklist_ticks
  (application_id, version, group_id, item_id, id desc);
create table cleaner_onboarding_private.secure_decisions (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.cleaner_applications(id) on delete cascade,
  decision text not null check (char_length(decision) between 10 and 4000),
  reasons text not null check (char_length(reasons) between 10 and 6000),
  explanation_considered text not null check (char_length(explanation_considered) between 10 and 4000),
  suitable boolean not null,
  manager_id uuid not null,
  published_at timestamptz,
  token_hash text unique check (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz,
  revoked_at timestamptz,
  review_requested_at timestamptz,
  review_statement text check (char_length(review_statement) <= 4000)
);
alter table cleaner_onboarding_private.wording_versions enable row level security;
alter table cleaner_onboarding_private.checklist_ticks enable row level security;
alter table cleaner_onboarding_private.secure_decisions enable row level security;
revoke all on cleaner_onboarding_private.wording_versions,
  cleaner_onboarding_private.checklist_ticks, cleaner_onboarding_private.secure_decisions
  from public, anon, authenticated, service_role;
revoke all on all sequences in schema cleaner_onboarding_private
  from public, anon, authenticated, service_role;

alter table public.cleaner_application_communications
  add column wording_version text,
  add column context jsonb not null default '{}'::jsonb,
  add column delivery_payload jsonb,
  add column first_attempt_at timestamptz,
  add column claim_token uuid,
  add column claimed_until timestamptz;
alter table public.cleaner_application_communications add column event_key text not null default 'initial';
do $migration$
declare item record;
begin
  for item in select conname from pg_constraint where conrelid='public.cleaner_application_communications'::regclass
    and contype='u' and pg_get_constraintdef(oid)='UNIQUE (application_id, template_key)' loop
    execute format('alter table public.cleaner_application_communications drop constraint %I',item.conname);
  end loop;
end;
$migration$;
alter table public.cleaner_application_communications add unique(application_id,template_key,event_key);
alter table public.cleaner_applications
  add column account_user_id uuid references auth.users(id),
  add column provider_id uuid references public.providers(id);
create unique index cleaner_application_account on public.cleaner_applications(account_user_id)
  where account_user_id is not null;

create function public.install_cleaner_onboarding_wording(p_catalog jsonb)
returns void language plpgsql security definer set search_path = '' as $fn$
declare prior jsonb; items jsonb;
begin
  if p_catalog->>'status' is distinct from 'approved'
    or p_catalog->>'version' is distinct from '1.0'
    or p_catalog#>>'{approval,approvedBy}' is distinct from 'Opulence Bliss'
    or p_catalog#>>'{approval,reviewedVersion}' is distinct from 'draft-1'
    or p_catalog#>>'{approval,effectiveDate}' is distinct from '2026-10-01'
    or coalesce(p_catalog#>>'{approval,recordedOn}', '') !~ '^\d{4}-\d{2}-\d{2}$'
    or jsonb_array_length(p_catalog->'emails') <> 10
    or jsonb_array_length(p_catalog->'declarations') <> 1
    or jsonb_array_length(p_catalog->'checklists') <> 12 then
    raise exception 'Complete approved wording and provenance required.';
  end if;
  items := (p_catalog->'emails') || (p_catalog->'declarations') || (p_catalog->'checklists');
  if exists (select 1 from jsonb_array_elements(items) i
    where i->'approval' is distinct from p_catalog->'approval') then
    raise exception 'Every item needs the same approval provenance.';
  end if;
  select catalog into prior from cleaner_onboarding_private.wording_versions where version = '1.0';
  if found and prior is distinct from p_catalog then
    raise exception 'An installed wording version cannot be rewritten.';
  end if;
  insert into cleaner_onboarding_private.wording_versions
    (version, effective_date, approval_received_on, approved_by, catalog)
    values ('1.0', '2026-10-01', (p_catalog#>>'{approval,recordedOn}')::date,
      'Opulence Bliss', p_catalog) on conflict do nothing;
  update cleaner_onboarding_private.source_readiness
    set supplied_version = '1.0', ready = true
    where source_key in ('deskScreening','interviewCriteria','liveIdentityCheck');
end;
$fn$;

-- Existing pending applications are not backdated or treated as having seen
-- D01. Only a new submission of the exact approved declaration records v1.0.
alter function public.submit_cleaner_application(jsonb,text,text,text)
  rename to submit_cleaner_application_before_approved_wording;
create function public.submit_cleaner_application(p_details jsonb,p_declaration text,
  p_declaration_source text,p_privacy_version text)
returns uuid language plpgsql security definer set search_path = '' as $fn$
declare expected text; v_id uuid;
begin
  select catalog#>>'{declarations,0,wording}' into expected
    from cleaner_onboarding_private.wording_versions where version = '1.0';
  if expected is null or p_declaration is distinct from expected
    or p_declaration_source is distinct from 'Onboarding Process 3.1A'
    or p_privacy_version is distinct from '1.0' then
    raise exception 'Approved acknowledgement is unavailable or changed.';
  end if;
  v_id := public.submit_cleaner_application_before_approved_wording(
    p_details, p_declaration, p_declaration_source, p_privacy_version);
  update public.cleaner_applications set declaration_version = '1.0', declaration_pending = false
    where id = v_id;
  update public.cleaner_application_communications set status = 'queued', wording_version = '1.0'
    where application_id = v_id and template_key = 'applicationReceived';
  return v_id;
end;
$fn$;

create function public.staff_tick_cleaner_checklist(p_application uuid,p_group text,
  p_item text,p_checked boolean,p_note text)
returns void language plpgsql security definer set search_path = '' as $fn$
declare g jsonb; s text;
begin
  perform cleaner_onboarding_private.assert_staff(p_application, true);
  select status into s from public.cleaner_applications where id=p_application;
  if s in ('closed','not_progressed') or p_checked is null
    or char_length(btrim(coalesce(p_note,''))) not between 10 and 2000 then
    raise exception 'Open application, check state and factual note required.';
  end if;
  select item into g from cleaner_onboarding_private.wording_versions v,
    lateral jsonb_array_elements(v.catalog->'checklists') item
    where v.version='1.0' and item->>'id'=p_group;
  if g is null or not exists(select 1 from jsonb_array_elements(g->'items') i where i->>'id'=p_item) then
    raise exception 'Approved checklist item not found.';
  end if;
  if p_group in ('liveIdentityCheck','dbsReview') and
    (not public.staff_has_permission('private_evidence') or not public.can_view_dbs()) then
    raise exception 'Named evidence access required.' using errcode='insufficient_privilege';
  end if;
  if p_group='managerEscalation' and not public.staff_has_permission('manage') then
    raise exception 'Manager decision required.' using errcode='insufficient_privilege';
  end if;
  if p_group='independentActivation' and not public.staff_has_permission('second_signoff') then
    raise exception 'Independent second-reviewer role required.' using errcode='insufficient_privilege';
  end if;
  if g->>'stage' is not null and exists(select 1 from cleaner_onboarding_private.stages
    where application_id=p_application and stage=g->>'stage' and completed_at is not null) then
    raise exception 'A completed stage checklist cannot be rewritten.';
  end if;
  insert into cleaner_onboarding_private.checklist_ticks
    (application_id,version,group_id,item_id,checked,actor,note)
    values(p_application,'1.0',p_group,p_item,p_checked,auth.uid(),btrim(p_note));
end;
$fn$;

create function cleaner_onboarding_private.checklist_complete(p_application uuid,p_group text)
returns boolean language sql stable security definer set search_path = '' as $fn$
  select exists (select 1 from cleaner_onboarding_private.wording_versions where version='1.0')
    and not exists (
      select 1 from cleaner_onboarding_private.wording_versions v,
      lateral jsonb_array_elements(v.catalog->'checklists') g,
      lateral jsonb_array_elements(g->'items') i
      where v.version='1.0' and g->>'id'=p_group
        and not coalesce((select t.checked from cleaner_onboarding_private.checklist_ticks t
          where t.application_id=p_application and t.version=v.version
            and t.group_id=p_group and t.item_id=i->>'id' order by t.id desc limit 1),false)
    );
$fn$;

alter function public.staff_record_cleaner_application(uuid,text,text,jsonb,text)
  set schema cleaner_onboarding_private;
create function public.staff_record_cleaner_application(p_application uuid,p_action text,
  p_stage text,p_details jsonb,p_note text)
returns void language plpgsql security definer set search_path = '' as $fn$
declare g text; private_note boolean;
begin
  perform cleaner_onboarding_private.assert_staff(p_application, true);
  if p_action='complete' then
    g := case p_stage when 'screened' then 'deskScreening'
      when 'interviewed' then 'interviewCriteria'
      when 'id_rtw_verified' then 'liveIdentityCheck'
      when 'dbs_recorded' then 'dbsReview'
      when 'experience_checked' then 'experienceCheck' end;
    if g is null or not cleaner_onboarding_private.checklist_complete(p_application,g) then
      raise exception 'Complete every approved checklist item for this stage first.';
    end if;
    if p_stage='screened' and exists(select 1 from public.cleaner_applications
      where id=p_application and declaration_pending) then
      raise exception 'The applicant must give the approved acknowledgement; do not backdate it.';
    end if;
    if p_stage='dbs_recorded' and exists(select 1 from cleaner_onboarding_private.stages
      where application_id=p_application and stage='dbs_recorded' and details->>'outcome'='unspent_conviction')
      and not exists(select 1 from cleaner_onboarding_private.secure_decisions d
        join public.cleaner_application_communications c on c.application_id=d.application_id
          and c.template_key='dbsDecisionNotice' and c.context->>'decisionId'=d.id::text and c.status='sent'
        where d.application_id=p_application and d.suitable and d.published_at is not null and d.revoked_at is null) then
      raise exception 'Complete the considered Manager decision and secure written notification first.';
    end if;
  end if;
  private_note:=p_action in ('escalate','resolve','reject') and exists(
    select 1 from cleaner_onboarding_private.stages where application_id=p_application
      and stage='dbs_recorded' and details->>'outcome'='unspent_conviction');
  perform cleaner_onboarding_private.staff_record_cleaner_application(
    p_application,p_action,p_stage,p_details,
    case when private_note then 'Private review action recorded; see the restricted decision record.' else p_note end);
  if private_note then
    insert into cleaner_onboarding_private.events(application_id,actor,action,stage,note)
      values(p_application,auth.uid(),p_action||'_private_note','dbs_recorded',p_note);
  end if;
  if p_action='reject' then
    if exists(select 1 from cleaner_onboarding_private.stages
      where application_id=p_application and stage='dbs_recorded' and details->>'outcome'='unspent_conviction') then
      if not exists(select 1 from cleaner_onboarding_private.secure_decisions
        where application_id=p_application and published_at is not null and revoked_at is null) then
        raise exception 'Publish the considered secure written decision before a DBS-related rejection.';
      end if;
      update public.cleaner_application_communications set status='failed'
        where application_id=p_application and template_key='applicationRejected';
      return;
    end if;
    -- Ordinary rejection never includes the private staff note or DBS data.
    update public.cleaner_application_communications set status='queued',wording_version='1.0',
      context=jsonb_build_object('non_sensitive_reason_summary',
        'We are not progressing your application following the application review.')
      where application_id=p_application and template_key='applicationRejected';
  end if;
  if p_action='escalate' then
    insert into public.cleaner_application_communications(application_id,template_key,status,wording_version)
      values(p_application,'managerEscalationEmail','queued','1.0') on conflict do nothing;
  end if;
end;
$fn$;

alter function public.staff_open_cleaner_application(uuid,boolean)
  set schema cleaner_onboarding_private;
create function public.staff_open_cleaner_application(p_application uuid,p_private boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare result jsonb;
begin
  begin
    result := cleaner_onboarding_private.staff_open_cleaner_application(p_application,p_private);
  exception when insufficient_privilege then
    if auth.uid() is not null and exists(select 1 from public.cleaner_applications where id=p_application)
      and not exists(select 1 from cleaner_onboarding_private.events where application_id=p_application
        and actor=auth.uid() and action='record_access_denied' and created_at>clock_timestamp()-interval '1 minute') then
      insert into cleaner_onboarding_private.events(application_id,actor,action,stage,note)
        values(p_application,auth.uid(),'record_access_denied',case when p_private then 'dbs_recorded' else null end,
          'Staff access refused; no private data disclosed');
    end if;
    return jsonb_build_object('accessDenied',true);
  end;
  return result || jsonb_build_object('checklist',coalesce((select jsonb_agg(to_jsonb(t)) from (
    select distinct on(group_id,item_id) group_id,item_id,version,checked,actor,recorded_at,note
    from cleaner_onboarding_private.checklist_ticks where application_id=p_application
      and (p_private or group_id not in ('liveIdentityCheck','dbsReview','managerEscalation'))
    order by group_id,item_id,id desc
  ) t),'[]'::jsonb), 'secureDecisions',case when p_private then
    coalesce((select jsonb_agg(jsonb_build_object('id',id,'decision',decision,'reasons',reasons,
      'explanationConsidered',explanation_considered,'managerId',manager_id,'publishedAt',published_at,
      'expiresAt',expires_at,'reviewRequestedAt',review_requested_at,'reviewStatement',review_statement))
      from cleaner_onboarding_private.secure_decisions where application_id=p_application),'[]'::jsonb)
    else '[]'::jsonb end);
end;
$fn$;

-- E04 is not queued by any generic rejection or by merely recording DBS data.
-- Only an authorised Manager can publish a considered written decision. The
-- personal short-lived link contains no offence details and is revocable.
create function public.staff_publish_cleaner_decision(p_application uuid,p_decision text,
  p_reasons text,p_explanation text,p_token_hash text,p_expires timestamptz,p_suitable boolean)
returns uuid language plpgsql security definer set search_path = '' as $fn$
declare v_id uuid;
begin
  perform cleaner_onboarding_private.assert_staff(p_application,true);
  if not public.staff_has_permission('manage') or not public.can_view_dbs() then
    raise exception 'Named Manager authenticator sign-in required.' using errcode='insufficient_privilege';
  end if;
  if p_suitable is null or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$'
    or p_expires is null or p_expires<=clock_timestamp()
    or p_expires>clock_timestamp()+interval '7 days' then
    raise exception 'Personal expiring access required.';
  end if;
  update cleaner_onboarding_private.secure_decisions set revoked_at=clock_timestamp()
    where application_id=p_application and revoked_at is null;
  insert into cleaner_onboarding_private.secure_decisions(application_id,decision,reasons,
    explanation_considered,suitable,manager_id,published_at,token_hash,expires_at)
    values(p_application,btrim(p_decision),btrim(p_reasons),btrim(p_explanation),p_suitable,auth.uid(),
      clock_timestamp(),p_token_hash,p_expires) returning id into v_id;
  insert into public.cleaner_application_communications(application_id,template_key,status,wording_version,context)
    values(p_application,'dbsDecisionNotice','queued','1.0',
      jsonb_build_object('decisionId',v_id,'expiresAt',to_char(p_expires at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
    on conflict(application_id,template_key,event_key) do update set status='queued',
      context=excluded.context,delivery_payload=null,first_attempt_at=null,claim_token=null,
      claimed_until=null,sent_at=null;
  insert into cleaner_onboarding_private.events(application_id,actor,action,stage,note)
    values(p_application,auth.uid(),'secure_decision_published','dbs_recorded',
      'Considered written decision published through restricted personal access');
  return v_id;
end;
$fn$;

create function public.claim_cleaner_onboarding_emails(p_allowed text[])
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare result jsonb;
begin
  if cardinality(p_allowed) is distinct from 1 or p_allowed[1] !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Exactly one approved staging test inbox is required.';
  end if;
  update public.cleaner_application_communications set status='failed'
    where status='queued' and first_attempt_at<clock_timestamp()-interval '23 hours';
  with wanted as (
    select c.id, a.full_name,a.email,a.id as application_id,c.context,c.template_key,c.wording_version
    from public.cleaner_application_communications c
    join public.cleaner_applications a on a.id=c.application_id
    join cleaner_onboarding_private.wording_versions w on w.version=c.wording_version
    where c.status='queued' and (c.claimed_until is null or c.claimed_until<clock_timestamp())
      and (lower(a.email)=p_allowed[1] or (a.full_name like 'TEST %' and a.email like '%@example.invalid'))
      and exists(select 1 from jsonb_array_elements(w.catalog->'emails') e where e->>'id'=c.template_key)
      and (c.template_key<>'applicationReceived' or (not a.declaration_pending and a.declaration_version=c.wording_version))
      and (c.template_key<>'applicationRejected' or a.status='not_progressed')
      and (c.template_key<>'dbsDecisionNotice' or exists(select 1 from cleaner_onboarding_private.secure_decisions d
        where d.id::text=c.context->>'decisionId' and d.application_id=a.id
          and d.revoked_at is null and d.published_at is not null and d.expires_at>clock_timestamp()))
      and (c.template_key<>'inductionInvitation' or a.status='invited')
    order by c.created_at,c.id limit 4 for update of c skip locked
  ), claimed as (
    update public.cleaner_application_communications c set claim_token=gen_random_uuid(),
      claimed_until=clock_timestamp()+interval '10 minutes',
      first_attempt_at=coalesce(c.first_attempt_at,clock_timestamp())
    from wanted w where c.id=w.id returning c.id,c.claim_token,c.delivery_payload,c.first_attempt_at,
      w.full_name,w.application_id,w.context,w.template_key,w.wording_version,p_allowed[1] as email
  ) select coalesce(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) into result from claimed;
  return result;
end;
$fn$;

create function public.prepare_cleaner_onboarding_email(p_id uuid,p_claim uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare result jsonb;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' or length(p_payload::text)>2000000
    or nullif(p_payload->>'subject','') is null or nullif(p_payload->>'text','') is null then
    raise exception 'Bounded email payload required.';
  end if;
  update public.cleaner_application_communications set delivery_payload=coalesce(delivery_payload,p_payload)
    where id=p_id and claim_token=p_claim and status='queued' and claimed_until>clock_timestamp()
    returning delivery_payload into result;
  if result is null then raise exception 'Email lease expired.'; end if;
  return result;
end;
$fn$;
create function public.finish_cleaner_onboarding_email(p_id uuid,p_claim uuid,p_sent boolean)
returns boolean language plpgsql security definer set search_path = '' as $fn$
begin
  update public.cleaner_application_communications set
    status=case when p_sent then 'sent' else 'queued' end,
    sent_at=case when p_sent then clock_timestamp() else null end,claim_token=null,
    claimed_until=case when p_sent then null else clock_timestamp()+interval '5 minutes' end
    where id=p_id and claim_token=p_claim and status='queued' and claimed_until>clock_timestamp();
  return found;
end;
$fn$;

create function public.open_cleaner_secure_decision(p_hash text,p_review text default null)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare d cleaner_onboarding_private.secure_decisions;
begin
  select * into d from cleaner_onboarding_private.secure_decisions
    where token_hash=p_hash and published_at is not null and revoked_at is null
      and expires_at>clock_timestamp() for update;
  if not found then raise exception 'This personal decision link is unavailable.';
  end if;
  if p_review is not null then
    if char_length(btrim(p_review)) not between 10 and 4000 then
      raise exception 'Enter your explanation in 10 to 4,000 characters.';
    end if;
    if d.review_requested_at is null then
      update cleaner_onboarding_private.secure_decisions set review_requested_at=clock_timestamp(),
        review_statement=btrim(p_review) where id=d.id;
      insert into cleaner_onboarding_private.case_locks(application_id,opened_by)
        values(d.application_id,d.manager_id) on conflict(application_id) do update
        set opened_at=clock_timestamp(),resolved_at=null,resolved_by=null;
      insert into public.cleaner_application_communications(application_id,template_key,event_key,status,wording_version)
        values(d.application_id,'managerEscalationEmail',d.id::text||':review','queued','1.0') on conflict do nothing;
    end if;
  end if;
  insert into cleaner_onboarding_private.events(application_id,actor,action,stage,note)
    values(d.application_id,d.application_id,case when p_review is null then 'applicant_decision_opened'
      else 'applicant_review_requested' end,'dbs_recorded','Personal decision access; no body copied to audit');
  return jsonb_build_object('decision',d.decision,'reasons',d.reasons,'publishedAt',d.published_at,
    'reference',d.application_id,'reviewRequested',d.review_requested_at is not null or p_review is not null);
end;
$fn$;

revoke all on all functions in schema cleaner_onboarding_private from public,anon,authenticated,service_role;
revoke all on function public.install_cleaner_onboarding_wording(jsonb),
  public.submit_cleaner_application_before_approved_wording(jsonb,text,text,text),
  public.submit_cleaner_application(jsonb,text,text,text),
  public.staff_tick_cleaner_checklist(uuid,text,text,boolean,text),
  public.staff_record_cleaner_application(uuid,text,text,jsonb,text),
  public.staff_open_cleaner_application(uuid,boolean),
  public.staff_publish_cleaner_decision(uuid,text,text,text,text,timestamptz,boolean),
  public.open_cleaner_secure_decision(text,text) from public,anon,authenticated,service_role;
revoke all on function public.claim_cleaner_onboarding_emails(text[]),
  public.prepare_cleaner_onboarding_email(uuid,uuid,jsonb),
  public.finish_cleaner_onboarding_email(uuid,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.install_cleaner_onboarding_wording(jsonb),
  public.submit_cleaner_application(jsonb,text,text,text),
  public.open_cleaner_secure_decision(text,text) to service_role;
grant execute on function public.claim_cleaner_onboarding_emails(text[]),
  public.prepare_cleaner_onboarding_email(uuid,uuid,jsonb),
  public.finish_cleaner_onboarding_email(uuid,uuid,boolean) to service_role;
grant execute on function public.staff_tick_cleaner_checklist(uuid,text,text,boolean,text),
  public.staff_record_cleaner_application(uuid,text,text,jsonb,text),
  public.staff_open_cleaner_application(uuid,boolean),
  public.staff_publish_cleaner_decision(uuid,text,text,text,text,timestamptz,boolean) to authenticated;

notify pgrst, 'reload schema';
commit;
