begin;

-- The person keeps one account, evidence set, payout account and calendar.
-- Approval to deliver a service is separate from the person's core vetting.
alter table public.providers
  add column service_approvals jsonb not null default '{}'::jsonb;

update public.providers as provider
set service_approvals = (
  select coalesce(jsonb_object_agg(service, provider.vetting_status::text), '{}'::jsonb)
  from unnest(provider.services) as service
  where service in ('cleaning', 'handyman')
);

create unique index if not exists providers_one_account_per_profile
  on public.providers (profile_id);

create table public.provider_service_events (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete cascade,
  service text not null check (service in ('cleaning', 'handyman')),
  previous_status text,
  status text not null check (status in ('pending', 'approved', 'rejected', 'suspended')),
  reason text,
  reviewed_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.provider_service_events enable row level security;
create policy service_events_read on public.provider_service_events
  for select to authenticated using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
    or exists (select 1 from public.providers where id = provider_id and profile_id = auth.uid())
  );
grant select on public.provider_service_events to authenticated;
grant all on public.provider_service_events to service_role;

create function public.guard_professional_service_approvals()
returns trigger
language plpgsql security definer set search_path = public
as $function$
declare
  service text;
  actor_is_admin boolean;
begin
  actor_is_admin := auth.role() = 'service_role' or exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
  if tg_op = 'INSERT' then
    if not actor_is_admin and new.service_approvals <> '{}'::jsonb then
      raise exception 'Only the review team can approve services';
    end if;
  elsif new.service_approvals is distinct from old.service_approvals and not actor_is_admin then
    raise exception 'Only the review team can change service approval';
  end if;

  for service in select unnest(new.services) loop
    if service in ('cleaning', 'handyman') and not (new.service_approvals ? service) then
      new.service_approvals := new.service_approvals || jsonb_build_object(service, 'pending');
    end if;
  end loop;
  if exists (
    select 1 from jsonb_each_text(new.service_approvals) as entry
    where entry.key not in ('cleaning', 'handyman')
      or entry.value not in ('pending', 'approved', 'rejected', 'suspended')
      or not (entry.key = any(new.services))
  ) then raise exception 'Invalid professional service approval'; end if;

  for service in select jsonb_object_keys(new.service_approvals) loop
    if new.service_approvals ->> service = 'approved'
       and (tg_op = 'INSERT' or old.service_approvals ->> service is distinct from 'approved') then
      if new.vetting_status <> 'approved' or new.is_suspended
         or public.professional_verification_block(new.id) is not null then
        raise exception 'Verify the shared professional account before service approval';
      end if;
      if service = 'handyman' and not exists (
        select 1 from public.provider_verification_items as item
        join storage.objects as file on file.bucket_id = 'provider-verification'
          and file.name = item.document_storage_path
        where item.provider_id = new.id and item.document_type = 'public_liability_insurance'
          and item.status = 'verified' and item.uploaded_at is not null
          and item.expires_at >= current_date
      ) then raise exception 'Verify current handyman public liability insurance'; end if;
    end if;
  end loop;
  return new;
end;
$function$;

create trigger professional_service_approvals
  before insert or update of services, service_approvals on public.providers
  for each row execute function public.guard_professional_service_approvals();

-- Insurance gates handyman approval only, never cleaning or shared vetting.
drop trigger if exists handyman_approval on public.providers;

create function public.provider_service_approved(p_provider uuid, p_service text)
returns boolean
language sql stable security definer set search_path = public
as $function$
  select exists (
    select 1 from public.providers as provider
    where provider.id = p_provider
      and provider.vetting_status = 'approved'
      and provider.is_suspended = false
      and provider.service_approvals ->> p_service = 'approved'
      and p_service = any(provider.services)
  );
$function$;

create function public.request_professional_service(p_user uuid, p_service text)
returns uuid
language plpgsql security definer set search_path = public
as $function$
declare
  professional public.providers;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  if p_service not in ('cleaning', 'handyman') then raise exception 'Unknown service'; end if;
  select * into professional from public.providers where profile_id = p_user for update;
  if not found then raise exception 'Complete the shared professional application first'; end if;
  if professional.service_approvals ? p_service then return professional.id; end if;

  -- No shared profile, coverage, checks, postcode, vetting or hours are changed.
  update public.providers
  set services = array_append(services, p_service),
      service_approvals = service_approvals || jsonb_build_object(p_service, 'pending')
  where id = professional.id;
  insert into public.provider_service_events (provider_id, service, status)
  values (professional.id, p_service, 'pending');
  return professional.id;
end;
$function$;

create or replace function public.apply_handyman_trade(p_user uuid, p_details jsonb)
returns uuid
language plpgsql security definer set search_path = public
as $function$
begin
  return public.request_professional_service(p_user, 'handyman');
end;
$function$;

create function public.review_professional_service(
  p_provider uuid, p_service text, p_status text, p_reason text default null
)
returns void
language plpgsql security definer set search_path = public
as $function$
declare
  professional public.providers;
  previous_status text;
  block_reason text;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Admins only';
  end if;
  if p_service not in ('cleaning', 'handyman')
     or p_status not in ('approved', 'rejected', 'suspended', 'pending') then
    raise exception 'Invalid review decision';
  end if;
  select * into professional from public.providers where id = p_provider for update;
  if not found or not (professional.service_approvals ? p_service) then
    raise exception 'No application for this service';
  end if;
  previous_status := professional.service_approvals ->> p_service;
  if previous_status = p_status then return; end if;
  if p_status in ('approved', 'rejected') and previous_status <> 'pending' then
    raise exception 'Only pending service applications can be approved or rejected';
  end if;
  if p_status = 'suspended' and previous_status <> 'approved' then
    raise exception 'Only an approved service can be suspended';
  end if;
  if p_status = 'pending' and previous_status not in ('suspended', 'rejected') then
    raise exception 'Only a suspended or rejected service can be reopened';
  end if;
  if p_status in ('rejected', 'suspended') and nullif(btrim(p_reason), '') is null then
    raise exception 'Record a reason for this decision';
  end if;
  if p_status = 'approved' then
    if professional.is_suspended then raise exception 'The shared account is suspended'; end if;
    block_reason := public.professional_verification_block(p_provider);
    if block_reason is not null then raise exception '%', block_reason; end if;
    if not exists (
      select 1 from public.provider_verification_items as item
      join storage.objects as file on file.bucket_id = 'provider-verification'
        and file.name = item.document_storage_path
      where item.provider_id = p_provider and item.document_type = 'photo_id'
        and item.status = 'verified' and item.uploaded_at is not null
        and (item.expires_at is null or item.expires_at >= current_date)
    ) then raise exception 'Verify photo ID before approval'; end if;
    if p_service = 'handyman' then
      if not exists (
        select 1 from public.provider_verification_items as item
        join storage.objects as file on file.bucket_id = 'provider-verification'
          and file.name = item.document_storage_path
        where item.provider_id = p_provider and item.document_type = 'public_liability_insurance'
          and item.status = 'verified' and item.uploaded_at is not null
          and item.expires_at >= current_date
      ) then raise exception 'Verify current handyman public liability insurance'; end if;
      if not exists (select 1 from public.provider_task_rates where provider_id = p_provider) then
        raise exception 'Set at least one handyman task and hourly rate';
      end if;
    end if;
    -- First approved service opens shared tools. Adding another never closes them.
    update public.providers set vetting_status = 'approved' where id = p_provider;
  end if;
  update public.providers
  set service_approvals = service_approvals || jsonb_build_object(p_service, p_status)
  where id = p_provider;
  insert into public.provider_service_events
    (provider_id, service, previous_status, status, reason, reviewed_by)
  values (p_provider, p_service, previous_status, p_status, left(p_reason, 500), auth.uid());
end;
$function$;

-- Keep all existing shared-calendar, self-booking, capacity and evidence guards.
alter function public.professional_booking_conflict(uuid, uuid, timestamptz)
  rename to professional_booking_conflict_before_services;
create function public.professional_booking_conflict(
  p_provider_id uuid, p_booking_id uuid, p_slot timestamptz
)
returns text
language plpgsql security definer set search_path = public
as $function$
begin
  if not public.provider_service_approved(p_provider_id, 'cleaning') then
    return 'Cleaning service is not approved';
  end if;
  return public.professional_booking_conflict_before_services(p_provider_id, p_booking_id, p_slot);
end;
$function$;

alter function public.handyman_available(uuid, uuid, text, timestamptz, integer, uuid)
  rename to handyman_available_before_services;
create function public.handyman_available(
  p_provider uuid, p_customer uuid, p_postcode text,
  p_slot timestamptz, p_minutes integer, p_exclude uuid default null
)
returns boolean
language sql stable security definer set search_path = public
as $function$
  select public.provider_service_approved(p_provider, 'handyman')
    and public.handyman_available_before_services(
      p_provider, p_customer, p_postcode, p_slot, p_minutes, p_exclude
    );
$function$;

create function public.guard_cleaning_service_offer()
returns trigger
language plpgsql security definer set search_path = public
as $function$
begin
  if not public.provider_service_approved(new.provider_id, 'cleaning') then return null; end if;
  return new;
end;
$function$;
create trigger cleaning_service_offer
  before insert on public.booking_offers for each row
  execute function public.guard_cleaning_service_offer();

create function public.professional_duplicate_warnings(p_provider uuid)
returns table (provider_id uuid, display_name text, matched_fields text[])
language sql stable security definer set search_path = public
as $function$
  select other.id, other.display_name, array_remove(array[
    case when nullif(lower(btrim(person.full_name)), '') = lower(btrim(other_person.full_name))
      then 'name' end,
    case when details.date_of_birth = other_details.date_of_birth then 'date of birth' end,
    case when nullif(regexp_replace(person.phone, '[^0-9]', '', 'g'), '')
      = regexp_replace(other_person.phone, '[^0-9]', '', 'g') then 'phone' end
  ], null)
  from public.providers as target
  join public.profiles as person on person.id = target.profile_id
  left join public.provider_onboarding_details as details on details.provider_id = target.id
  join public.providers as other on other.id <> target.id
  join public.profiles as other_person on other_person.id = other.profile_id
  left join public.provider_onboarding_details as other_details on other_details.provider_id = other.id
  where target.id = p_provider
    and exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
    and (
      nullif(lower(btrim(person.full_name)), '') = lower(btrim(other_person.full_name))
      or details.date_of_birth = other_details.date_of_birth
      or nullif(regexp_replace(person.phone, '[^0-9]', '', 'g'), '')
        = regexp_replace(other_person.phone, '[^0-9]', '', 'g')
    );
$function$;

revoke all on function public.guard_professional_service_approvals(),
  public.guard_cleaning_service_offer(), public.professional_booking_conflict_before_services(uuid, uuid, timestamptz),
  public.professional_booking_conflict(uuid, uuid, timestamptz),
  public.handyman_available_before_services(uuid, uuid, text, timestamptz, integer, uuid),
  public.handyman_available(uuid, uuid, text, timestamptz, integer, uuid),
  public.provider_service_approved(uuid, text), public.request_professional_service(uuid, text),
  public.review_professional_service(uuid, text, text, text), public.professional_duplicate_warnings(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.provider_service_approved(uuid, text),
  public.request_professional_service(uuid, text),
  public.handyman_available(uuid, uuid, text, timestamptz, integer, uuid) to service_role;
grant execute on function public.review_professional_service(uuid, text, text, text),
  public.professional_duplicate_warnings(uuid) to authenticated;

commit;
