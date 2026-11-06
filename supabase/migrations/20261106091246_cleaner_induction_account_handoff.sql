begin;

-- Certificate inspection does not require retaining a certificate copy.
alter table public.provider_dbs_checks alter column certificate_original_name drop not null,
  alter column certificate_mime_type drop not null;

alter table cleaner_assessment_private.invitations
  add column issued_by uuid,
  add column session_starts_at timestamptz,
  add column meeting_url text;

create function public.staff_issue_cleaner_induction(p_application uuid,p_starts timestamptz,
  p_meeting text,p_token_hash text,p_expires timestamptz,p_host uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $fn$
declare app public.cleaner_applications; host_id uuid; rtw jsonb; dbs jsonb;
begin
  perform cleaner_onboarding_private.assert_staff(p_application,true);
  select * into strict app from public.cleaner_applications where id=p_application;
  if app.status<>'experience_checked' or app.declaration_pending then
    raise exception 'Complete the application stages before issuing a limited login.';
  end if;
  if p_starts is null or p_starts<=clock_timestamp() or p_starts>clock_timestamp()+interval '30 days'
    or p_expires is null or p_expires<>p_starts+interval '6 hours'
    or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$'
    or coalesce(p_meeting,'') !~ '^https://meet\.google\.com/[a-z]{3}-[a-z]{4}-[a-z]{3}$' then
    raise exception 'Choose the arranged live session and its personal time-limited access.';
  end if;
  if exists(select 1 from (values('deskScreening'),('interviewCriteria'),('liveIdentityCheck'),('dbsReview'),('experienceCheck')) g(id)
    where not cleaner_onboarding_private.checklist_complete(p_application,g.id)) then
    raise exception 'Complete all pre-induction checklists.';
  end if;
  select details into rtw from cleaner_onboarding_private.stages
    where application_id=p_application and stage='id_rtw_verified' and completed_at is not null;
  select details into dbs from cleaner_onboarding_private.stages
    where application_id=p_application and stage='dbs_recorded' and completed_at is not null;
  if rtw is null or dbs is null or rtw->>'self_employment_permitted' is distinct from 'true'
    or not(coalesce((rtw->>'no_expiry')::boolean,false)
      or coalesce((rtw->>'expires_on')::date>=p_starts::date,false))
    or (dbs->>'issue_date')::date+interval '3 years'<=p_starts then
    raise exception 'Checks must remain valid for induction.';
  end if;
  host_id:=p_host;
  if host_id is null then
    insert into cleaner_assessment_private.host_sessions default values returning id into host_id;
  elsif not exists(select 1 from cleaner_assessment_private.host_sessions where id=host_id and not opened) then
    raise exception 'Choose a closed host session.';
  end if;
  insert into cleaner_assessment_private.invitations(application_id,host_session_id,token_hash,expires_at,
    issued_by,session_starts_at,meeting_url)
    values(p_application,host_id,p_token_hash,p_expires,auth.uid(),p_starts,p_meeting);
  update public.cleaner_applications set status='invited' where id=p_application;
  insert into public.cleaner_application_communications(application_id,template_key,status,wording_version,context)
    values(p_application,'inductionInvitation','queued','1.0',jsonb_build_object(
      'session_date',to_char(p_starts at time zone 'Europe/London','FMDay FMDD FMMonth YYYY'),
      'session_time',to_char(p_starts at time zone 'Europe/London','HH24:MI'),
      'time_zone','Europe/London','meeting_url',p_meeting,
      'invitation_expires_at',to_char(p_expires at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
  insert into cleaner_onboarding_private.events(application_id,actor,action,note)
    values(p_application,auth.uid(),'induction_invited','Personal limited access issued after completed pre-induction checks');
  return host_id;
end;
$fn$;

-- A limited capability can identify its own passed application, but it never
-- becomes a staff/worker/Auth credential or discloses anyone else's record.
create function public.cleaner_passed_setup_context(p_session_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare app public.cleaner_applications;
begin
  select c.* into app from public.cleaner_applications c
    join cleaner_assessment_private.invitations i on i.application_id=c.id
    where i.session_hash=p_session_hash and i.expires_at>clock_timestamp()
      and c.status in ('assessment_passed','accepted_setup')
      and exists(select 1 from cleaner_assessment_private.attempts a
        where a.invitation_id=i.id and a.phase='passed') for update of c;
  if not found or exists(select 1 from cleaner_onboarding_private.case_locks
    where application_id=app.id and resolved_at is null) then
    raise exception 'A passed assessment with no unresolved review is required.';
  end if;
  return jsonb_build_object('applicationId',app.id,'email',app.email,'fullName',app.full_name,
    'phone',app.phone,'postcode',app.postcode,'userId',app.account_user_id,'providerId',app.provider_id);
end;
$fn$;

create function public.link_cleaner_passed_account(p_session_hash text,p_user uuid)
returns uuid language plpgsql security definer set search_path = '' as $fn$
declare context jsonb; app public.cleaner_applications; provider uuid; dbs cleaner_onboarding_private.stages;
begin
  context:=public.cleaner_passed_setup_context(p_session_hash);
  select * into strict app from public.cleaner_applications where id=(context->>'applicationId')::uuid for update;
  if not exists(select 1 from auth.users u where u.id=p_user and lower(u.email)=lower(app.email))
    or exists(select 1 from public.profiles where id=p_user and role::text='admin') then
    raise exception 'The passed applicant must match their own non-staff account.';
  end if;
  if app.account_user_id is not null then
    if app.account_user_id<>p_user then raise exception 'The application already belongs to another identity.'; end if;
    return app.provider_id;
  end if;
  if exists(select 1 from public.providers where profile_id=p_user) then
    raise exception 'An existing professional identity must be reviewed rather than duplicated.';
  end if;
  -- Preserve any existing customer/Partner identity and its stored name.
  insert into public.profiles(id,email,full_name,phone,role)
    values(p_user,app.email,app.full_name,app.phone,'customer') on conflict(id) do nothing;
  update public.profiles set phone=app.phone where id=p_user and nullif(btrim(phone),'') is null;
  insert into public.providers(profile_id,display_name,services,vetting_status,show_on_our_pros)
    values(p_user,app.full_name,array['cleaning'],'pending',false) returning id into provider;
  update public.cleaner_applications set account_user_id=p_user,provider_id=provider where id=app.id;
  select * into strict dbs from cleaner_onboarding_private.stages where application_id=app.id
    and stage='dbs_recorded' and completed_at is not null and completed_by is not null;
  insert into public.provider_dbs_checks(provider_id,certificate_number,issue_date,status,reviewed_at,reviewed_by,review_note)
    values(provider,dbs.details->>'certificate_number',(dbs.details->>'issue_date')::date,'verified',dbs.completed_at,dbs.completed_by,
      'Completed pre-induction basic DBS review; no certificate image retained');
  insert into public.professional_setup_invitations(provider_id,user_id,created_by)
    select provider,p_user,i.issued_by from cleaner_assessment_private.invitations i where i.application_id=app.id;
  insert into cleaner_onboarding_private.events(application_id,actor,action,note)
    values(app.id,p_user,'passed_account_linked','Same-person account prepared after assessment pass; no service approval');
  return provider;
end;
$fn$;

-- No automatic switch to Active. Reuse the existing independent sign-off and
-- additionally exclude everybody who participated in this application's work.
alter function public.professional_reviewed_documents(uuid,uuid)
  rename to professional_reviewed_documents_before_stage2;
create function public.professional_reviewed_documents(p_provider uuid,p_staff uuid)
returns boolean language sql stable security definer set search_path = '' as $fn$
  select public.professional_reviewed_documents_before_stage2(p_provider,p_staff)
    or exists(select 1 from public.cleaner_applications app
      where app.provider_id=p_provider and (
        exists(select 1 from cleaner_onboarding_private.stages s where s.application_id=app.id
          and (s.recorded_by=p_staff or s.completed_by=p_staff))
        or exists(select 1 from cleaner_assessment_private.invitations i where i.application_id=app.id and i.issued_by=p_staff)
        or exists(select 1 from cleaner_onboarding_private.checklist_ticks t where t.application_id=app.id
          and t.actor=p_staff and t.group_id<>'independentActivation')
        or exists(select 1 from cleaner_assessment_private.audit audit where audit.application_id=app.id and audit.actor=p_staff)
      ));
$fn$;

alter function public.professional_approval_fingerprint(uuid) rename to professional_approval_fingerprint_before_stage2;
create function public.professional_approval_fingerprint(p_provider uuid)
returns text language sql stable security definer set search_path = '' as $fn$
  select md5(jsonb_build_object('existing',public.professional_approval_fingerprint_before_stage2(p_provider),
    'onboarding',(select jsonb_build_object('application',a.id,'declaration',a.declaration_version,
      'stages',(select jsonb_agg(to_jsonb(s) order by stage) from cleaner_onboarding_private.stages s where s.application_id=a.id),
      'checklist',(select jsonb_agg(to_jsonb(t) order by id) from cleaner_onboarding_private.checklist_ticks t
        where t.application_id=a.id and t.group_id<>'independentActivation'))
      from public.cleaner_applications a where a.provider_id=p_provider))::text);
$fn$;

revoke all on function public.staff_issue_cleaner_induction(uuid,timestamptz,text,text,timestamptz,uuid),
  public.cleaner_passed_setup_context(text), public.link_cleaner_passed_account(text,uuid),
  public.professional_reviewed_documents(uuid,uuid),
  public.professional_approval_fingerprint(uuid),public.professional_approval_fingerprint_before_stage2(uuid),
  public.professional_reviewed_documents_before_stage2(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.staff_issue_cleaner_induction(uuid,timestamptz,text,text,timestamptz,uuid) to authenticated;
grant execute on function public.cleaner_passed_setup_context(text),public.link_cleaner_passed_account(text,uuid) to service_role;
notify pgrst, 'reload schema';
commit;
