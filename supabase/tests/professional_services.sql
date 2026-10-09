-- Run on the isolated staging database. All synthetic records roll back.
begin;
create temporary table service_test_results (test text, passed boolean);

do $tests$
declare
  person uuid := gen_random_uuid();
  professional uuid := gen_random_uuid();
  reviewer uuid;
  original_hours jsonb;
  original_profile jsonb;
  original_settings jsonb;
  before_count bigint;
  rejected boolean := false;
begin
  select id into reviewer from public.profiles where role = 'admin' limit 1;
  if reviewer is null then raise exception 'A staging admin is needed for review tests'; end if;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (person, 'authenticated', 'authenticated', person || '@example.invalid', '{}', '{}', now(), now());
  insert into public.profiles (id, email, full_name, phone, role)
  values (person, person || '@example.invalid', 'Staging Service Fixture', '+447700900123', 'provider')
  on conflict (id) do update set full_name = excluded.full_name, phone = excluded.phone;
  insert into public.providers (id, profile_id, display_name, services, vetting_status)
  values (professional, person, 'Staging Service Fixture', array['cleaning'], 'pending');
  insert into public.provider_profile_settings (provider_id, home_postcode, coverage_postcodes, availability_configured)
  values (professional, 'SW1A 1AA', array['SW1A'], true);
  insert into public.provider_availability (provider_id, weekday, start_time, end_time)
  values (professional, 1, '09:00', '17:00');
  insert into public.provider_dbs_checks
    (provider_id, certificate_number, issue_date, status, uploaded_at)
  values (professional, '990000000001', current_date, 'verified', now());
  insert into storage.objects (bucket_id, name)
  values ('provider-verification', professional || '/fixture-id.pdf');
  insert into public.provider_verification_items
    (provider_id, document_type, label, status, reference, uploaded_at, gov_uk_checked_on)
  values (professional, 'right_to_work', 'Right to work', 'verified', 'A12345678', now(), current_date);
  insert into public.provider_verification_items
    (provider_id, document_type, label, status, document_storage_path, uploaded_at)
  values (professional, 'photo_id', 'Photo ID', 'verified', professional || '/fixture-id.pdf', now());

  perform set_config('request.jwt.claims', jsonb_build_object('sub', reviewer, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', reviewer::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform public.review_professional_service(professional, 'cleaning', 'approved');
  if not public.provider_service_approved(professional, 'cleaning') then
    raise exception 'Cleaning approval without insurance failed';
  end if;
  insert into service_test_results values ('Cleaning approval needs no insurance', true);

  select jsonb_agg(to_jsonb(hours) order by weekday, start_time) into original_hours
  from public.provider_availability as hours where provider_id = professional;
  select to_jsonb(settings) into original_settings
  from public.provider_profile_settings as settings where provider_id = professional;
  select to_jsonb(profile) into original_profile from public.profiles as profile where id = person;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform public.apply_handyman_trade(person, '{"legalName":"Must not overwrite","availability":[],"homePostcode":"N1 1AA"}');
  perform public.apply_handyman_trade(person, '{}');
  if not public.provider_service_approved(professional, 'cleaning')
     or (select service_approvals ->> 'handyman' from public.providers where id = professional) <> 'pending'
     or public.provider_service_approved(professional, 'handyman') then
    raise exception 'Adding handyman changed approval incorrectly';
  end if;
  if original_hours is distinct from (
    select jsonb_agg(to_jsonb(hours) order by weekday, start_time)
    from public.provider_availability as hours where provider_id = professional
  ) or original_settings is distinct from (
    select to_jsonb(settings) from public.provider_profile_settings as settings where provider_id = professional
  ) or original_profile is distinct from (
    select to_jsonb(profile) from public.profiles as profile where id = person
  ) then raise exception 'Adding a service changed shared data'; end if;
  insert into service_test_results values ('Adding handyman preserves approval, profile, coverage, postcode and hours', true);
  select count(*) into before_count from public.provider_service_events
    where provider_id = professional and service = 'handyman';
  if before_count <> 1 then raise exception 'A retry created duplicate service applications'; end if;
  insert into service_test_results values ('Adding a service is idempotent', true);

  perform set_config('request.jwt.claims', jsonb_build_object('sub', reviewer, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  begin
    perform public.review_professional_service(professional, 'handyman', 'approved');
  exception when others then
    if sqlerrm not like '%insurance%' then raise; end if;
    rejected := true;
  end;
  if not rejected then raise exception 'Handyman was approved without insurance'; end if;
  insert into service_test_results values ('Handyman requires insurance; cleaning remains approved', true);
  perform public.review_professional_service(professional, 'cleaning', 'suspended', 'Synthetic staging test');
  if public.provider_service_approved(professional, 'cleaning') then
    raise exception 'Suspended cleaning remained eligible';
  end if;
  insert into service_test_results values ('Service suspension blocks new offers for that service', true);

  if exists (
    select 1 from public.providers
    where vetting_status = 'approved' and 'cleaning' = any(services)
      and service_approvals ->> 'cleaning' is distinct from 'approved'
      and id <> professional
  ) then raise exception 'Existing approved cleaners were not backfilled'; end if;
  insert into service_test_results values ('Existing approved cleaners were backfilled', true);
end;
$tests$;
select * from service_test_results;
rollback;
