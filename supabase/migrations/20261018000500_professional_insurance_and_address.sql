begin;

alter table public.provider_verification_items
  drop constraint if exists provider_verification_items_document_type_check;
alter table public.provider_verification_items
  add constraint provider_verification_items_document_type_check check (
    document_type in ('right_to_work', 'dbs', 'photo_id', 'public_liability_insurance',
      'trade_certificate', 'proof_of_address')
  );

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
    'right_to_work', 'photo_id', 'public_liability_insurance', 'trade_certificate', 'proof_of_address'
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


alter function public.professional_verification_block(uuid, date)
  rename to professional_verification_block_before_client_documents;
create function public.professional_verification_block(p_provider_id uuid, p_today date default current_date)
returns text language plpgsql stable security definer set search_path = public
as $function$
declare reason text; required text;
begin
  reason := public.professional_verification_block_before_client_documents(p_provider_id, p_today);
  if reason is not null then return reason; end if;
  foreach required in array array['public_liability_insurance', 'proof_of_address'] loop
    if not exists (
      select 1 from public.provider_verification_items item
      join storage.objects file on file.bucket_id = 'provider-verification'
        and file.name = item.document_storage_path
      where item.provider_id = p_provider_id and item.document_type = required
        and item.status = 'verified' and item.uploaded_at is not null
        and (item.expires_at is null or item.expires_at >= p_today)
        and (item.next_check_at is null or item.next_check_at >= p_today)
        and (required <> 'public_liability_insurance' or item.expires_at is not null)
    ) then
      return case required when 'proof_of_address' then 'Verify proof of address before new job offers.'
        else 'Verify current public liability insurance before new job offers.' end;
    end if;
  end loop;
  return null;
end;
$function$;

alter function public.provider_service_approved(uuid, text)
  rename to provider_service_approved_before_client_documents;
create function public.provider_service_approved(p_provider uuid, p_service text)
returns boolean language sql stable security definer set search_path = public
as $function$
  select public.provider_service_approved_before_client_documents(p_provider, p_service)
    and public.professional_verification_block(p_provider) is null
    and (p_service <> 'handyman' or exists (
      select 1 from public.provider_verification_items item
      join storage.objects file on file.bucket_id = 'provider-verification'
        and file.name = item.document_storage_path
      where item.provider_id = p_provider and item.document_type = 'trade_certificate'
        and item.status = 'verified' and item.uploaded_at is not null
        and (item.expires_at is null or item.expires_at >= current_date)
    ));
$function$;

alter function public.review_professional_service(uuid, text, text, text)
  rename to review_professional_service_before_client_documents;
create function public.review_professional_service(
  p_provider uuid, p_service text, p_status text, p_reason text default null
) returns void language plpgsql security definer set search_path = public
as $function$
declare reason text;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_status = 'approved' then
    reason := public.professional_verification_block(p_provider);
    if reason is not null then raise exception '%', reason; end if;
    if p_service = 'handyman' and not exists (
      select 1 from public.provider_verification_items item
      join storage.objects file on file.bucket_id = 'provider-verification'
        and file.name = item.document_storage_path
      where item.provider_id = p_provider and item.document_type = 'trade_certificate'
        and item.status = 'verified' and item.uploaded_at is not null
        and (item.expires_at is null or item.expires_at >= current_date)
    ) then raise exception 'Verify training or certification before property maintenance approval'; end if;
  end if;
  perform public.review_professional_service_before_client_documents(p_provider, p_service, p_status, p_reason);
end;
$function$;

revoke all on function public.professional_verification_block_before_client_documents(uuid, date),
  public.provider_service_approved_before_client_documents(uuid, text),
  public.review_professional_service_before_client_documents(uuid, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.professional_verification_block(uuid, date),
  public.provider_service_approved(uuid, text),
  public.review_professional_service(uuid, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.professional_verification_block(uuid, date) to service_role;
grant execute on function public.provider_service_approved(uuid, text) to authenticated, service_role;
grant execute on function public.review_professional_service(uuid, text, text, text) to authenticated;

commit;
notify pgrst, 'reload schema';
