-- STAGING comwdjprdedmsnxtvuuk ONLY. Uses the owner's paid Sandbox QA booking.
-- All policy edits are UNCOMMITTED and rolled back. No account, permission,
-- booking, payment, acceptance or email is created. No personal values output.
begin;
do $smoke$
declare
  qa_booking uuid := '9d3d00d1-7c04-4b17-92c4-cd6e58de5812';
  owner_id uuid; staff_id uuid; legacy_booking uuid; legacy_owner uuid;
  original jsonb; after_edit jsonb; evidence_count bigint; acceptance_count bigint;
  mail_count bigint;
begin
  select customer_id into strict owner_id from public.bookings where id=qa_booking;
  select p.id into staff_id from public.profiles p
    where p.role::text='admin' and p.account_deleted_at is null
      and exists(select 1 from auth.mfa_factors f where f.user_id=p.id and f.factor_type='totp' and f.status='verified')
    order by p.id limit 1;
  if staff_id is null then raise exception 'A staging staff account with verified TOTP is required'; end if;
  select count(*) into evidence_count from public.booking_checkout_legal_consents;
  select count(*) into acceptance_count from public.account_legal_acceptances;
  select count(*) into mail_count from public.booking_legal_email_deliveries;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated','aal','aal1','amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true);
  original := public.booking_legal_contract(qa_booking);
  if original is null or jsonb_array_length(original->'documents')<>3 then raise exception 'Owner cannot read saved policies'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'role','authenticated','aal','aal1')::text,true);
  if public.booking_legal_contract(qa_booking) is not null then raise exception 'Another customer can read the booking'; end if;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',staff_id,'role','authenticated','aal','aal1','amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true);
  if public.is_admin() or public.booking_legal_contract(qa_booking) is not null then raise exception 'Password-only staff bypassed MFA'; end if;
  begin
    perform public.admin_booking_legal_email_status(qa_booking);
    raise exception 'Password-only staff read delivery status';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',staff_id,'role','authenticated','aal','aal2','amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true);
  if public.is_admin() then raise exception 'AAL2 without TOTP bypassed staff MFA'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',staff_id,'role','authenticated','aal','aal2','amr',jsonb_build_array(jsonb_build_object('method','password'),jsonb_build_object('method','totp')))::text,true);
  if not public.is_admin() or public.booking_legal_contract(qa_booking) is distinct from original then raise exception 'Verified TOTP staff cannot read exact saved policies'; end if;
  if public.admin_booking_legal_email_status(qa_booking)->>'status' is distinct from 'sent' then raise exception 'Verified staff cannot read delivery status'; end if;

  -- This row change never commits or becomes visible to other sessions.
  update public.legal_documents set version='999.999',content_html=content_html||'<p>STAGING ROLLBACK SNAPSHOT CHECK ONLY</p>' where slug='terms' and published;
  if not found then raise exception 'Published staging Terms are missing'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated','aal','aal1')::text,true);
  after_edit := public.booking_legal_contract(qa_booking);
  if after_edit is distinct from original then raise exception 'A current policy edit changed the historic accepted copy'; end if;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  begin
    perform public.prepare_booking_legal_consent_v2(owner_id,original->'documents','[]'::jsonb,original->'documents',original->'evidence');
    raise exception 'A new checkout accepted stale documents after a policy edit';
  exception when serialization_failure then null;
  end;

  select b.id,b.customer_id into legacy_booking,legacy_owner from public.bookings b
    where b.customer_id is not null and not exists(select 1 from public.account_legal_acceptances a where a.booking_id=b.id)
    order by b.created_at,b.id limit 1;
  if legacy_booking is null then raise exception 'An older booking fixture is required'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',legacy_owner,'role','authenticated','aal','aal1')::text,true);
  if public.booking_legal_contract(legacy_booking) is not null then raise exception 'Historic evidence was invented for an old booking'; end if;
  if (select count(*) from public.booking_checkout_legal_consents)<>evidence_count
    or (select count(*) from public.account_legal_acceptances)<>acceptance_count
    or (select count(*) from public.booking_legal_email_deliveries)<>mail_count
    then raise exception 'Access checks created evidence or an email'; end if;
end $smoke$;
rollback;
select 'PASS: owner; other-customer denial; password-only and non-TOTP staff denial; verified TOTP staff; immutable historic copies; stale-checkout rejection; unchanged old bookings' as staging_access_checks,
  'All edits rolled back. No account, permission, booking, payment, acceptance or email created.' as safety;
