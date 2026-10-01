-- Apply saved professional preferences both when building an offer queue and
-- when an offer is accepted. The latter also covers a customer-selected
-- alternative time and direct booking transitions.
begin;

-- Existing professionals without saved hours keep their legacy matching until
-- they publish a schedule. A deliberately empty published schedule means off.
alter table public.provider_profile_settings
  add column if not exists availability_configured boolean not null default false;

create or replace function public.my_professional_availability_configured()
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce((
    select settings.availability_configured
    from public.providers professional
    join public.provider_profile_settings settings on settings.provider_id = professional.id
    where professional.profile_id = (select auth.uid())
    limit 1
  ), false);
$fn$;
revoke all on function public.my_professional_availability_configured() from public, anon, service_role;
grant execute on function public.my_professional_availability_configured() to authenticated;

-- Replace the whole weekly schedule in one transaction, including the
-- deliberately empty schedule. The same lock is used by booking acceptance.
create or replace function public.save_my_professional_availability(p_periods jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  professional_id uuid;
  period jsonb;
  day_number integer;
  start_value time;
  end_value time;
  seen_days integer[] := '{}';
begin
  if (select auth.uid()) is null then raise exception 'Sign in to save availability'; end if;
  select id into professional_id from public.providers where profile_id = (select auth.uid()) limit 1;
  if professional_id is null then raise exception 'Professional account not found'; end if;
  if p_periods is null or jsonb_typeof(p_periods) <> 'array' or jsonb_array_length(p_periods) > 7 then
    raise exception 'Invalid weekly availability';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('professional-schedule:' || professional_id::text, 0));
  delete from public.provider_availability where provider_id = professional_id;
  for period in select value from jsonb_array_elements(p_periods) as item(value) loop
    if jsonb_typeof(period) <> 'object'
       or coalesce(period->>'weekday', '') !~ '^[0-6]$'
       or coalesce(period->>'start_time', '') !~ '^(0[7-9]|1[0-9]|20):00$'
       or coalesce(period->>'end_time', '') !~ '^(0[8-9]|1[0-9]|20|21):00$' then
      raise exception 'Invalid working hours';
    end if;
    day_number := (period->>'weekday')::integer;
    if day_number = any(seen_days) then raise exception 'Duplicate weekday'; end if;
    seen_days := array_append(seen_days, day_number);
    start_value := (period->>'start_time')::time;
    end_value := (period->>'end_time')::time;
    if end_value <= start_value then raise exception 'Working hours must end after they start'; end if;
    insert into public.provider_availability(provider_id, weekday, start_time, end_time)
      values (professional_id, day_number, start_value, end_value);
  end loop;
  insert into public.provider_profile_settings(provider_id, availability_configured, updated_at)
    values (professional_id, true, now())
    on conflict (provider_id) do update
      set availability_configured = true, updated_at = excluded.updated_at;
end
$fn$;
revoke all on function public.save_my_professional_availability(jsonb) from public, anon, service_role;
grant execute on function public.save_my_professional_availability(jsonb) to authenticated;

-- Return only public directory IDs whose required evidence is still current.
-- The public profile and directory use this instead of exposing private scans.
create or replace function public.public_eligible_provider_ids()
returns table(id uuid)
language sql
stable
security definer
set search_path = public
as $fn$
  select professional.id
  from public.providers professional
  where professional.vetting_status = 'approved'
    and professional.dbs_verified = true
    and professional.is_suspended = false
    and professional.show_on_our_pros = true
    and not exists (
      select 1 from public.provider_verification_items item
      where item.provider_id = professional.id
        and item.document_type in ('right_to_work', 'photo_id')
        and (item.status <> 'verified'
          or (item.expires_at is not null and item.expires_at < current_date)
          or (item.next_check_at is not null and item.next_check_at < current_date))
    );
$fn$;
revoke all on function public.public_eligible_provider_ids() from public, service_role;
grant execute on function public.public_eligible_provider_ids() to anon, authenticated;

create or replace function public.professional_booking_conflict(
  p_provider_id uuid, p_booking_id uuid, p_slot timestamptz
)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  visit public.bookings;
  professional public.providers;
  settings public.provider_profile_settings;
  local_start timestamp;
  local_end timestamp;
  visit_minutes integer;
  day_minutes integer;
  postcode_match text[];
  service_postcode text;
  outward_code text;
begin
  select * into visit from public.bookings where id = p_booking_id;
  if not found then return 'booking is unavailable'; end if;
  select * into professional from public.providers where id = p_provider_id;
  if not found then return 'professional is unavailable'; end if;
  if professional.profile_id = visit.customer_id then
    return 'you cannot accept your own booking';
  end if;

  -- An approved professional can become ineligible when evidence expires with
  -- the passage of time, even if no document row was edited that day.
  if exists (
    select 1 from public.provider_verification_items item
    where item.provider_id = p_provider_id
      and item.document_type in ('right_to_work', 'photo_id')
      and (item.status <> 'verified'
        or (item.expires_at is not null and item.expires_at < current_date)
        or (item.next_check_at is not null and item.next_check_at < current_date))
  ) then return 'your verification needs review'; end if;

  visit_minutes := coalesce(visit.duration_minutes, 120);
  local_start := p_slot at time zone 'Europe/London';
  local_end := (p_slot + make_interval(mins => visit_minutes)) at time zone 'Europe/London';

  if exists (
    select 1 from public.provider_time_off off_time
    where off_time.provider_id = p_provider_id
      and off_time.starts_at < p_slot + make_interval(mins => visit_minutes)
      and off_time.ends_at > p_slot
  ) then return 'this visit overlaps your time off'; end if;

  -- An empty coverage list keeps the existing service-area matching. When a
  -- service postcode is present, a saved full postcode or outward code narrows
  -- that matching. Checkout stores the postcode in the booking address.
  select * into settings from public.provider_profile_settings where provider_id = p_provider_id;
  if found then
    if cardinality(settings.coverage_postcodes) > 0 then
      postcode_match := regexp_match(
        upper(coalesce(visit.address, '')),
        '(^|[^A-Z0-9])([A-Z]{1,2}[0-9][A-Z0-9]?[[:space:]]*[0-9][A-Z]{2}|GIR[[:space:]]*0AA)([^A-Z0-9]|$)'
      );
      if postcode_match is not null then
        service_postcode := regexp_replace(postcode_match[2], '[[:space:]]', '', 'g');
        outward_code := left(service_postcode, length(service_postcode) - 3);
        if not exists (
          select 1 from unnest(settings.coverage_postcodes) as coverage(value)
          where regexp_replace(upper(btrim(coverage.value)), '[[:space:]]', '', 'g')
            in (service_postcode, outward_code)
        ) then return 'service postcode is outside your saved coverage'; end if;
      end if;
    end if;

    if not settings.accepts_same_day
       and local_start::date = (now() at time zone 'Europe/London')::date then
      return 'you do not accept same-day visits';
    end if;
    if settings.max_daily_hours is not null then
      select coalesce(sum(coalesce(other.duration_minutes, 120)), 0)::integer
        into day_minutes
      from public.bookings other
      where other.provider_id = p_provider_id
        and other.id <> visit.id
        and (other.scheduled_at at time zone 'Europe/London')::date = local_start::date
        and other.status::text in ('scheduled', 'in_progress', 'completed', 'needs_review');
      if day_minutes + visit_minutes > settings.max_daily_hours * 60 then
        return 'this visit exceeds your maximum daily hours';
      end if;
    end if;
  end if;

  -- An empty published schedule means unavailable, including every-day-off.
  if (coalesce(settings.availability_configured, false)
      or exists (select 1 from public.provider_availability hours where hours.provider_id = p_provider_id))
     and not exists (
       select 1 from public.provider_availability hours
       where hours.provider_id = p_provider_id
         and hours.weekday = extract(dow from local_start)::integer
         and local_start::date = local_end::date
         and hours.start_time <= local_start::time
         and hours.end_time >= local_end::time
     ) then return 'this visit is outside your working hours'; end if;

  return null;
end
$fn$;
revoke all on function public.professional_booking_conflict(uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role;

create or replace function public.filter_professional_offer_queue()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  visit_slot timestamptz;
begin
  select scheduled_at into visit_slot from public.bookings where id = new.booking_id;
  if not found or public.professional_booking_conflict(new.provider_id, new.booking_id, visit_slot) is not null then
    return null;
  end if;
  return new;
end
$fn$;

drop trigger if exists filter_professional_offer_queue on public.booking_offer_queue;
create trigger filter_professional_offer_queue
before insert on public.booking_offer_queue
for each row execute function public.filter_professional_offer_queue();
revoke all on function public.filter_professional_offer_queue()
  from public, anon, authenticated, service_role;

-- The booking state machine assigns the provider in this update. Recheck an
-- assigned visit when it is rescheduled too. Serialise checks for one
-- professional so concurrent assignments cannot both pass a daily-hours cap.
create or replace function public.check_professional_offer_acceptance()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  conflict_reason text;
begin
  perform pg_advisory_xact_lock(hashtextextended('professional-schedule:' || new.provider_id::text, 0));
  conflict_reason := public.professional_booking_conflict(new.provider_id, new.id, new.scheduled_at);
  if conflict_reason is not null then
    raise exception '%', conflict_reason using errcode = 'check_violation';
  end if;
  return new;
end
$fn$;

drop trigger if exists check_professional_offer_acceptance on public.bookings;
create trigger check_professional_offer_acceptance
before update of status, provider_id, scheduled_at on public.bookings
for each row
when (new.status::text = 'scheduled' and new.provider_id is not null
      and (old.status::text = 'offered'
        or new.provider_id is distinct from old.provider_id
        or new.scheduled_at is distinct from old.scheduled_at))
execute function public.check_professional_offer_acceptance();
revoke all on function public.check_professional_offer_acceptance()
  from public, anon, authenticated, service_role;

commit;
