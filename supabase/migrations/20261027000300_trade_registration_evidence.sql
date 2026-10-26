begin;

-- Evidence records only. This does not enable gas or electrical services.
alter table public.provider_verification_items
  drop constraint provider_verification_items_document_type_check;
alter table public.provider_verification_items
  add constraint provider_verification_items_document_type_check check (
    document_type in ('right_to_work', 'dbs', 'photo_id', 'public_liability_insurance',
      'trade_certificate', 'proof_of_address', 'gas_safe_registration', 'electrical_registration')
  );
alter table public.provider_verification_items
  add constraint trade_registration_has_number_and_expiry check (
    document_type not in ('gas_safe_registration', 'electrical_registration')
    or (length(btrim(reference)) between 2 and 120 and reference is not null and expires_at is not null)
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
    'right_to_work', 'photo_id', 'public_liability_insurance', 'trade_certificate', 'proof_of_address',
    'gas_safe_registration', 'electrical_registration'
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

  if p_document_type in ('gas_safe_registration', 'electrical_registration') then
    if p_reference is null or length(btrim(p_reference)) not between 2 and 120
      or p_expires_at is null or p_expires_at < current_date then
      raise exception 'Record the registration number or scheme and its current expiry date';
    end if;
    if not exists (select 1 from public.providers where id = p_provider_id
      and 'handyman' = any(services)) then
      raise exception 'A property maintenance service profile is required';
    end if;
  elsif p_reference is not null and (
    p_document_type <> 'right_to_work' or p_reference !~ '^[A-Z0-9]{9}$'
  ) then
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



alter table public.verification_renewal_reminders
  drop constraint verification_renewal_reminders_check_type_check;
alter table public.verification_renewal_reminders
  add constraint verification_renewal_reminders_check_type_check check (
    check_type in ('dbs', 'right_to_work', 'insurance', 'gas_safe_registration', 'electrical_registration')
  );

create function public.process_trade_registration_renewals()
returns integer language plpgsql security definer set search_path = public as $function$
declare item record; recipient record; phase text; inserted integer; total integer := 0;
begin
  for item in
    select p.id, p.profile_id, v.document_type, v.expires_at as due
    from public.providers p
    join public.profiles owner on owner.id = p.profile_id and owner.account_deleted_at is null
    join public.provider_verification_items v on v.provider_id = p.id
    where v.document_type in ('gas_safe_registration', 'electrical_registration')
      and v.status in ('verified', 'expired') and v.expires_at <= current_date + 30
  loop
    phase := case when item.due < current_date then 'expired' else 'due_soon' end;
    for recipient in
      select id, role::text from public.profiles
      where account_deleted_at is null and (id = item.profile_id or role::text = 'admin')
    loop
      insert into public.verification_renewal_reminders (
        provider_id, check_type, due_date, phase, recipient_id
      ) values (item.id, item.document_type, item.due, phase, recipient.id)
      on conflict do nothing;
      get diagnostics inserted = row_count;
      if inserted = 1 then
        insert into public.notifications (user_id, title, body, href) values (
          recipient.id,
          case item.document_type when 'gas_safe_registration' then 'Gas Safe registration expiry'
            else 'Electrical registration expiry' end,
          case phase when 'expired' then 'This registration has expired. Updated evidence needs staff verification.'
            else 'This registration expires on ' || item.due::text || '. Submit renewed evidence for staff verification.' end,
          case recipient.role when 'admin' then '/admin/cleaners/' || item.id::text
            else '/worker/profile#verification' end
        );
        total := total + 1;
      end if;
    end loop;
    if phase = 'expired' then
      update public.provider_verification_items set status = 'expired', updated_at = clock_timestamp()
      where provider_id = item.id and document_type = item.document_type and status = 'verified'
        and expires_at = item.due;
    end if;
  end loop;
  return total;
end;
$function$;
revoke all on function public.process_trade_registration_renewals() from public, anon, authenticated;
grant execute on function public.process_trade_registration_renewals() to service_role;

commit;
notify pgrst, 'reload schema';
