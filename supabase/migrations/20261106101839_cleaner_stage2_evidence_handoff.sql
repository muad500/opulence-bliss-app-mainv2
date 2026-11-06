begin;

-- The same inspected evidence is filed after the passed applicant receives
-- their own account. No new self-certification or second live check is needed.
create function public.staff_file_cleaner_evidence(p_application uuid,p_type text,
  p_path text,p_name text,p_mime text,p_expires date,p_note text,p_cover_pence bigint default null)
returns text language plpgsql security definer set search_path = '' as $fn$
declare app public.cleaner_applications; check_record cleaner_onboarding_private.stages; previous text;
begin
  perform cleaner_onboarding_private.assert_staff(p_application,true);
  if not public.can_view_dbs() or not public.staff_has_permission('private_evidence') then
    raise exception 'Named onboarding access with authenticator required.';
  end if;
  select * into strict app from public.cleaner_applications where id=p_application;
  if app.provider_id is null or app.status not in ('assessment_passed','accepted_setup')
    or p_type not in ('photo_id','right_to_work','proof_of_address','public_liability_insurance')
    or char_length(btrim(coalesce(p_note,''))) not between 10 and 2000
    or coalesce(p_mime,'') not in ('application/pdf','image/jpeg','image/png')
    or char_length(coalesce(p_name,'')) not between 1 and 240
    or not starts_with(p_path,app.provider_id::text||'/'||p_type||'/')
    or not exists(select 1 from storage.objects where bucket_id='provider-verification' and name=p_path)
    or (p_expires is not null and p_expires<current_date) then
    raise exception 'Choose the passed applicant and the inspected private evidence.';
  end if;
  select * into strict check_record from cleaner_onboarding_private.stages
    where application_id=app.id and stage='id_rtw_verified' and completed_at is not null;
  if p_type='public_liability_insurance' and (p_expires is null or coalesce(p_cover_pence,0)<100000000) then
    raise exception 'Verified cleaner insurance must cover at least GBP 1 million and be in date.';
  end if;
  select document_storage_path into previous from public.provider_verification_items
    where provider_id=app.provider_id and document_type=p_type for update;
  insert into public.provider_verification_items(provider_id,document_type,label,status,
    document_storage_path,document_original_name,document_mime_type,uploaded_at,checked_at,reviewed_by,
    review_note,gov_uk_checked_on,expires_at,next_check_at)
    values(app.provider_id,p_type,p_type,'verified',p_path,p_name,p_mime,clock_timestamp(),clock_timestamp(),auth.uid(),
      p_note||case when p_type='public_liability_insurance' then ' [Cover checked: GBP '||(p_cover_pence/100)::text||']' else '' end,
      case when p_type='right_to_work' then (check_record.details->>'checked_on')::date end,
      case when p_type='right_to_work' then nullif(check_record.details->>'expires_on','')::date else p_expires end,
      case when p_type='right_to_work' then nullif(check_record.details->>'expires_on','')::date end)
    on conflict(provider_id,document_type) do update set
      status=excluded.status,document_storage_path=excluded.document_storage_path,
      document_original_name=excluded.document_original_name,document_mime_type=excluded.document_mime_type,
      uploaded_at=excluded.uploaded_at,checked_at=excluded.checked_at,reviewed_by=excluded.reviewed_by,
      review_note=excluded.review_note,gov_uk_checked_on=excluded.gov_uk_checked_on,
      expires_at=excluded.expires_at,next_check_at=excluded.next_check_at,updated_at=clock_timestamp();
  insert into cleaner_onboarding_private.events(application_id,actor,action,stage,note)
    values(app.id,auth.uid(),'evidence_verified','id_rtw_verified',p_type||': '||p_note);
  return previous;
end;
$fn$;

alter function public.professional_reviewed_documents(uuid,uuid) rename to professional_reviewed_documents_before_stage2_files;
create function public.professional_reviewed_documents(p_provider uuid,p_staff uuid)
returns boolean language sql stable security definer set search_path = '' as $fn$
  select public.professional_reviewed_documents_before_stage2_files(p_provider,p_staff)
    or exists(select 1 from cleaner_onboarding_private.events e join public.cleaner_applications a on a.id=e.application_id
      where a.provider_id=p_provider and e.actor=p_staff and e.action='evidence_verified');
$fn$;
revoke all on function public.staff_file_cleaner_evidence(uuid,text,text,text,text,date,text,bigint),
  public.professional_reviewed_documents(uuid,uuid),public.professional_reviewed_documents_before_stage2_files(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.staff_file_cleaner_evidence(uuid,text,text,text,text,date,text,bigint) to authenticated;
notify pgrst,'reload schema';
commit;
