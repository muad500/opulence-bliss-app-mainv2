-- STAGING ONLY. Fictional identities inside one rolled-back transaction.
-- Does not send email, contact Stripe, persist an approval or return bank text.
begin;
do $smoke$
declare
  manager uuid:='f6000000-0000-4000-8000-000000000001';
  reviewer uuid:='f6000000-0000-4000-8000-000000000002';
  account uuid:='f6000000-0000-4000-8000-000000000003';
  app uuid; host uuid; provider uuid; snap jsonb; stage text; evidence jsonb; part jsonb; item jsonb;
  catalog jsonb; token uuid; n integer; threshold integer; apps_before integer; blocked boolean;
  accepted timestamptz; policy jsonb; documents jsonb; evidence_batch jsonb; evidence_path text; document_type text;
begin
  select count(*) into apps_before from public.cleaner_applications;
  select w.catalog into strict catalog from cleaner_onboarding_private.wording_versions w where version='1.0';
  insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data) values
    (manager,'test-stage2-manager@example.invalid','{"full_name":"TEST Stage2 Manager"}','{}'),
    (reviewer,'test-stage2-reviewer@example.invalid','{"full_name":"TEST Stage2 Reviewer"}','{}'),
    (account,'test-stage2-walkthrough@example.invalid','{"full_name":"TEST Stage2 Existing Customer"}','{}');
  insert into public.profiles(id,email,full_name,role) values
    (manager,'test-stage2-manager@example.invalid','TEST Stage2 Manager','admin'),
    (reviewer,'test-stage2-reviewer@example.invalid','TEST Stage2 Reviewer','admin'),
    (account,'test-stage2-walkthrough@example.invalid','TEST Stage2 Existing Customer','customer')
    on conflict(id) do update set role=excluded.role;
  insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,secret,created_at,updated_at) values
    (gen_random_uuid(),manager,'TEST fixture only','totp','verified','TEST_NOT_A_REAL_AUTHENTICATOR',now(),now()),
    (gen_random_uuid(),reviewer,'TEST fixture only','totp','verified','TEST_NOT_A_REAL_AUTHENTICATOR',now(),now());
  insert into public.staff_role_memberships(profile_id,staff_role,assigned_by) values(manager,'manager',manager),(reviewer,'manager',manager)
    on conflict(profile_id) do update set staff_role=excluded.staff_role;
  insert into public.dbs_onboarding_staff(profile_id,granted_by) values(manager,manager),(reviewer,manager);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',manager,'role','authenticated','aal','aal2',
    'amr',jsonb_build_array(jsonb_build_object('method','totp')))::text,true);
  if not public.staff_has_permission('manage') or not public.can_view_dbs() then raise exception 'Fictional MFA scope failed';end if;
  for threshold in 11..12 loop
    app:=public.submit_cleaner_application(jsonb_build_object(
      'fullName','TEST Stage2 Walkthrough','email',case when threshold=12 then 'test-stage2-walkthrough@example.invalid' else 'test-stage2-fail@example.invalid' end,
      'phone',case when threshold=12 then '+442079460031' else '+442079460032' end,
      'postcode','SW1A1AA','areas',jsonb_build_array('Central London'),'experience','TEST fictional experience',
      'availability','TEST fictional weekday hours','rightToWorkType','TEST fictional checked evidence','checksAcknowledged',true),
      catalog->'declarations'->0->>'wording','Onboarding Process 3.1A','1.0');
    if exists(select 1 from public.providers where profile_id=account) then raise exception 'Account before assessment';end if;
    blocked:=false;
    begin perform public.staff_record_cleaner_application(app,'complete','screened','{}','TEST should be blocked');
    exception when others then blocked:=true;end;
    if not blocked then raise exception 'Incomplete checklist passed';end if;
    foreach stage in array array['screened','interviewed','id_rtw_verified','dbs_recorded','experience_checked'] loop
      select g into strict part from jsonb_array_elements(catalog->'checklists') g where g->>'stage'=stage;
      for item in select * from jsonb_array_elements(part->'items') loop
        perform public.staff_tick_cleaner_checklist(app,part->>'id',item->>'id',true,'TEST fictional checklist evidence');
      end loop;
      evidence:=case stage
        when 'screened' then '{"note":"TEST desk screening"}'::jsonb
        when 'interviewed' then '{"notes":"TEST fictional interview"}'::jsonb
        when 'id_rtw_verified' then jsonb_build_object('checked_on',current_date,'document_type','TEST live inspection',
          'outcome','verified','no_expiry',true,'self_employment_permitted',true)
        when 'dbs_recorded' then jsonb_build_object('certificate_name','TEST Fictional Certificate',
          'certificate_number',case when threshold=12 then '000000000031' else '000000000032' end,
          'issue_date',current_date,'outcome','clear')
        else '{"evidence":"TEST fictional experience evidence"}'::jsonb end;
      perform public.staff_record_cleaner_application(app,'record',stage,evidence,'TEST original evidence reviewed');
      perform public.staff_record_cleaner_application(app,'complete',stage,'{}','TEST completed ordered checklist');
    end loop;
    host:=public.staff_issue_cleaner_induction(app,now()+interval '1 day','https://meet.google.com/abc-defg-hij',
      repeat(case when threshold=12 then 'd' else 'b' end,64),now()+interval '1 day 6 hours',null);
    blocked:=false;
    begin perform public.cleaner_assessment_start(repeat(case when threshold=12 then 'd' else 'b' end,64),
      repeat(case when threshold=12 then 'e' else 'c' end,64),true);
    exception when others then blocked:=true;end;
    if not blocked then raise exception 'Closed host did not block';end if;
    perform public.staff_cleaner_assessment_host(host,true,app,true,'TEST attended fictional induction');
    snap:=public.cleaner_assessment_start(repeat(case when threshold=12 then 'd' else 'b' end,64),
      repeat(case when threshold=12 then 'e' else 'c' end,64),true);
    for n in 1..15 loop
      -- The choice is resolved only inside the database. No answer or bank
      -- content is printed, persisted in this file or sent to a browser.
      select q.option_tokens[array_position(q.option_order,case when n<=threshold then q.correct_option
        else (q.correct_option%3+1)::smallint end)] into strict token
        from cleaner_assessment_private.attempt_questions q where q.attempt_id=(snap->>'attemptId')::uuid and q.position=n;
      snap:=public.cleaner_assessment_command(repeat(case when threshold=12 then 'e' else 'c' end,64),
        (snap->>'attemptId')::uuid,'answer',n,token,null);
    end loop;
    if threshold=11 then
      if snap->>'phase'<>'failed' or not exists(select 1 from public.cleaner_applications where id=app and status='not_progressed') then
        raise exception 'Eleven-answer failure did not close application';end if;
    else
      if snap->>'phase'<>'writing' then raise exception 'Twelve-answer pass did not open writing';end if;
      snap:=public.cleaner_assessment_command(repeat('e',64),(snap->>'attemptId')::uuid,'writing_submit',null,null,'TEST fictional applicant writing');
      perform public.staff_mark_cleaner_writing((snap->>'attemptId')::uuid,true,'TEST human writing review meets criteria');
      provider:=public.link_cleaner_passed_account(repeat('e',64),account);
      if (select role::text from public.profiles where id=account)<>'customer' then raise exception 'Existing customer role replaced';end if;
      if (select vetting_status::text from public.providers where id=provider)<>'pending' then raise exception 'Unexpected activation';end if;
      if not public.professional_reviewed_documents(provider,manager) or public.professional_reviewed_documents(provider,reviewer) then
        raise exception 'Independent reviewer test failed';end if;
      blocked:=false;
      begin perform public.complete_cleaner_stage2_setup(account,'acct_TEST_FICTIONAL');
      exception when others then blocked:=true;end;
      if not blocked then raise exception 'Incomplete setup passed';end if;
      accepted:=clock_timestamp();
      select jsonb_agg(jsonb_build_object('slug',d.slug,'version',d.version,'title',d.title,
        'sourceContentHtml',d.content_html,'contentHtml',d.content_html,
        'contentHash',encode(sha256(convert_to(d.content_html,'UTF8')),'hex'),
        'pdfSha256',d.pdf_sha256)) into documents from public.legal_documents d where d.published
        and d.slug in ('cleaner-terms','cleaner-cancellation','privacy','safeguarding','dbs-data');
      evidence_batch:=jsonb_build_object('schemaVersion',1,'acceptedAt',accepted,'request',jsonb_build_object('ip','192.0.2.1'),
        'documents',documents,'checkboxes',jsonb_build_array(
          jsonb_build_object('key','cleaner_terms_v1','text','TEST fictional acceptance fixture','checked',true),
          jsonb_build_object('key','self_employed','text','TEST fictional acceptance fixture','checked',true),
          jsonb_build_object('key','safeguarding','text','TEST fictional acceptance fixture','checked',true),
          jsonb_build_object('key','dbs','text','TEST fictional acceptance fixture','checked',true),
          jsonb_build_object('key','cleaner_insurance','text','TEST fictional acceptance fixture','checked',true)));
      for policy in select * from jsonb_array_elements(documents) loop
        insert into public.account_legal_acceptances(user_id,document_slug,version,accepted_at,acceptance_evidence)
          values(account,policy->>'slug',policy->>'version',accepted,
            (evidence_batch-'documents')||jsonb_build_object('document',policy)) on conflict do nothing;
      end loop;
      perform public.record_cleaner_stage2_acceptances(account,evidence_batch);
      insert into public.provider_profile_settings(provider_id,emergency_contact_name,emergency_contact_relationship,emergency_contact_phone)
        values(provider,'TEST Emergency Contact','TEST relationship','+442079460041')
        on conflict(provider_id) do update set emergency_contact_name=excluded.emergency_contact_name,
          emergency_contact_relationship=excluded.emergency_contact_relationship,emergency_contact_phone=excluded.emergency_contact_phone;
      -- A database fixture only: this does not create a Stripe account or prove
      -- the separate hosted Stripe test onboarding. No money is processed.
      update public.providers set stripe_account_id='acct_TEST_DATABASE_FIXTURE' where id=provider;
      perform public.complete_cleaner_stage2_setup(account,'acct_TEST_DATABASE_FIXTURE');
      foreach document_type in array array['photo_id','right_to_work','proof_of_address','public_liability_insurance'] loop
        evidence_path:=provider::text||'/'||document_type||'/TEST-fixture.pdf';
        insert into storage.objects(bucket_id,name) values('provider-verification',evidence_path);
        perform public.staff_file_cleaner_evidence(app,document_type,evidence_path,'TEST fixture metadata only.pdf','application/pdf',
          case when document_type='public_liability_insurance' then current_date+30 end,'TEST fictional document verification only',
          case when document_type='public_liability_insurance' then 100000000 end);
      end loop;
      for part in select * from jsonb_array_elements(catalog->'checklists') g
        where g->>'id' in ('insuranceCheck','inductionAssessment','acceptancesSetup') loop
        for item in select * from jsonb_array_elements(part->'items') loop
          perform public.staff_tick_cleaner_checklist(app,part->>'id',item->>'id',true,'TEST fictional setup evidence reviewed');
        end loop;
      end loop;
      perform public.review_professional_service(provider,'cleaning','approved','TEST first review of fictional evidence');
      blocked:=false;
      begin perform public.review_professional_service(provider,'cleaning','approved','TEST same-person attempt must fail');
      exception when others then blocked:=true;end;
      if not blocked then raise exception 'Same-person second sign-off passed';end if;
      perform set_config('request.jwt.claims',jsonb_build_object('sub',reviewer,'role','authenticated','aal','aal2',
        'amr',jsonb_build_array(jsonb_build_object('method','totp')))::text,true);
      select g into strict part from jsonb_array_elements(catalog->'checklists') g where g->>'id'='independentActivation';
      for item in select * from jsonb_array_elements(part->'items') loop
        perform public.staff_tick_cleaner_checklist(app,part->>'id',item->>'id',true,'TEST independent fictional review');
      end loop;
      perform public.review_professional_service(provider,'cleaning','approved','TEST independent second sign-off, rolled back');
      if not exists(select 1 from public.cleaner_applications where id=app and status='active') then
        raise exception 'Complete independent fixture did not become Active';end if;
      blocked:=false;
      begin update public.cleaner_stage2_policy_acceptances set accepted_at=clock_timestamp() where user_id=account;
      exception when others then blocked:=true;end;
      if not blocked then raise exception 'Acceptance evidence was editable';end if;
    end if;
  end loop;
  if (select count(*) from public.cleaner_applications)<>apps_before+2 then raise exception 'Unexpected application side effects';end if;
end;
$smoke$;
rollback;
select jsonb_build_object('passed',true,'fictionalApplications',2,'serverThresholds',jsonb_build_array(11,12),
  'orderedChecklists',true,'hostGate',true,'accountHandoff',true,'freshAcceptances',true,'independentReview',true,
  'persistedFixtures',0,'emailsSent',0,'payments',0) as staging_workflow_result;
