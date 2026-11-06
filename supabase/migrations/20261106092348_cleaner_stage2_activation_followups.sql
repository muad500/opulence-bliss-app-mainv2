begin;

alter table public.provider_profile_settings add column emergency_contact_relationship text
  check(char_length(emergency_contact_relationship)<=120);
create function cleaner_onboarding_private.clear_emergency_relationship()
returns trigger language plpgsql set search_path = '' as $fn$
begin
  if new.emergency_contact_name is null and new.emergency_contact_phone is null then
    new.emergency_contact_relationship:=null;
  end if;
  return new;
end;
$fn$;
create trigger clear_emergency_relationship before update on public.provider_profile_settings
  for each row execute function cleaner_onboarding_private.clear_emergency_relationship();

create table cleaner_onboarding_private.setup_records (
  application_id uuid primary key references public.cleaner_applications(id) on delete cascade,
  accepted_at timestamptz not null,
  payout_account text not null,
  payout_checked_at timestamptz not null default clock_timestamp(),
  payout_ready boolean not null default true,
  setup_completed_at timestamptz not null default clock_timestamp()
);
create table cleaner_onboarding_private.runtime (
  singleton boolean primary key default true check(singleton),
  last_recovery_at timestamptz,
  last_followups_at timestamptz,
  new_applications_from timestamptz
);
insert into cleaner_onboarding_private.runtime default values;
create function public.cleaner_legacy_registration_allowed(p_provider uuid)
returns boolean language sql stable security definer set search_path = '' as $fn$
  select exists(select 1 from public.providers p cross join cleaner_onboarding_private.runtime r
    where p.id=p_provider and (r.new_applications_from is null or p.created_at<r.new_applications_from)
      and not exists(select 1 from public.cleaner_applications a where a.provider_id=p.id));
$fn$;
create function public.enable_cleaner_stage2_cutover()
returns void language plpgsql security definer set search_path = '' as $fn$
begin
  if not exists(select 1 from cleaner_onboarding_private.runtime where
    last_recovery_at>clock_timestamp()-interval '5 minutes' and
    last_followups_at>clock_timestamp()-interval '5 minutes') then
    raise exception 'Verify the permanent recovery and follow-up worker first.';
  end if;
  update cleaner_onboarding_private.runtime set new_applications_from=coalesce(new_applications_from,clock_timestamp());
end;
$fn$;
revoke all on function public.cleaner_legacy_registration_allowed(uuid),public.enable_cleaner_stage2_cutover()
  from public,anon,authenticated,service_role;
grant execute on function public.cleaner_legacy_registration_allowed(uuid),public.enable_cleaner_stage2_cutover()
  to service_role;
alter table cleaner_onboarding_private.setup_records enable row level security;
alter table cleaner_onboarding_private.runtime enable row level security;
revoke all on cleaner_onboarding_private.setup_records,cleaner_onboarding_private.runtime
  from public,anon,authenticated,service_role;

create function public.own_cleaner_stage2_setup()
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare app public.cleaner_applications;
begin
  select * into app from public.cleaner_applications where account_user_id=auth.uid();
  if not found then raise exception 'Passed applicant account required.'; end if;
  return jsonb_build_object('applicationId',app.id,'providerId',app.provider_id,'status',app.status,
    'setupComplete',exists(select 1 from cleaner_onboarding_private.setup_records where application_id=app.id));
end;
$fn$;

create function public.complete_cleaner_stage2_setup(p_user uuid,p_payout text)
returns void language plpgsql security definer set search_path = '' as $fn$
declare app public.cleaner_applications; passed_at timestamptz; acceptance timestamptz;
begin
  select * into app from public.cleaner_applications where account_user_id=p_user for update;
  if not found or app.status not in ('assessment_passed','accepted_setup') then
    raise exception 'Assessment pass and own pending account required.';
  end if;
  if exists(select 1 from cleaner_onboarding_private.case_locks where application_id=app.id and resolved_at is null) then
    raise exception 'Resolve the Manager review first.';
  end if;
  select max(a.decided_at) into passed_at from cleaner_assessment_private.attempts a
    join cleaner_assessment_private.invitations i on i.id=a.invitation_id
    where i.application_id=app.id and a.phase='passed' and a.score>=12;
  if passed_at is null then raise exception 'Server-marked assessment pass required.'; end if;
  if exists(select 1 from (values('cleaner-terms'),('cleaner-cancellation'),('privacy'),('safeguarding'),('dbs-data')) required(slug)
    where not exists(select 1 from public.account_legal_acceptances a
      join public.legal_documents d on d.slug=a.document_slug and d.version=a.version and d.published
      where a.user_id=p_user and a.document_slug=required.slug and a.accepted_at>=passed_at
        and a.acceptance_evidence is not null)) then
    raise exception 'Accept every current required policy after assessment.';
  end if;
  select max(accepted_at) into acceptance from public.account_legal_acceptances where user_id=p_user;
  if not exists(select 1 from public.provider_profile_settings s where s.provider_id=app.provider_id
    and nullif(btrim(s.emergency_contact_name),'') is not null
    and nullif(btrim(s.emergency_contact_relationship),'') is not null
    and s.emergency_contact_phone ~ '^\+44[0-9]{10}$') then
    raise exception 'Complete the private emergency contact.';
  end if;
  if p_payout is null or not exists(select 1 from public.providers
    where id=app.provider_id and stripe_account_id=p_payout) then
    raise exception 'Own verified Stripe payout account required.';
  end if;
  insert into cleaner_onboarding_private.setup_records(application_id,accepted_at,payout_account)
    values(app.id,acceptance,p_payout) on conflict(application_id) do update
    set accepted_at=excluded.accepted_at,payout_account=excluded.payout_account,payout_checked_at=clock_timestamp();
  update public.cleaner_applications set status='accepted_setup' where id=app.id;
  update public.professional_setup_invitations set setup_completed_at=clock_timestamp()
    where provider_id=app.provider_id and setup_completed_at is null;
  insert into public.cleaner_application_communications(application_id,template_key,status,wording_version,context)
    select app.id,'stage2Welcome','queued','1.0',jsonb_build_object(
      'accepted_at',to_char(acceptance at time zone 'Europe/London','DD Month YYYY HH24:MI'), 'acceptedAt',acceptance,
      'accepted_documents',string_agg(d.title||' (v'||a.version||')',', ' order by a.document_slug),
      'documents',jsonb_agg(a.acceptance_evidence->'document' order by a.document_slug))
    from (select distinct on(document_slug) * from public.account_legal_acceptances
      where user_id=p_user and accepted_at>=passed_at order by document_slug,accepted_at desc,id desc) a
    join public.legal_documents d on d.slug=a.document_slug and d.version=a.version
    where a.user_id=p_user and a.accepted_at>=passed_at
      and a.document_slug in ('cleaner-terms','cleaner-cancellation','privacy','safeguarding','dbs-data')
    on conflict do nothing;
end;
$fn$;

create function cleaner_onboarding_private.guard_activation()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare app public.cleaner_applications; group_id text;
begin
  if new.service_approvals->>'cleaning'='approved' and old.service_approvals->>'cleaning' is distinct from 'approved' then
    select * into app from public.cleaner_applications where provider_id=new.id;
    if not found then
      if not public.cleaner_legacy_registration_allowed(new.id) then
        raise exception 'New cleaners must complete the application and assessment flow.';
      end if;
      return new; -- Preserve existing professional flows.
    end if;
    if app.status<>'accepted_setup' or app.declaration_pending or exists(
      select 1 from cleaner_onboarding_private.case_locks where application_id=app.id and resolved_at is null) then
      raise exception 'Stage 2 acceptances, setup and resolved checks are required.';
    end if;
    foreach group_id in array array['deskScreening','interviewCriteria','liveIdentityCheck','dbsReview',
      'experienceCheck','insuranceCheck','inductionAssessment','acceptancesSetup','independentActivation'] loop
      if not cleaner_onboarding_private.checklist_complete(app.id,group_id) then
        raise exception 'Complete the approved % checklist before activation.',group_id;
      end if;
    end loop;
    if not exists(select 1 from cleaner_onboarding_private.setup_records
      where application_id=app.id and payout_account=new.stripe_account_id and payout_ready
        and payout_checked_at>clock_timestamp()-interval '15 minutes')
      or not exists(select 1 from cleaner_assessment_private.attempts a
        join cleaner_assessment_private.invitations i on i.id=a.invitation_id
        where i.application_id=app.id and i.attendance_confirmed and a.phase='passed' and a.score>=12) then
      raise exception 'Recorded attendance, assessment and payout setup required.';
    end if;
  end if;
  return new;
end;
$fn$;
create trigger cleaner_stage2_activation before update of service_approvals on public.providers
  for each row execute function cleaner_onboarding_private.guard_activation();
create function cleaner_onboarding_private.sync_status()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  update public.cleaner_applications set status=case
    when new.is_suspended then 'suspended'
    when new.vetting_status::text='approved' and new.service_approvals->>'cleaning'='approved' then 'active'
    else status end where provider_id=new.id and status not in ('closed','not_progressed');
  return new;
end;
$fn$;
create trigger sync_cleaner_application_status after update of service_approvals,vetting_status,is_suspended on public.providers
  for each row execute function cleaner_onboarding_private.sync_status();

create function cleaner_onboarding_private.guard_new_work()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if exists(select 1 from public.cleaner_applications a
      left join cleaner_onboarding_private.setup_records s on s.application_id=a.id
      where a.provider_id=new.provider_id and (a.status<>'active' or not coalesce(s.payout_ready,false)
        or s.payout_checked_at<clock_timestamp()-interval '15 minutes')) then
    if tg_table_name='bookings' then raise exception 'Only an Active cleaner can receive a new assignment.'; end if;
    return null;
  end if;
  return new;
end;
$fn$;
create function public.cleaner_stage2_payout_rechecks()
returns jsonb language sql security definer set search_path = '' as $fn$
  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (
    select a.id,a.provider_id,p.profile_id from public.cleaner_applications a
      join public.providers p on p.id=a.provider_id join cleaner_onboarding_private.setup_records s on s.application_id=a.id
      where a.status in ('accepted_setup','active') and s.payout_checked_at<clock_timestamp()-interval '5 minutes'
      order by s.payout_checked_at limit 20) r;
$fn$;
create function public.record_cleaner_stage2_payout_check(p_application uuid,p_ready boolean)
returns void language plpgsql security definer set search_path = '' as $fn$
begin
  update cleaner_onboarding_private.setup_records set payout_ready=p_ready,payout_checked_at=clock_timestamp()
    where application_id=p_application and p_ready is not null;
end;
$fn$;
revoke all on function public.cleaner_stage2_payout_rechecks(),public.record_cleaner_stage2_payout_check(uuid,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.cleaner_stage2_payout_rechecks(),public.record_cleaner_stage2_payout_check(uuid,boolean) to service_role;
create trigger cleaner_stage2_offer before insert on public.booking_offers
  for each row execute function cleaner_onboarding_private.guard_new_work();
create trigger cleaner_stage2_offer_queue before insert on public.booking_offer_queue
  for each row execute function cleaner_onboarding_private.guard_new_work();
create trigger cleaner_stage2_assignment before update of provider_id,scheduled_at on public.bookings
  for each row when(new.provider_id is not null and (new.provider_id is distinct from old.provider_id
    or new.scheduled_at is distinct from old.scheduled_at))
  execute function cleaner_onboarding_private.guard_new_work();
create trigger cleaner_stage2_assignment_insert before insert on public.bookings
  for each row when(new.provider_id is not null) execute function cleaner_onboarding_private.guard_new_work();

create function public.process_cleaner_stage2_followups()
returns integer language plpgsql security definer set search_path = '' as $fn$
declare item record; completed record; total integer:=0; changed integer; reason text; due date; days integer;
begin
  for item in select a.*,p.profile_id,p.stripe_account_id,p.is_suspended
    from public.cleaner_applications a join public.providers p on p.id=a.provider_id
    where a.status not in ('closed','not_progressed') loop
    if item.status='active' then
      reason:=public.professional_verification_block(item.provider_id);
      if reason is null and exists(select 1 from cleaner_onboarding_private.setup_records s
        where s.application_id=item.id and not s.payout_ready) then
        reason:='Verified payout setup needs attention.';
      end if;
      if reason is not null then
        update public.providers set is_suspended=true,suspended_at=clock_timestamp(),
          suspension_reason=reason where id=item.provider_id and not is_suspended;
        insert into public.notifications(user_id,title,body,href)
          select s.profile_id,'Professional verification needs attention',
            'New offers are paused. Review accepted visits and arrange reassignment if required.',
            '/admin/cleaner-applications' from public.staff_role_memberships s where s.active and s.staff_role in ('manager','onboarding');
      end if;
    end if;
    select least(expires_at,next_check_at) into due from public.provider_verification_items
      where provider_id=item.provider_id and document_type='right_to_work' and status='verified';
    days:=due-current_date;
    if days<=30 and days>=0 then
      insert into public.cleaner_application_communications(application_id,template_key,event_key,status,wording_version,context)
        values(item.id,'rightToWorkReminder',due::text||case when days<=7 then ':7' else ':30' end,'queued','1.0',
          jsonb_build_object('expiry_date',due,'days_until_expiry',case when days<=7 then '7' else '30' end)) on conflict do nothing;
      get diagnostics changed=row_count;total:=total+changed;
    end if;
    select (issue_date+interval '3 years')::date into due from public.provider_dbs_checks
      where provider_id=item.provider_id and status='verified';
    if due<=current_date then
      insert into public.cleaner_application_communications(application_id,template_key,event_key,status,wording_version,context)
        values(item.id,'dbsRenewalReminder',due::text,'queued','1.0',jsonb_build_object('review_due_date',due)) on conflict do nothing;
      get diagnostics changed=row_count;total:=total+changed;
    end if;
    for completed in select id,completed_at,row_number() over(order by completed_at,id) as ordinal
      from public.bookings where provider_id=item.provider_id and status::text='completed' and completed_at is not null loop
      if completed.ordinal in (1,5) then
        insert into public.cleaner_application_communications(application_id,template_key,event_key,status,wording_version,context)
          values(item.id,case when completed.ordinal=1 then 'firstJobFollowUpReminder' else 'fifthJobReviewReminder' end,
            completed.id::text,'queued','1.0',jsonb_build_object('booking_reference',completed.id,
              'completed_at',completed.completed_at,'follow_up_due_at',completed.completed_at+interval '24 hours')) on conflict do nothing;
        get diagnostics changed=row_count;total:=total+changed;
        if changed>0 then
          insert into public.notifications(user_id,title,body,href)
            select s.profile_id,case when completed.ordinal=1 then 'First booking follow-up due' else 'Fifth booking review due' end,
              'Open the protected applicant record and complete the approved checklist.','/admin/cleaner-applications'
              from public.staff_role_memberships s where s.active and s.staff_role in ('manager','onboarding');
        end if;
      end if;
    end loop;
  end loop;
  update cleaner_onboarding_private.runtime set last_followups_at=clock_timestamp();
  return total;
end;
$fn$;

revoke all on all functions in schema cleaner_onboarding_private from public,anon,authenticated,service_role;
revoke all on function public.own_cleaner_stage2_setup(),public.complete_cleaner_stage2_setup(uuid,text),
  public.process_cleaner_stage2_followups() from public,anon,authenticated,service_role;
grant execute on function public.own_cleaner_stage2_setup() to authenticated;
grant execute on function public.complete_cleaner_stage2_setup(uuid,text),public.process_cleaner_stage2_followups() to service_role;

alter function public.sweep_cleaner_assessments() set schema cleaner_onboarding_private;
create function public.sweep_cleaner_assessments()
returns integer language plpgsql security definer set search_path = '' as $fn$
declare total integer;
begin
  total:=cleaner_onboarding_private.sweep_cleaner_assessments();
  update cleaner_onboarding_private.runtime set last_recovery_at=clock_timestamp();
  return total;
end;
$fn$;
revoke all on function public.sweep_cleaner_assessments(),cleaner_onboarding_private.sweep_cleaner_assessments()
  from public,anon,authenticated,service_role;
grant execute on function public.sweep_cleaner_assessments() to service_role;

create function cleaner_onboarding_private.protected_application(p_application uuid)
returns boolean language sql stable security definer set search_path = '' as $fn$
  select coalesce((select a.legal_hold
    or exists(select 1 from cleaner_onboarding_private.case_locks l where l.application_id=a.id and l.resolved_at is null)
    or exists(select 1 from public.account_incidents c where c.status::text not in ('resolved','closed') and (
      c.subject_provider_id=a.provider_id or c.reporter_id=a.account_user_id
      or lower(c.complainant_email)=lower(a.email)))
    from public.cleaner_applications a where a.id=p_application),true);
$fn$;
create or replace function public.purge_expired_cleaner_applications()
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare attempts integer:=0; applications integer:=0;
begin
  with expired as (
    select a.id from cleaner_assessment_private.attempts a
    join cleaner_assessment_private.invitations i on i.id=a.invitation_id
    join public.cleaner_applications c on c.id=i.application_id
    where not cleaner_onboarding_private.protected_application(c.id)
      and a.decided_at+interval '6 months'<=clock_timestamp() and a.phase in ('passed','failed')
    order by a.id limit 100 for update of c,a skip locked
  ), removed as (delete from cleaner_assessment_private.attempts where id in(select id from expired) returning id)
  select count(*) into attempts from removed;
  with expired as (
    select c.id from public.cleaner_applications c where c.status in ('closed','not_progressed')
      and c.retention_due_at<=clock_timestamp() and not cleaner_onboarding_private.protected_application(c.id)
    order by c.id limit 100 for update skip locked
  ), removed as (delete from public.cleaner_applications where id in(select id from expired) returning id)
  select count(*) into applications from removed;
  return jsonb_build_object('assessments',attempts,'applications',applications);
end;
$fn$;
revoke all on function cleaner_onboarding_private.protected_application(uuid) from public,anon,authenticated,service_role;
notify pgrst, 'reload schema';
commit;
