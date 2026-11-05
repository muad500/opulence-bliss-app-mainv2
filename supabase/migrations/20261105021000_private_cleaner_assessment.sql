begin;

-- Never expose the bank, correct options, answers or writing through PostgREST.
-- This migration contains NO client question bank or answer key. Import the
-- approved pack separately through a server-only process, after review.
create schema cleaner_assessment_private;
revoke all on schema cleaner_assessment_private from public, anon, authenticated, service_role;

create table cleaner_assessment_private.questions (
  id smallint primary key check(id between 1 and 25),
  prompt text not null,
  options text[] not null check(cardinality(options)=3),
  correct_option smallint not null check(correct_option between 1 and 3)
);
create table cleaner_assessment_private.writing_prompts (
  id smallint primary key check(id between 1 and 5), prompt text not null
);
create table cleaner_assessment_private.settings (
  singleton boolean primary key default true check(singleton),
  confirm_automatic_fail boolean not null default false
);
insert into cleaner_assessment_private.settings default values;

create table cleaner_assessment_private.host_sessions (
  id uuid primary key default gen_random_uuid(),
  opened boolean not null default false,
  created_at timestamptz not null default now()
);
create table cleaner_assessment_private.invitations (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references public.cleaner_applications(id) on delete cascade,
  host_session_id uuid not null references cleaner_assessment_private.host_sessions(id),
  token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  attendance_confirmed boolean not null default false,
  adjustment smallint not null default 1 check(adjustment in (1,2,3)),
  session_hash text check(session_hash ~ '^[a-f0-9]{64}$'),
  reopens_used smallint not null default 0 check(reopens_used between 0 and 1)
);
create table cleaner_assessment_private.attempts (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null references cleaner_assessment_private.invitations(id) on delete cascade,
  attempt_number smallint not null check(attempt_number in (1,2)),
  phase text not null default 'questions' check(phase in (
    'questions','writing','writing_review','manager_review','failed','passed')),
  position smallint not null default 1 check(position between 1 and 15),
  started_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp(),
  score smallint check(score between 0 and 15),
  failure_reason text,
  decided_at timestamptz,
  writing_prompt_id smallint references cleaner_assessment_private.writing_prompts(id),
  writing_started_at timestamptz,
  writing_text text not null default '' check(char_length(writing_text)<=6000),
  unique(invitation_id,attempt_number)
);
create table cleaner_assessment_private.attempt_questions (
  attempt_id uuid not null references cleaner_assessment_private.attempts(id) on delete cascade,
  position smallint not null check(position between 1 and 15),
  question_id smallint not null references cleaner_assessment_private.questions(id),
  -- Freeze the pack as shown/marked for this attempt, including if a later
  -- approved bank is imported while an induction session is in progress.
  prompt text not null,
  options text[] not null check(cardinality(options)=3),
  correct_option smallint not null check(correct_option between 1 and 3),
  option_order smallint[] not null check(cardinality(option_order)=3),
  option_tokens uuid[] not null check(cardinality(option_tokens)=3),
  opened_at timestamptz,
  answered_at timestamptz,
  selected_option smallint,
  correct boolean,
  primary key(attempt_id,position), unique(attempt_id,question_id)
);
create table cleaner_assessment_private.audit (
  id bigint generated always as identity primary key,
  application_id uuid references public.cleaner_applications(id) on delete cascade,
  attempt_id uuid,
  actor uuid,
  event text not null,
  reason text,
  created_at timestamptz not null default clock_timestamp()
);
-- Do not grant direct bank, score, answer or settings writes, including to the
-- service API role. All browser-facing access must use bounded server RPCs.
revoke all on all tables in schema cleaner_assessment_private from public, anon, authenticated, service_role;
revoke all on all sequences in schema cleaner_assessment_private from public, anon, authenticated, service_role;

create function cleaner_assessment_private.snapshot(p_attempt uuid)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare
  a cleaner_assessment_private.attempts;
  i cleaner_assessment_private.invitations;
  q cleaner_assessment_private.attempt_questions;
  choices jsonb;
begin
  select * into strict a from cleaner_assessment_private.attempts where id=p_attempt;
  select * into strict i from cleaner_assessment_private.invitations where id=a.invitation_id;
  if a.phase='questions' then
    select * into strict q from cleaner_assessment_private.attempt_questions
      where attempt_id=a.id and position=a.position;
    select jsonb_agg(jsonb_build_object('id',q.option_tokens[n],'text',q.options[q.option_order[n]]) order by n)
      into choices from generate_series(1,3) n;
    return jsonb_build_object('attemptId',a.id,'phase',a.phase,'position',a.position,
      'questionCount',15,'prompt',q.prompt,'choices',choices,
      'deadline',q.opened_at+make_interval(secs=>10*i.adjustment),'serverTime',clock_timestamp());
  end if;
  return jsonb_build_object('attemptId',a.id,'phase',a.phase,'serverTime',clock_timestamp()) ||
    case when a.phase='writing' then jsonb_build_object('prompt',(
      select prompt from cleaner_assessment_private.writing_prompts where id=a.writing_prompt_id),
      'deadline',a.writing_started_at+make_interval(secs=>300*i.adjustment),'writing',a.writing_text)
    else '{}'::jsonb end;
end;
$fn$;

create function cleaner_assessment_private.fail(p_attempt uuid,p_reason text)
returns void language plpgsql security definer set search_path='' as $fn$
declare v_app uuid; v_review boolean;
begin
  select confirm_automatic_fail into strict v_review from cleaner_assessment_private.settings;
  update cleaner_assessment_private.attempts set
    phase=case when v_review then 'manager_review' else 'failed' end,
    failure_reason=p_reason,decided_at=case when v_review then null else clock_timestamp() end
    where id=p_attempt and phase in ('questions','writing');
  if not found then return; end if;
  select application_id into strict v_app from cleaner_assessment_private.invitations i
    join cleaner_assessment_private.attempts a on a.invitation_id=i.id where a.id=p_attempt;
  insert into cleaner_assessment_private.audit(application_id,attempt_id,event,reason)
    values(v_app,p_attempt,case when v_review then 'automatic_fail_awaits_staff' else 'assessment_failed' end,p_reason);
  if not v_review then
    update public.cleaner_applications set status='not_progressed',decision_at=clock_timestamp(),
      retention_due_at=clock_timestamp()+interval '6 months' where id=v_app;
  end if;
end;
$fn$;

-- Only the dedicated server endpoint receives invitation/session capabilities.
-- These hashes are SHA-256 digests of independent, random 256-bit secrets; the
-- raw invitation is never an account password or a general Supabase session.
create function public.cleaner_assessment_start(p_invitation_hash text,p_session_hash text,p_rules_accepted boolean)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare
  i cleaner_assessment_private.invitations;
  a cleaner_assessment_private.attempts;
  v_ids smallint[]; v_id smallint; v_pos smallint:=0;
  v_order smallint[]; v_now timestamptz:=clock_timestamp();
begin
  if p_rules_accepted is distinct from true or p_session_hash is null or p_session_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Accept the assessment rules before starting.' using errcode='check_violation';
  end if;
  select * into i from cleaner_assessment_private.invitations where token_hash=p_invitation_hash for update;
  v_now:=clock_timestamp();
  if not found or i.expires_at<=v_now or not i.attendance_confirmed or not exists(
    select 1 from cleaner_assessment_private.host_sessions where id=i.host_session_id and opened) then
    raise exception 'The host must open the assessment and confirm attendance.' using errcode='insufficient_privilege';
  end if;
  select * into a from cleaner_assessment_private.attempts where invitation_id=i.id order by attempt_number desc limit 1 for update;
  if a.id is not null and a.phase not in ('questions','writing') then
    if a.phase='failed' and a.attempt_number=1 and i.reopens_used=1 then
      a:=null; -- A Manager's audited single reopening allows one fresh attempt.
    else
      if a.phase<>'failed' then
        update cleaner_assessment_private.invitations set session_hash=p_session_hash where id=i.id;
        insert into cleaner_assessment_private.audit(application_id,attempt_id,event)
          values(i.application_id,a.id,'limited_login_replaced');
      end if;
      return cleaner_assessment_private.snapshot(a.id);
    end if;
  end if;
  if a.id is null then
    if (select count(*) from cleaner_assessment_private.questions)<>25 or
      (select count(*) from cleaner_assessment_private.writing_prompts)<>5 then
      raise exception 'The approved assessment pack is not ready.';
    end if;
    if not exists(select 1 from public.cleaner_applications where id=i.application_id and status='invited') then
      raise exception 'An induction invitation is required.' using errcode='insufficient_privilege';
    end if;
    insert into cleaner_assessment_private.attempts(invitation_id,attempt_number) values(i.id,1+i.reopens_used) returning * into a;
    select array_agg(id order by gen_random_uuid()) into v_ids from (
      select id from cleaner_assessment_private.questions where id in (3,6,7,8,10)
      union all (select id from cleaner_assessment_private.questions where id not in (3,6,7,8,10)
        order by gen_random_uuid() limit 10)) chosen;
    foreach v_id in array v_ids loop
      v_pos:=v_pos+1;
      select array_agg(n::smallint order by gen_random_uuid()) into v_order from generate_series(1,3) n;
      insert into cleaner_assessment_private.attempt_questions(attempt_id,position,question_id,prompt,options,correct_option,option_order,option_tokens,opened_at)
        select a.id,v_pos,v_id,b.prompt,b.options,b.correct_option,v_order,
          array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid()],case when v_pos=1 then v_now end
        from cleaner_assessment_private.questions b where id=v_id;
    end loop;
    insert into cleaner_assessment_private.audit(application_id,attempt_id,event)
      values(i.application_id,a.id,'rules_accepted');
  elsif a.last_seen_at+interval '5 seconds'<v_now then
    perform cleaner_assessment_private.fail(a.id,'connection lost');
    return cleaner_assessment_private.snapshot(a.id);
  end if;
  update cleaner_assessment_private.invitations set session_hash=p_session_hash where id=i.id;
  update cleaner_assessment_private.attempts set last_seen_at=v_now where id=a.id;
  insert into cleaner_assessment_private.audit(application_id,attempt_id,event)
    values(i.application_id,a.id,case when i.session_hash is null then 'limited_login' else 'limited_login_replaced' end);
  return cleaner_assessment_private.snapshot(a.id);
end;
$fn$;

create function public.cleaner_assessment_command(p_session_hash text,p_attempt uuid,p_action text,
  p_position integer default null,p_choice uuid default null,p_writing text default null)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare
  a cleaner_assessment_private.attempts;
  i cleaner_assessment_private.invitations;
  q cleaner_assessment_private.attempt_questions;
  v_now timestamptz:=clock_timestamp(); v_selected smallint; v_correct boolean; v_score integer;
  v_invitation uuid;
begin
  -- Always lock invitation before attempt, matching start/review lock order.
  select invitation_id into v_invitation from cleaner_assessment_private.attempts where id=p_attempt;
  select * into i from cleaner_assessment_private.invitations where id=v_invitation for update;
  if not found or p_session_hash is null or i.session_hash is distinct from p_session_hash then
    raise exception 'This assessment session is no longer valid.' using errcode='insufficient_privilege';
  end if;
  select * into strict a from cleaner_assessment_private.attempts where id=p_attempt for update;
  v_now:=clock_timestamp();
  if p_action not in ('heartbeat','answer','page_left','writing_save','writing_submit') or p_action is null then
    raise exception 'Unknown assessment action.' using errcode='check_violation';
  end if;
  if i.expires_at<=v_now and a.phase not in ('questions','writing') then
    raise exception 'This invitation has expired.' using errcode='insufficient_privilege';
  end if;
  if a.phase not in ('questions','writing') then return cleaner_assessment_private.snapshot(a.id); end if;
  if i.expires_at<=v_now or a.last_seen_at+interval '5 seconds'<v_now or not exists(
    select 1 from cleaner_assessment_private.host_sessions where id=i.host_session_id and opened) then
    perform cleaner_assessment_private.fail(a.id,'connection lost');
    return cleaner_assessment_private.snapshot(a.id);
  end if;
  if p_action='page_left' then
    perform cleaner_assessment_private.fail(a.id,'page left');
    return cleaner_assessment_private.snapshot(a.id);
  end if;
  update cleaner_assessment_private.attempts set last_seen_at=v_now where id=a.id;
  if a.phase='questions' then
    select * into strict q from cleaner_assessment_private.attempt_questions where attempt_id=a.id and position=a.position for update;
    if p_action='answer' and p_position is distinct from a.position then
      raise exception 'Only the current question can be answered.' using errcode='check_violation';
    end if;
    if p_action in ('writing_save','writing_submit') then raise exception 'Complete Part A first.'; end if;
    if p_action='answer' or v_now>=q.opened_at+make_interval(secs=>10*i.adjustment) then
      if v_now<q.opened_at+make_interval(secs=>10*i.adjustment) then
        v_selected:=q.option_order[array_position(q.option_tokens,p_choice)];
        if v_selected is null then raise exception 'Choose one of the current options.'; end if;
      end if;
      v_correct:=coalesce(v_selected=q.correct_option,false);
      update cleaner_assessment_private.attempt_questions set answered_at=v_now,selected_option=v_selected,correct=v_correct
        where attempt_id=a.id and position=a.position;
      if a.position<15 then
        update cleaner_assessment_private.attempts set position=position+1 where id=a.id;
        update cleaner_assessment_private.attempt_questions set opened_at=v_now where attempt_id=a.id and position=a.position+1;
      else
        select count(*) filter(where correct) into v_score from cleaner_assessment_private.attempt_questions where attempt_id=a.id;
        update cleaner_assessment_private.attempts set score=v_score where id=a.id;
        if v_score<12 then perform cleaner_assessment_private.fail(a.id,'wrong answers');
        else
          update cleaner_assessment_private.attempts set phase='writing',writing_started_at=v_now,
            writing_prompt_id=(select id from cleaner_assessment_private.writing_prompts order by gen_random_uuid() limit 1) where id=a.id;
        end if;
      end if;
    end if;
  else
    if p_action='answer' then raise exception 'Part A is complete.'; end if;
    -- Expired writing submits only the last server-saved text, never a late
    -- replacement supplied by the device after the deadline.
    if v_now>=a.writing_started_at+make_interval(secs=>300*i.adjustment) then
      update cleaner_assessment_private.attempts set phase='writing_review' where id=a.id;
    elsif p_action in ('writing_save','writing_submit') then
      if p_writing is null or char_length(p_writing)>6000 then raise exception 'Writing is limited to 6000 characters.'; end if;
      update cleaner_assessment_private.attempts set writing_text=p_writing,
        phase=case when p_action='writing_submit' then 'writing_review' else 'writing' end where id=a.id;
    end if;
  end if;
  return cleaner_assessment_private.snapshot(a.id);
end;
$fn$;

create function public.staff_set_cleaner_automatic_fail_review(p_enabled boolean,p_reason text)
returns void language plpgsql security definer set search_path='' as $fn$
begin
  if not public.staff_has_permission('manage') then raise exception 'Manager authenticator sign-in required.' using errcode='insufficient_privilege'; end if;
  if p_enabled is null or coalesce(btrim(p_reason),'')='' then raise exception 'Record a reason for this setting.'; end if;
  update cleaner_assessment_private.settings set confirm_automatic_fail=p_enabled;
  -- No applicant or answer details in setting audit.
  insert into cleaner_assessment_private.audit(actor,event,reason)
    values(auth.uid(),'automatic_fail_review:'||p_enabled::text,left(btrim(p_reason),1000));
end;
$fn$;

create function public.staff_cleaner_assessment_settings()
returns jsonb language plpgsql security definer set search_path='' as $fn$
begin
  if not public.can_review_professional() then raise exception 'Staff authenticator sign-in required.' using errcode='insufficient_privilege'; end if;
  return (select jsonb_build_object('confirmAutomaticFail',confirm_automatic_fail) from cleaner_assessment_private.settings);
end;
$fn$;

create function public.staff_cleaner_assessment_host(p_host uuid,p_open boolean,p_application uuid,
  p_attended boolean,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $fn$
declare v_id uuid;
begin
  if not public.staff_has_permission('first_review') then raise exception 'Onboarding staff authenticator sign-in required.' using errcode='insufficient_privilege'; end if;
  if p_open is null or length(btrim(coalesce(p_reason,'')))<10 then raise exception 'Record a reason for this host action.'; end if;
  if p_host is null then
    insert into cleaner_assessment_private.host_sessions(opened) values(p_open) returning id into v_id;
  else
    update cleaner_assessment_private.host_sessions set opened=p_open where id=p_host returning id into v_id;
    if not found then raise exception 'Host session not found.'; end if;
  end if;
  if p_application is not null then
    if p_attended is null then raise exception 'Record attendance explicitly.'; end if;
    update cleaner_assessment_private.invitations set attendance_confirmed=p_attended
      where application_id=p_application and host_session_id=v_id;
    if not found then raise exception 'This applicant is not invited to this session.'; end if;
  end if;
  insert into cleaner_assessment_private.audit(application_id,actor,event,reason)
    values(p_application,auth.uid(),case when p_application is not null then 'host_attendance:'||p_attended::text
      else 'host_open:'||p_open::text end,left(btrim(p_reason),1000));
  return v_id;
end;
$fn$;

create function public.staff_mark_cleaner_writing(p_attempt uuid,p_passed boolean,p_reason text)
returns void language plpgsql security definer set search_path='' as $fn$
declare a cleaner_assessment_private.attempts; i cleaner_assessment_private.invitations; v_invitation uuid;
begin
  if not public.staff_has_permission('first_review') then raise exception 'Onboarding staff authenticator sign-in required.' using errcode='insufficient_privilege'; end if;
  if p_passed is null or length(btrim(coalesce(p_reason,'')))<10 then raise exception 'Record the writing assessment reason.'; end if;
  select invitation_id into v_invitation from cleaner_assessment_private.attempts where id=p_attempt;
  select * into strict i from cleaner_assessment_private.invitations where id=v_invitation for update;
  select * into strict a from cleaner_assessment_private.attempts where id=p_attempt for update;
  if a.phase<>'writing_review' then raise exception 'Writing is not awaiting a mark.'; end if;
  update cleaner_assessment_private.attempts set phase=case when p_passed then 'passed' else 'manager_review' end,
    failure_reason=case when p_passed then null else 'writing not passed' end,
    decided_at=case when p_passed then clock_timestamp() end where id=a.id;
  if p_passed then
    update public.cleaner_applications set status='assessment_passed',decision_at=clock_timestamp(),
      retention_due_at=clock_timestamp()+interval '6 months' where id=i.application_id;
  end if;
  insert into cleaner_assessment_private.audit(application_id,attempt_id,actor,event,reason)
    values(i.application_id,a.id,auth.uid(),case when p_passed then 'writing_passed' else 'writing_fail_awaits_manager' end,left(btrim(p_reason),1000));
  -- This cannot activate a professional or bypass document acceptance/sign-off.
end;
$fn$;

create function public.staff_review_cleaner_assessment(p_attempt uuid,p_action text,p_reason text)
returns void language plpgsql security definer set search_path='' as $fn$
declare a cleaner_assessment_private.attempts; i cleaner_assessment_private.invitations; v_invitation uuid;
begin
  if not public.staff_has_permission('manage') then raise exception 'Manager authenticator sign-in required.' using errcode='insufficient_privilege'; end if;
  if p_action not in ('confirm_fail','reopen') or p_action is null or length(btrim(coalesce(p_reason,'')))<10 then
    raise exception 'Choose a review action and record a reason.'; end if;
  select invitation_id into v_invitation from cleaner_assessment_private.attempts where id=p_attempt;
  select * into strict i from cleaner_assessment_private.invitations where id=v_invitation for update;
  select * into strict a from cleaner_assessment_private.attempts where id=p_attempt for update;
  if a.phase not in ('failed','manager_review') or exists(select 1 from cleaner_assessment_private.attempts
    where invitation_id=i.id and attempt_number>a.attempt_number) then raise exception 'Only the latest failed assessment can be reviewed.'; end if;
  if p_action='reopen' then
    if i.reopens_used<>0 then raise exception 'An assessment may only be reopened once.'; end if;
    update cleaner_assessment_private.invitations set reopens_used=1,session_hash=null,
      expires_at=greatest(expires_at,clock_timestamp()+interval '1 day') where id=i.id;
    update cleaner_assessment_private.attempts set phase='failed' where id=a.id;
    update public.cleaner_applications set status='invited',decision_at=null,retention_due_at=null where id=i.application_id;
  else
    if a.phase<>'manager_review' then raise exception 'The failure is already final.'; end if;
    update cleaner_assessment_private.attempts set phase='failed',decided_at=clock_timestamp() where id=a.id;
    update public.cleaner_applications set status='not_progressed',decision_at=clock_timestamp(),
      retention_due_at=clock_timestamp()+interval '6 months' where id=i.application_id;
  end if;
  insert into cleaner_assessment_private.audit(application_id,attempt_id,actor,event,reason)
    values(i.application_id,a.id,auth.uid(),'manager:'||p_action,left(btrim(p_reason),1000));
end;
$fn$;

revoke all on all functions in schema cleaner_assessment_private from public,anon,authenticated,service_role;
revoke all on function public.cleaner_assessment_start(text,text,boolean),
  public.cleaner_assessment_command(text,uuid,text,integer,uuid,text),
  public.staff_set_cleaner_automatic_fail_review(boolean,text), public.staff_cleaner_assessment_settings(),
  public.staff_cleaner_assessment_host(uuid,boolean,uuid,boolean,text),
  public.staff_mark_cleaner_writing(uuid,boolean,text),public.staff_review_cleaner_assessment(uuid,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.cleaner_assessment_start(text,text,boolean),
  public.cleaner_assessment_command(text,uuid,text,integer,uuid,text) to service_role;
grant execute on function public.staff_set_cleaner_automatic_fail_review(boolean,text),
  public.staff_cleaner_assessment_settings(),public.staff_cleaner_assessment_host(uuid,boolean,uuid,boolean,text),
  public.staff_mark_cleaner_writing(uuid,boolean,text),public.staff_review_cleaner_assessment(uuid,text,text) to authenticated;
notify pgrst, 'reload schema';
commit;
