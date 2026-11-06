-- Staging only. Test fixtures are rolled back inside a subtransaction. The
-- approved bank stays private; the only output is aggregate counts/pass-fail.
do $smoke$
declare
  v_before integer;
  v_providers integer;
  v_users integer;
  v_target integer;
  v_application uuid;
  v_host uuid;
  v_invitation uuid;
  v_attempt uuid;
  v_token text;
  v_device text;
  v_choice uuid;
  v_snapshot jsonb;
  v_result jsonb;
  v_position integer;
  v_score integer;
  v_cases integer := 0;
begin
  if not exists(select 1 from vault.secrets where name = 'opulence_staging_recovery_secret')
    or exists(select 1 from vault.secrets where name = 'opulence_production_visit_payments_secret') then
    raise exception 'Staging database required.';
  end if;
  if has_table_privilege('anon', 'cleaner_assessment_private.questions', 'select')
    or has_table_privilege('authenticated', 'cleaner_assessment_private.questions', 'select')
    or has_table_privilege('service_role', 'cleaner_assessment_private.questions', 'select') then
    raise exception 'Private bank grants are incorrect.';
  end if;
  select count(*) into v_before from public.cleaner_applications;
  select count(*) into v_providers from public.providers;
  select count(*) into v_users from auth.users;
  begin
    foreach v_target in array array[12, 11] loop
      insert into public.cleaner_applications(full_name,email,phone,postcode,areas,
        experience,availability,right_to_work_type,checks_acknowledged,
        declaration_text,declaration_source,privacy_version,status)
      values('TEST Fictional Assessment Only', 'test-quiz-' || gen_random_uuid()::text || '@example.invalid',
        '+442079460001','SW1A1AA',array['TEST area'],'TEST fictional experience','TEST availability',
        'TEST evidence, not a real check',true,'TEST pending wording','TEST fixture','TEST-1','invited')
      returning id into v_application;
      insert into cleaner_assessment_private.host_sessions(opened) values(true) returning id into v_host;
      v_token := encode(sha256(convert_to(gen_random_uuid()::text,'UTF8')),'hex');
      v_device := encode(sha256(convert_to(gen_random_uuid()::text,'UTF8')),'hex');
      insert into cleaner_assessment_private.invitations(application_id,host_session_id,
        token_hash,session_hash,expires_at,attendance_confirmed)
      values(v_application,v_host,v_token,null,clock_timestamp()+interval '1 hour',true)
      returning id into v_invitation;
      v_snapshot := public.cleaner_assessment_start(v_token,v_device,true);
      v_attempt := (v_snapshot->>'attemptId')::uuid;
      if (select count(distinct question_id) from cleaner_assessment_private.attempt_questions
        where attempt_id=v_attempt) <> 15 or
        (select count(*) from cleaner_assessment_private.attempt_questions
          where attempt_id=v_attempt and question_id=any(array[3,6,7,8,10])) <> 5 then
        raise exception 'Question selection check failed.';
      end if;
      for v_position in 1..15 loop
        if v_snapshot ? 'correct_option' or v_snapshot ? 'questions' or
          v_snapshot::text like '%(correct)%' or jsonb_array_length(v_snapshot->'choices') is distinct from 3 then
          raise exception 'Private marking data reached a device payload.';
        end if;
        select option_tokens[array_position(option_order,
          case when v_position <= v_target then correct_option
            else (correct_option % 3 + 1)::smallint end)] into v_choice
        from cleaner_assessment_private.attempt_questions
        where attempt_id=v_attempt and position=v_position;
        v_snapshot := public.cleaner_assessment_command(v_device,v_attempt,'answer',v_position,v_choice);
      end loop;
      select score into v_score from cleaner_assessment_private.attempts where id=v_attempt;
      if v_score is distinct from v_target or v_snapshot->>'phase' is distinct from
        (case when v_target=12 then 'writing' else 'failed' end) then
        raise exception 'Server marking threshold check failed.';
      end if;
      if exists(select 1 from public.cleaner_applications where id=v_application and status='active') then
        raise exception 'Assessment must not activate a professional.';
      end if;
      v_cases := v_cases + 1;
    end loop;
    v_result := jsonb_build_object('pass',true,'cases',v_cases,'answersChecked',30,
      'uniqueQuestionsPerAttempt',15,'coreQuestionsPerAttempt',5,
      'twelveOpensWriting',true,'elevenFails',true,'bankOrKeyInDevicePayload',false);
    -- Roll back fixture applications, sessions, answers, audits and outbox rows.
    raise exception using errcode='ZX001', message='ROLLBACK_FICTIONAL_FIXTURES';
  exception when sqlstate 'ZX001' then
    null;
  end;
  if (select count(*) from public.cleaner_applications) <> v_before or
    (select count(*) from public.providers) <> v_providers or
    (select count(*) from auth.users) <> v_users then
    raise exception 'Fixture isolation check failed.';
  end if;
  v_result := v_result || jsonb_build_object('fixtureRecordsLeft',0,'accountsCreated',0,
    'professionalsApproved',0,'emailsSent',0,'paymentsCreated',0);
  perform set_config('opulence.stage2_pack_smoke',v_result::text,false);
end;
$smoke$;
select current_setting('opulence.stage2_pack_smoke')::jsonb as result;
