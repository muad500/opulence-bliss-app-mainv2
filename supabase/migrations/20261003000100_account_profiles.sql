-- Account settings are shared by a person's customer and professional views.
-- Sensitive application and verification data stays outside the public profile.
begin;

create table if not exists public.account_profile_details (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  title text check (title is null or title in ('mr', 'mrs', 'miss', 'ms', 'mx', 'other')),
  first_name text,
  last_name text,
  photo_url text,
  contact_email boolean not null default true,
  contact_sms boolean not null default false,
  contact_whatsapp boolean not null default false,
  notify_bookings boolean not null default true,
  notify_messages boolean not null default true,
  marketing_emails boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  label text not null default 'Home',
  line1 text not null,
  line2 text,
  city text not null,
  postcode text not null,
  access_instructions text,
  property_type text,
  bedrooms smallint check (bedrooms is null or bedrooms between 0 and 30),
  bathrooms smallint check (bathrooms is null or bathrooms between 0 and 30),
  pets text,
  products_provided_by text check (products_provided_by is null or products_provided_by in ('customer', 'professional')),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists customer_addresses_user_idx on public.customer_addresses(user_id, created_at);
create unique index if not exists customer_addresses_one_default_idx on public.customer_addresses(user_id) where is_default;

-- Older customer accounts kept one unstructured address on profiles. Import
-- only rows with a separate postcode and an unambiguous final comma-delimited
-- town/city; leave other addresses for the customer to enter accurately.
with legacy as (
  select p.id as user_id,
         btrim(regexp_replace(p.address, ',[^,]*$', '')) as line1,
         btrim(regexp_replace(p.address, '^.*,', '')) as city,
         regexp_replace(upper(coalesce(p.postcode, '')), '[[:space:]]', '', 'g') as compact_postcode
    from public.profiles p
   where p.role::text = 'customer'
     and p.address like '%,%'
)
insert into public.customer_addresses(user_id, label, line1, city, postcode, is_default)
select legacy.user_id, 'Home', legacy.line1, legacy.city,
       left(legacy.compact_postcode, length(legacy.compact_postcode) - 3) || ' '
         || right(legacy.compact_postcode, 3), true
  from legacy
 where char_length(legacy.line1) between 1 and 180
   and char_length(legacy.city) between 2 and 100
   and legacy.city !~ '[0-9]'
   and legacy.compact_postcode ~ '^(GIR0AA|[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2})$'
   and not exists (select 1 from public.customer_addresses existing where existing.user_id = legacy.user_id);

create table if not exists public.customer_favourite_providers (
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider_id uuid not null references public.providers(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, provider_id)
);

create table if not exists public.account_billing_customers (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at timestamptz not null default now()
);
comment on table public.account_billing_customers is 'Private Stripe Customer mapping; payment methods and card details remain in Stripe.';

create table if not exists public.provider_profile_settings (
  provider_id uuid primary key references public.providers(id) on delete cascade,
  home_postcode text,
  emergency_contact_name text,
  emergency_contact_phone text,
  languages text[] not null default '{}',
  brings_equipment boolean not null default false,
  coverage_postcodes text[] not null default '{}',
  max_travel_miles smallint check (max_travel_miles is null or max_travel_miles between 0 and 100),
  max_daily_hours smallint check (max_daily_hours is null or max_daily_hours between 1 and 16),
  accepts_same_day boolean not null default true,
  alert_app boolean not null default true,
  alert_sms boolean not null default false,
  alert_email boolean not null default true,
  notify_messages boolean not null default true,
  vat_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.provider_profile_settings is 'Private professional contact, coverage, tax and alert preferences. Only the deliberate public profile fields are copied to providers.';

create table if not exists public.provider_time_off (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  note text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists provider_time_off_provider_time_idx on public.provider_time_off(provider_id, starts_at);

create table if not exists public.provider_task_rates (
  provider_id uuid not null references public.providers(id) on delete cascade,
  task_name text not null,
  hourly_rate_pence integer not null check (hourly_rate_pence between 100 and 100000),
  updated_at timestamptz not null default now(),
  primary key (provider_id, task_name)
);

create table if not exists public.provider_verification_items (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete cascade,
  document_type text not null check (document_type in ('right_to_work', 'dbs', 'photo_id', 'public_liability_insurance', 'trade_certificate')),
  label text,
  status text not null default 'pending' check (status in ('pending', 'verified', 'expired', 'rejected')),
  reference text,
  issued_at date,
  expires_at date,
  checked_at timestamptz,
  next_check_at date,
  reviewed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists provider_verification_provider_idx on public.provider_verification_items(provider_id, document_type);
comment on table public.provider_verification_items is 'Review metadata only. Do not store ID, visa, or DBS scans in this table; verification is not self-certified.';

create table if not exists public.account_legal_acceptances (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  document_slug text not null,
  version text not null,
  accepted_at timestamptz not null default now(),
  unique (user_id, document_slug, version)
);

create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  -- Retain the request's non-identifying outcome after the profile is erased.
  user_id uuid references public.profiles(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'in_review', 'completed', 'declined')),
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution_note text
);
create unique index if not exists account_deletion_one_open_idx on public.account_deletion_requests(user_id) where status in ('pending', 'in_review');

-- The account API authenticates the cookie user and performs narrow writes with
-- the service role. Browser clients have no direct access to these private tables.
do $tables$
declare table_name text;
begin
  foreach table_name in array array[
    'account_profile_details', 'customer_addresses', 'customer_favourite_providers', 'account_billing_customers',
    'provider_profile_settings', 'provider_time_off', 'provider_task_rates',
    'provider_verification_items', 'account_legal_acceptances', 'account_deletion_requests'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
    execute format('grant all on table public.%I to service_role', table_name);
  end loop;
end
$tables$;
grant usage, select on sequence public.account_legal_acceptances_id_seq to service_role;

create or replace function public.set_default_customer_address(p_user_id uuid, p_address_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required' using errcode = 'insufficient_privilege';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  if not exists (select 1 from public.customer_addresses where id = p_address_id and user_id = p_user_id) then
    raise exception 'Address not found' using errcode = 'no_data_found';
  end if;
  update public.customer_addresses set is_default = false where user_id = p_user_id and is_default;
  update public.customer_addresses set is_default = true where id = p_address_id and user_id = p_user_id;
end
$fn$;
revoke all on function public.set_default_customer_address(uuid, uuid) from public, anon, authenticated;
grant execute on function public.set_default_customer_address(uuid, uuid) to service_role;

-- A provider account can also use customer features. The legacy role still
-- identifies admins; it no longer excludes a professional from voting as a
-- customer when using the same sign-in.
create or replace function public.submit_customer_service_interest(
  p_service_key text, p_suggestion text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_customer_id uuid := auth.uid();
  v_role text;
  v_suggestion text := nullif(btrim(coalesce(p_suggestion, '')), '');
begin
  if v_customer_id is null then raise exception 'Sign in to vote'; end if;
  select role::text into v_role from public.profiles where id = v_customer_id;
  if v_role is null or v_role = 'admin' then raise exception 'Only customer accounts can vote'; end if;
  if p_service_key not in ('maintenance','moving_support','garden','pets','tech_help','carpet_upholstery') then
    raise exception 'Choose one of the available services';
  end if;
  if char_length(coalesce(v_suggestion, '')) > 500 then
    raise exception 'Suggestions must be 500 characters or fewer';
  end if;
  insert into public.customer_service_interest(customer_id,service_key,suggestion)
  values(v_customer_id,p_service_key,v_suggestion)
  on conflict (customer_id) do update set
    service_key=excluded.service_key,
    suggestion=excluded.suggestion,
    updated_at=now();
end
$fn$;
revoke all on function public.submit_customer_service_interest(text,text) from public, anon;
grant execute on function public.submit_customer_service_interest(text,text) to authenticated;

-- The old account role is exclusive. For booking operations, derive the side
-- from this particular booking instead, so a person may book and work with the
-- same sign-in without gaining access to anyone else's booking.
create or replace function public.account_booking_actor(
  p_booking_id uuid, p_assigned_only boolean default false
) returns text
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_booking public.bookings;
  v_provider uuid;
begin
  if v_uid is null then return null; end if;
  select role::text into v_role from public.profiles where id = v_uid;
  if v_role is null then return null; end if;
  select * into v_booking from public.bookings where id = p_booking_id;
  if not found then return null; end if;
  if v_role = 'admin' then return 'admin'; end if;
  if v_booking.customer_id = v_uid then return 'customer'; end if;
  select id into v_provider from public.providers where profile_id = v_uid;
  if v_provider is null then return null; end if;
  if v_booking.provider_id = v_provider then return 'provider'; end if;
  if not p_assigned_only and v_booking.provider_id is null and v_booking.status::text = 'offered'
     and exists (select 1 from public.booking_offers o where o.booking_id = p_booking_id
                 and o.provider_id = v_provider and o.status = 'open') then
    return 'provider';
  end if;
  return null;
end
$fn$;
revoke all on function public.account_booking_actor(uuid,boolean) from public, anon;
grant execute on function public.account_booking_actor(uuid,boolean) to authenticated;

create or replace function public.transition_booking(
  p_booking_id uuid, p_to_status text, p_reason text default null,
  p_meta jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_uid uuid := auth.uid();
  v_kind text;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = 'insufficient_privilege'; end if;
  v_kind := public.account_booking_actor(p_booking_id, false);
  if v_kind is null then raise exception 'not your booking' using errcode = 'insufficient_privilege'; end if;
  if v_kind in ('customer', 'provider') and p_to_status = 'needs_review' then
    raise exception 'use report_booking_exception to open review atomically' using errcode = 'check_violation';
  end if;
  return public._apply_booking_transition(p_booking_id, p_to_status, v_uid, v_kind, p_reason, p_meta);
end
$fn$;
revoke all on function public.transition_booking(uuid,text,text,jsonb) from public, anon;
grant execute on function public.transition_booking(uuid,text,text,jsonb) to authenticated;

create or replace function public.reschedule_booking(
  p_booking_id uuid, p_new_slot timestamptz, p_reason text default null,
  p_meta jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_uid uuid := auth.uid();
  v_kind text;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = 'insufficient_privilege'; end if;
  v_kind := public.account_booking_actor(p_booking_id, true);
  if v_kind is null then raise exception 'not your booking' using errcode = 'insufficient_privilege'; end if;
  return public._apply_reschedule(p_booking_id, p_new_slot, v_uid, v_kind, p_reason, p_meta);
end
$fn$;
revoke all on function public.reschedule_booking(uuid,timestamptz,text,jsonb) from public, anon;
grant execute on function public.reschedule_booking(uuid,timestamptz,text,jsonb) to authenticated;

create or replace function public.reschedule_window(p_booking_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  v_booking public.bookings;
  v_rules public.booking_rules;
  v_cutoff timestamptz;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = 'insufficient_privilege'; end if;
  select * into v_rules from public.booking_rules where id = 1;
  select * into v_booking from public.bookings where id = p_booking_id;
  if not found then return jsonb_build_object('can_reschedule', false, 'reason', 'not found'); end if;
  if public.account_booking_actor(p_booking_id, true) is null then
    raise exception 'not your booking' using errcode = 'insufficient_privilege';
  end if;
  if v_booking.status::text not in ('offered', 'declined', 'scheduled') then
    return jsonb_build_object('can_reschedule', false, 'reason', 'this visit can no longer be changed',
      'lockout_hours', v_rules.reschedule_lockout_hours);
  end if;
  v_cutoff := v_booking.scheduled_at - make_interval(hours => v_rules.reschedule_lockout_hours);
  return jsonb_build_object(
    'can_reschedule', now() < v_cutoff,
    'cutoff_at', v_cutoff,
    'lockout_hours', v_rules.reschedule_lockout_hours,
    'min_notice_hours', v_rules.min_notice_hours,
    'reason', case when now() < v_cutoff then null else
      format('changes need %s hours notice', v_rules.reschedule_lockout_hours) end
  );
end
$fn$;
revoke all on function public.reschedule_window(uuid) from public, anon;
grant execute on function public.reschedule_window(uuid) to authenticated;

create or replace function public.report_booking_exception(
  p_booking_id uuid, p_category text, p_reason text, p_notes text default null,
  p_meta jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_uid uuid := auth.uid();
  v_kind text;
  v_case_id uuid;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = 'insufficient_privilege'; end if;
  v_kind := public.account_booking_actor(p_booking_id, true);
  if v_kind is null then raise exception 'not your booking' using errcode = 'insufficient_privilege'; end if;
  if p_category = 'worker_no_show' and v_kind <> 'customer' then
    raise exception 'only the customer can report a provider no-show' using errcode = 'insufficient_privilege';
  elsif p_category = 'client_unavailable' and v_kind <> 'provider' then
    raise exception 'only the assigned provider can report no access' using errcode = 'insufficient_privilege';
  elsif p_category not in ('worker_no_show', 'client_unavailable') then
    raise exception 'unsupported exception category' using errcode = 'check_violation';
  end if;
  perform public._apply_booking_transition(p_booking_id, 'needs_review', v_uid, v_kind, p_reason, coalesce(p_meta, '{}'::jsonb));
  v_case_id := public.open_review_case(p_booking_id, p_category,
    case when p_category = 'worker_no_show' then 'urgent' else 'high' end,
    true, true, p_notes, null);
  return jsonb_build_object('ok', true, 'case_id', v_case_id);
end
$fn$;
revoke all on function public.report_booking_exception(uuid,text,text,text,jsonb) from public, anon;
grant execute on function public.report_booking_exception(uuid,text,text,text,jsonb) to authenticated;

create or replace function public.open_review_case(
  p_booking_id uuid, p_category text, p_priority text default 'normal',
  p_blocks_payment boolean default false, p_blocks_payout boolean default false,
  p_notes text default null, p_created_by uuid default null
) returns uuid language plpgsql security definer set search_path = public as $fn$
declare
  v_uid uuid := auth.uid();
  v_kind text := 'system';
  v_id uuid;
  v_sla jsonb;
  v_booking public.bookings;
begin
  -- The creator is derived from the session; p_created_by is retained only
  -- for the existing function signature.
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'booking % not found', p_booking_id using errcode = 'no_data_found'; end if;
  if v_uid is null then
    if coalesce(auth.role(), '') <> 'service_role' then
      raise exception 'not authenticated' using errcode = 'insufficient_privilege';
    end if;
  else
    v_kind := public.account_booking_actor(p_booking_id, true);
    if v_kind is null then raise exception 'not your booking' using errcode = 'insufficient_privilege'; end if;
  end if;
  select id into v_id from public.review_cases
    where booking_id = p_booking_id and category = p_category and status <> 'resolved' limit 1;
  if v_id is not null then return v_id; end if;
  v_sla := public._case_sla(p_priority);
  insert into public.review_cases (
    booking_id, category, priority, blocks_payment, blocks_payout,
    response_due_at, resolution_due_at, created_by
  ) values (
    p_booking_id, p_category, p_priority, p_blocks_payment, p_blocks_payout,
    now() + (v_sla->>'respond')::interval,
    now() + (v_sla->>'resolve')::interval,
    v_uid
  ) returning id into v_id;
  perform public._case_event(v_id, p_booking_id, 'opened', v_uid, v_kind,
    null, jsonb_build_object('category', p_category, 'priority', p_priority,
      'blocks_payment', p_blocks_payment, 'blocks_payout', p_blocks_payout),
    null, '{}'::jsonb);
  if p_notes is not null and trim(p_notes) <> '' then
    perform public._case_event(v_id, p_booking_id, 'note_added', v_uid, v_kind,
      null, jsonb_build_object('note', p_notes), null, '{}'::jsonb);
  end if;
  if p_blocks_payment or p_blocks_payout then
    perform public._hold_payout_for_case(p_booking_id, v_uid, v_kind, format('Case opened: %s', p_category));
  end if;
  return v_id;
end
$fn$;
revoke all on function public.open_review_case(uuid,text,text,boolean,boolean,text,uuid) from public, anon;
grant execute on function public.open_review_case(uuid,text,text,boolean,boolean,text,uuid) to authenticated, service_role;

commit;
