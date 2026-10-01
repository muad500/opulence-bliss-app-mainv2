begin;
create extension if not exists pg_cron with schema pg_catalog;
create or replace function public.replace_provider_verification_document(
  p_provider_id uuid,
  p_document_type text,
  p_label text,
  p_document_storage_path text,
  p_document_original_name text,
  p_document_mime_type text,
  p_issued_at date,
  p_expires_at date,
  p_reference text
) returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_previous_path text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required' using errcode = 'insufficient_privilege';
  end if;
  if p_provider_id is null or p_document_type is null or p_document_type not in (
    'right_to_work', 'photo_id', 'public_liability_insurance', 'trade_certificate'
  ) or p_document_storage_path is null
    or not starts_with(p_document_storage_path, p_provider_id::text || '/' || p_document_type || '/')
    or p_document_mime_type is null
    or p_document_mime_type not in ('application/pdf', 'image/jpeg', 'image/png') then
    raise exception 'Invalid verification document' using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'provider-verification' and name = p_document_storage_path
  ) then
    raise exception 'Uploaded verification document was not found' using errcode = 'no_data_found';
  end if;

  if p_reference is not null and (p_document_type <> 'right_to_work' or p_reference !~ '^[A-Z0-9]{9}$') then
    raise exception 'Invalid right-to-work share code';
  end if;
  -- The provider lock orders concurrent uploads before either reads the old
  -- path, including the first insert when no document row exists yet.
  perform 1 from public.providers where id = p_provider_id for update;
  if not found then raise exception 'Provider not found' using errcode = 'no_data_found'; end if;
  select document_storage_path into v_previous_path
  from public.provider_verification_items
  where provider_id = p_provider_id and document_type = p_document_type
  for update;

  insert into public.provider_verification_items (
    provider_id, document_type, label, status, reference, issued_at, expires_at,
    checked_at, next_check_at, reviewed_by, review_note, document_storage_path,
    document_original_name, document_mime_type, uploaded_at, updated_at
  ) values (
    p_provider_id, p_document_type, p_label, 'pending', p_reference, p_issued_at, p_expires_at,
    null, null, null, null, p_document_storage_path,
    p_document_original_name, p_document_mime_type, clock_timestamp(), clock_timestamp()
  )
  on conflict (provider_id, document_type) do update set
    label = excluded.label,
    status = 'pending',
    reference = excluded.reference,
    issued_at = excluded.issued_at,
    expires_at = excluded.expires_at,
    checked_at = null,
    next_check_at = null,
    reviewed_by = null,
    review_note = null,
    document_storage_path = excluded.document_storage_path,
    document_original_name = excluded.document_original_name,
    document_mime_type = excluded.document_mime_type,
    uploaded_at = excluded.uploaded_at,
    updated_at = excluded.updated_at;

  return v_previous_path;
end
$fn$;

revoke all on function public.replace_provider_verification_document(
  uuid, text, text, text, text, text, date, date, text
) from public, anon, authenticated;
grant execute on function public.replace_provider_verification_document(
  uuid, text, text, text, text, text, date, date, text
) to service_role;

-- Keep older previews working during rollout; new code supplies the reference.
create or replace function public.replace_provider_verification_document(
  p_provider_id uuid,p_document_type text,p_label text,p_document_storage_path text,
  p_document_original_name text,p_document_mime_type text,p_issued_at date,p_expires_at date
) returns text language sql security definer set search_path=public as $fn$
  select public.replace_provider_verification_document(p_provider_id,p_document_type,p_label,p_document_storage_path,
    p_document_original_name,p_document_mime_type,p_issued_at,p_expires_at,null);
$fn$;
revoke all on function public.replace_provider_verification_document(uuid,text,text,text,text,text,date,date) from public,anon,authenticated;
grant execute on function public.replace_provider_verification_document(uuid,text,text,text,text,text,date,date) to service_role;

create or replace function public.replace_provider_dbs_certificate(p_provider_id uuid,p_number text,p_issue_date date,p_path text,p_name text,p_mime text)
returns text language plpgsql security definer set search_path=public as $fn$
declare v_previous text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  if p_number !~ '^[0-9]{12}$' or p_issue_date > current_date or p_issue_date < date '2000-01-01'
    or not starts_with(p_path,p_provider_id::text || '/') or p_mime not in ('application/pdf','image/jpeg','image/png')
    or not exists(select 1 from storage.objects where bucket_id='provider-dbs' and name=p_path) then
    raise exception 'Invalid DBS certificate';
  end if;
  perform 1 from public.providers where id=p_provider_id for update;
  if not found then raise exception 'Professional not found'; end if;
  select certificate_storage_path into v_previous from public.provider_dbs_checks where provider_id=p_provider_id;
  insert into public.provider_dbs_checks(provider_id,certificate_number,issue_date,certificate_storage_path,certificate_original_name,certificate_mime_type,status,uploaded_at)
  values(p_provider_id,p_number,p_issue_date,p_path,p_name,p_mime,'pending',now())
  on conflict(provider_id) do update set certificate_number=excluded.certificate_number,issue_date=excluded.issue_date,
    certificate_storage_path=excluded.certificate_storage_path,certificate_original_name=excluded.certificate_original_name,
    certificate_mime_type=excluded.certificate_mime_type,status='pending',uploaded_at=now(),submitted_at=now(),
    reviewed_at=null,reviewed_by=null,review_note=null,certificate_deleted_at=null,updated_at=now();
  return v_previous;
end $fn$;
revoke all on function public.replace_provider_dbs_certificate(uuid,text,date,text,text,text) from public,anon,authenticated;
grant execute on function public.replace_provider_dbs_certificate(uuid,text,date,text,text,text) to service_role;

alter table public.provider_dbs_checks add column if not exists recheck_reminded_for date;
create or replace function public.remind_professional_document_checks()
returns void language plpgsql security definer set search_path=public as $fn$
declare item record; due date;
begin
  for item in select d.*,p.profile_id from public.provider_dbs_checks d join public.providers p on p.id=d.provider_id
    where d.status='verified' and not p.is_suspended and d.reviewed_at is not null for update of d skip locked
  loop
    due := (item.reviewed_at + interval '1 year')::date;
    if due <= current_date + 30 and item.recheck_reminded_for is distinct from due then
      insert into public.notifications(user_id,title,body,href) values(item.profile_id,'Annual DBS re-check due',
        'Your annual re-check is due on ' || due::text || '. Submit an updated certificate from your profile.','/worker/profile#verification');
      update public.provider_dbs_checks set recheck_reminded_for=due where provider_id=item.provider_id;
    end if;
  end loop;
end $fn$;
revoke all on function public.remind_professional_document_checks() from public,anon,authenticated;
grant execute on function public.remind_professional_document_checks() to service_role;
select cron.schedule('opulence-dbs-recheck-reminders','0 8 * * *',$$select public.remind_professional_document_checks();$$);

commit;
