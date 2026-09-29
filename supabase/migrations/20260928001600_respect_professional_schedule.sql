-- Apply saved professional preferences both when building an offer queue and
-- when an offer is accepted. The latter also covers a customer-selected
-- alternative time and direct booking transitions.
begin;

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

  -- If working hours have been published, the whole appointment must fit a period.
  if exists (select 1 from public.provider_availability hours where hours.provider_id = p_provider_id)
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
