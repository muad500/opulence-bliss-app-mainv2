-- Private evidence for non-DBS professional checks. The DBS certificate keeps
-- its own minimised workflow and bucket.
begin;

alter table public.provider_verification_items
  add column if not exists document_storage_path text,
  add column if not exists document_original_name text,
  add column if not exists document_mime_type text,
  add column if not exists uploaded_at timestamptz,
  add column if not exists review_note text;

create unique index if not exists provider_verification_one_type_idx
  on public.provider_verification_items(provider_id, document_type);
create unique index if not exists provider_verification_storage_path_idx
  on public.provider_verification_items(document_storage_path)
  where document_storage_path is not null;

comment on column public.provider_verification_items.document_storage_path is
  'Path in the private provider-verification bucket. Never include this path in a public provider response.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'provider-verification', 'provider-verification', false, 8388608,
  array['application/pdf', 'image/jpeg', 'image/png']::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Uploads and signed links are created by authenticated server routes using
-- the service role. Direct client access is read-only and limited to the
-- document owner and administrators.
drop policy if exists "owners and admins read provider verification documents"
  on storage.objects;
create policy "owners and admins read provider verification documents"
on storage.objects for select to authenticated
using (
  bucket_id = 'provider-verification'
  and (
    (storage.foldername(name))[1] = public.current_provider_id()::text
    or public.is_admin()
  )
);

-- Serialize replacements for a provider and return the exact scan displaced by
-- this write. The server removes that scan only after this transaction commits.
create or replace function public.replace_provider_verification_document(
  p_provider_id uuid,
  p_document_type text,
  p_label text,
  p_document_storage_path text,
  p_document_original_name text,
  p_document_mime_type text,
  p_issued_at date,
  p_expires_at date
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
    p_provider_id, p_document_type, p_label, 'pending', null, p_issued_at, p_expires_at,
    null, null, null, null, p_document_storage_path,
    p_document_original_name, p_document_mime_type, clock_timestamp(), clock_timestamp()
  )
  on conflict (provider_id, document_type) do update set
    label = excluded.label,
    status = 'pending',
    reference = null,
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
  uuid, text, text, text, text, text, date, date
) from public, anon, authenticated;
grant execute on function public.replace_provider_verification_document(
  uuid, text, text, text, text, text, date, date
) to service_role;

-- Replacing or invalidating required evidence returns an approved provider to
-- review and removes their directory listing until an administrator reapproves.
create or replace function public.require_provider_reapproval_for_core_document()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_provider_id uuid;
  v_requires_reapproval boolean := false;
begin
  if tg_op = 'UPDATE' and (
    new.provider_id is distinct from old.provider_id
    or new.document_type is distinct from old.document_type
  ) then
    raise exception 'Verification document identity cannot be changed'
      using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' then
    v_provider_id := old.provider_id;
    v_requires_reapproval := old.document_type in ('right_to_work', 'photo_id');
  else
    v_provider_id := new.provider_id;
    if new.document_type in ('right_to_work', 'photo_id') then
      v_requires_reapproval := new.status <> 'verified'
        or new.document_storage_path is null
        or new.uploaded_at is null
        or (new.expires_at is not null and new.expires_at < current_date)
        or (new.next_check_at is not null and new.next_check_at < current_date);
      if tg_op = 'UPDATE' then
        v_requires_reapproval := v_requires_reapproval
          or new.document_storage_path is distinct from old.document_storage_path;
      end if;
    end if;
  end if;

  if v_requires_reapproval then
    update public.providers
    set vetting_status = 'pending', show_on_our_pros = false
    where id = v_provider_id and vetting_status = 'approved';
  end if;
  return null;
end
$fn$;

drop trigger if exists require_provider_reapproval_for_core_document
  on public.provider_verification_items;
create trigger require_provider_reapproval_for_core_document
after insert or update or delete
on public.provider_verification_items
for each row execute function public.require_provider_reapproval_for_core_document();

revoke all on function public.require_provider_reapproval_for_core_document()
  from public, anon, authenticated;

-- Existing approved accounts are not changed by this migration or by later
-- document expiry. A new approval always checks current required evidence.
create or replace function public.enforce_core_provider_documents_before_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_check_approval boolean := tg_op = 'INSERT';
begin
  if tg_op = 'UPDATE' then
    v_check_approval := old.vetting_status is distinct from 'approved';
  end if;
  if new.vetting_status = 'approved'
     and v_check_approval
     and exists (
       select 1
       from (values ('right_to_work'), ('photo_id')) as required(document_type)
       where not exists (
         select 1 from public.provider_verification_items item
         where item.provider_id = new.id
           and item.document_type = required.document_type
           and item.status = 'verified'
           and item.uploaded_at is not null
           and item.document_storage_path is not null
           and (item.expires_at is null or item.expires_at >= current_date)
           and (item.next_check_at is null or item.next_check_at >= current_date)
           and exists (
             select 1 from storage.objects stored_file
             where stored_file.bucket_id = 'provider-verification'
               and stored_file.name = item.document_storage_path
           )
       )
     ) then
    raise exception 'Right-to-work and photo ID documents must be verified before provider approval'
      using errcode = 'check_violation';
  end if;
  return new;
end
$fn$;

drop trigger if exists enforce_core_provider_documents_before_approval on public.providers;
create trigger enforce_core_provider_documents_before_approval
before insert or update of vetting_status on public.providers
for each row execute function public.enforce_core_provider_documents_before_approval();

revoke all on function public.enforce_core_provider_documents_before_approval()
  from public, anon, authenticated;

-- The earlier DBS approval guard must also cover a provider inserted directly
-- as approved, since the core-document guard now covers INSERT too.
create or replace function public.enforce_dbs_before_provider_approval()
returns trigger
language plpgsql
set search_path = public
as $fn$
declare
  v_check_approval boolean := tg_op = 'INSERT';
begin
  if tg_op = 'UPDATE' then
    v_check_approval := old.vetting_status is distinct from 'approved';
  end if;
  if new.vetting_status = 'approved' and v_check_approval and not new.dbs_verified then
    raise exception 'DBS verification is required before provider approval'
      using errcode = 'check_violation';
  end if;
  return new;
end
$fn$;

drop trigger if exists enforce_dbs_before_provider_approval on public.providers;
create trigger enforce_dbs_before_provider_approval
before insert or update of vetting_status on public.providers
for each row execute function public.enforce_dbs_before_provider_approval();

revoke all on function public.enforce_dbs_before_provider_approval()
  from public, anon, authenticated;

commit;
