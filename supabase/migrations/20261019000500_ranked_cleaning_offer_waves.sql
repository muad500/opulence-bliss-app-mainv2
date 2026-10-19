begin;

-- F1: private ranking and two durable offer waves. No money operations change.
create table public.job_offer_settings (
  id boolean primary key default true check (id),
  first_wave_size integer not null default 5 check (first_wave_size between 1 and 100),
  second_wave_after_minutes integer not null default 10 check (second_wave_after_minutes between 1 and 1440),
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
insert into public.job_offer_settings(id) values (true);
alter table public.job_offer_settings enable row level security;
revoke all on public.job_offer_settings from public, anon, authenticated;
grant select, update on public.job_offer_settings to service_role;

-- Public district centroids only. Never send home addresses or full private
-- postcodes to a geocoder, or expose the resulting ranking to other cleaners.
create table public.offer_geo_outcodes (
  outcode text primary key,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  updated_at timestamptz not null default now()
);
alter table public.offer_geo_outcodes enable row level security;
revoke all on public.offer_geo_outcodes from public, anon, authenticated;
grant select, insert, update on public.offer_geo_outcodes to service_role;

alter table public.booking_offer_runs
  drop constraint if exists booking_offer_runs_cadence_minutes_check,
  add column run_id uuid not null default gen_random_uuid(),
  add column wave_size integer not null default 5,
  add column wave_wait_minutes integer not null default 10,
  add column first_wave_at timestamptz,
  add column second_wave_due_at timestamptz,
  add column second_wave_at timestamptz,
  add column settings_version integer not null default 1;
alter table public.booking_offer_queue
  add column wave integer,
  add column ranking jsonb not null default '{}'::jsonb;

-- Preserve response history across re-broadcasts/reschedules. Losing a race is
-- deliberately distinct from declining or ignoring an offer.
create table public.job_offer_deliveries (
  run_id uuid not null,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  provider_id uuid not null references public.providers(id) on delete cascade,
  wave integer not null,
  rank_position integer not null,
  ranking jsonb not null,
  outcome text not null check (outcome in ('offered', 'accepted', 'declined', 'expired', 'lost')),
  offered_at timestamptz not null default now(),
  finished_at timestamptz,
  primary key (run_id, provider_id)
);
create index job_offer_history_provider on public.job_offer_deliveries(provider_id, outcome);
alter table public.job_offer_deliveries enable row level security;
revoke all on public.job_offer_deliveries from public, anon, authenticated, service_role;

insert into public.job_offer_deliveries
  (run_id, booking_id, provider_id, wave, rank_position, ranking, outcome, offered_at, finished_at)
select r.run_id, q.booking_id, q.provider_id, 1, q.queue_position, '{}',
  q.outcome, coalesce(q.activated_at, q.created_at), q.finished_at
from public.booking_offer_queue q join public.booking_offer_runs r using(booking_id)
where q.outcome <> 'waiting';

create table public.job_offer_notices (
  run_id uuid not null,
  provider_id uuid not null references public.providers(id) on delete cascade,
  kind text not null check (kind in ('offered', 'taken')),
  created_at timestamptz not null default now(),
  primary key (run_id, provider_id, kind)
);
alter table public.job_offer_notices enable row level security;
revoke all on public.job_offer_notices from public, anon, authenticated, service_role;

-- Preserve opt-in offer emails through the existing durable delivery worker.
-- Each wave/cleaner has one stable email ID for provider-side deduplication.
create table public.job_offer_emails (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  booking_id uuid not null references public.bookings(id),
  provider_id uuid not null references public.providers(id),
  status text not null default 'pending' check(status in ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  attempts integer not null default 0,
  claimed_at timestamptz,
  claim_token uuid,
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  provider_ref text,
  last_error text,
  unique(run_id, provider_id)
);
alter table public.job_offer_emails enable row level security;
revoke all on public.job_offer_emails from public, anon, authenticated, service_role;

create function public._offer_outcode(p_value text)
returns text language sql immutable set search_path = public
as $function$
  select coalesce(
    (regexp_match(upper(coalesce(p_value, '')), '([A-Z]{1,2}[0-9][A-Z0-9]?)[[:space:]]*[0-9][A-Z]{2}'))[1],
    case when upper(btrim(p_value)) ~ '^[A-Z]{1,2}[0-9][A-Z0-9]?$' then upper(btrim(p_value)) end
  );
$function$;

-- Use the same conflict predicate for ranking and the final locked assignment.
-- The former cleaning predicate checked hours/capacity but not overlapping
-- cleaning visits. Keep all of it, then check both services' calendar entries.
create or replace function public.professional_booking_conflict(
  p_provider_id uuid, p_booking_id uuid, p_slot timestamptz
)
returns text language plpgsql security definer set search_path = public
as $function$
declare reason text; minutes integer; day_minutes integer; maximum integer;
begin
  if not public.provider_service_approved(p_provider_id, 'cleaning') then
    return 'Cleaning service is not approved';
  end if;
  reason := public.professional_booking_conflict_before_services(p_provider_id, p_booking_id, p_slot);
  if reason is not null then return reason; end if;
  select coalesce(duration_minutes, 120) into minutes from public.bookings where id = p_booking_id;
  if exists (
    select 1 from public.bookings b
    where b.provider_id = p_provider_id and b.id <> p_booking_id
      and b.status::text in ('scheduled', 'in_progress', 'needs_review')
      and b.scheduled_at < p_slot + make_interval(mins => minutes)
      and b.scheduled_at + make_interval(mins => coalesce(b.duration_minutes, 120)) > p_slot
  ) then return 'This visit clashes with another cleaning job'; end if;
  if exists (
    select 1 from public.handyman_jobs j where j.provider_id = p_provider_id
      and (j.status in ('scheduled', 'in_progress', 'awaiting_customer', 'awaiting_authorization', 'payment_pending', 'cancel_pending')
        or (j.status = 'checkout_pending' and j.created_at > now() - interval '1 hour'))
      and j.scheduled_at < p_slot + make_interval(mins => minutes)
      and j.scheduled_at + make_interval(mins => greatest(60, coalesce(j.worked_minutes, j.estimated_minutes))) > p_slot
  ) then return 'This visit clashes with another service job'; end if;
  select coalesce(max_daily_hours, 8) * 60 into maximum
    from public.provider_profile_settings where provider_id = p_provider_id;
  select coalesce(sum(duration), 0)::integer into day_minutes from (
    select coalesce(b.duration_minutes, 120) as duration from public.bookings b
    where b.provider_id = p_provider_id and b.id <> p_booking_id
      and b.status::text in ('scheduled', 'in_progress', 'needs_review', 'completed')
      and (b.scheduled_at at time zone 'Europe/London')::date = (p_slot at time zone 'Europe/London')::date
    union all
    select greatest(60, coalesce(j.worked_minutes, j.estimated_minutes))
    from public.handyman_jobs j where j.provider_id = p_provider_id
      and (j.status in ('scheduled', 'in_progress', 'awaiting_customer', 'awaiting_authorization', 'payment_pending', 'cancel_pending', 'completed')
        or (j.status = 'checkout_pending' and j.created_at > now() - interval '1 hour'))
      and (j.scheduled_at at time zone 'Europe/London')::date = (p_slot at time zone 'Europe/London')::date
  ) calendar;
  if day_minutes + minutes > coalesce(maximum, 480) then return 'Professional daily hours exceeded'; end if;
  return null;
end;
$function$;

create trigger cleaning_calendar_insert before insert on public.bookings
  for each row when (new.provider_id is not null and new.status::text = 'scheduled')
  execute function public.check_professional_offer_acceptance();
create trigger cleaning_calendar_duration before update of duration_minutes on public.bookings
  for each row when (new.provider_id is not null and new.status::text = 'scheduled'
    and new.duration_minutes is distinct from old.duration_minutes)
  execute function public.check_professional_offer_acceptance();

create function public._cleaning_offer_qualified(p_provider uuid, p_booking uuid, p_slot timestamptz default null)
returns boolean language sql stable security definer set search_path = public
as $function$
  select exists (
    select 1 from public.bookings b
    join public.providers p on p.id = p_provider
    join public.profiles profile on profile.id = p.profile_id
    left join public.packages package on package.id = b.package_id
    left join public.regular_booking_series series on series.id = b.regular_series_id
    where b.id = p_booking and b.status::text = 'offered' and b.provider_id is null
      and not coalesce(series.billing_paused, false)
      and least(coalesce(b.offer_expires_at, b.scheduled_at - interval '2 hours'), b.scheduled_at - interval '2 hours') > now()
      and profile.account_deleted_at is null and p.profile_id <> b.customer_id
      and public.provider_service_approved(p.id, 'cleaning')
      and (package.service_type is null or package.service_type = any(p.services))
      and exists (
        select 1 from public.provider_service_areas link
        join public.service_areas area on area.id = link.service_area_id
        where link.provider_id = p.id and area.active
          and public._offer_outcode(b.address) = any(area.postcode_prefixes)
      )
      and exists (
        select 1 from unnest(
          case when p_slot is not null then array[p_slot]
            else array[coalesce(b.preferred_scheduled_at, b.scheduled_at)] || coalesce(b.optional_scheduled_at, '{}'::timestamptz[])
          end
        ) slot
        where slot > now() + interval '2 hours'
          and (p_slot is null or slot = coalesce(b.preferred_scheduled_at, b.scheduled_at) or slot = any(b.optional_scheduled_at))
          and public.professional_booking_conflict(p.id, b.id, slot) is null
      )
  );
$function$;

create function public._rank_cleaning_offers(p_booking uuid)
returns table(provider_id uuid, score numeric, factors jsonb)
language sql stable security definer set search_path = public
as $function$
  with candidates as (
    select p.id, coalesce(p.rating_avg, 3)::numeric as rating,
      case when p.id = b.preferred_provider_id or exists (
        select 1 from public.customer_favourite_providers f where f.user_id = b.customer_id and f.provider_id = p.id
      ) then 2 when exists (
        select 1 from public.bookings old where old.customer_id = b.customer_id and old.provider_id = p.id and old.status::text = 'completed'
      ) then 1 else 0 end as loyalty,
      case when origin.latitude is not null and destination.latitude is not null then
        6371.0 * 2 * asin(least(1.0, sqrt(
          power(sin(radians(destination.latitude - origin.latitude) / 2), 2)
          + cos(radians(origin.latitude)) * cos(radians(destination.latitude))
          * power(sin(radians(destination.longitude - origin.longitude) / 2), 2)
        ))) end as distance_km,
      (select count(*) from public.bookings done where done.provider_id = p.id and done.status::text = 'completed') as completed,
      (select count(*) from public.job_offer_deliveries d where d.provider_id = p.id and d.outcome = 'accepted') as accepted,
      (select count(*) from public.job_offer_deliveries d where d.provider_id = p.id and d.outcome in ('accepted', 'declined', 'expired')) as decided,
      (select count(distinct e.booking_id) from public.booking_events e
        join public.bookings cancelled on cancelled.id = e.booking_id
        where e.actor_id = p.profile_id and e.actor_kind = 'provider'
          and e.from_status in ('scheduled', 'needs_review')
          and e.to_status in ('offered', 'cancelled', 'needs_review')
          and ((e.meta ->> 'late') = 'true' or e.created_at >= cancelled.scheduled_at - interval '24 hours')) as late_cancellations,
      (select count(distinct c.booking_id) from public.review_cases c
        join public.bookings missed on missed.id = c.booking_id
        where missed.provider_id = p.id and c.category = 'worker_no_show'
          and c.status = 'resolved' and c.resolution_amount > 0
          and not exists (select 1 from public.check_ins checkin where checkin.booking_id = missed.id and checkin.arrived_at is not null)) as no_shows
    from public.bookings b cross join public.providers p
    join public.profiles profile on profile.id = p.profile_id
    left join public.provider_profile_settings settings on settings.provider_id = p.id
    left join public.offer_geo_outcodes origin on origin.outcode = public._offer_outcode(coalesce(settings.home_postcode, profile.postcode))
    left join public.offer_geo_outcodes destination on destination.outcode = public._offer_outcode(b.address)
    where b.id = p_booking and public._cleaning_offer_qualified(p.id, b.id)
      and not exists (select 1 from public.booking_offers declined where declined.booking_id = b.id and declined.provider_id = p.id and declined.status = 'declined')
      and not exists (
        select 1 from public.booking_events withdrawal where withdrawal.booking_id = b.id
          and withdrawal.actor_kind = 'provider' and withdrawal.actor_id = p.profile_id
          and withdrawal.from_status in ('scheduled', 'needs_review') and withdrawal.to_status = 'offered'
      )
  ), scores as (
    select *, (accepted + 1.0) / (decided + 2.0) as acceptance_rate,
      1.0 - least(1.0, (late_cancellations + no_shows * 3.0) / greatest(1, completed + late_cancellations + no_shows)) as reliability
    from candidates
  )
  select id,
    round((loyalty * 1000 + coalesce(40 / (1 + distance_km / 5), 0)
      + 20 * greatest(0, least(5, rating)) / 5
      + 10 * least(1, ln(1 + completed) / ln(101))
      + 15 * acceptance_rate + 15 * reliability)::numeric, 6),
    jsonb_build_object('loyaltyTier', loyalty, 'distanceKm', distance_km,
      'distanceBasis', 'postcode district centroids', 'rating', rating,
      'completedJobs', completed, 'acceptanceRate', acceptance_rate,
      'reliability', reliability, 'lateCancellations', late_cancellations, 'noShows', no_shows)
  from scores;
$function$;

create function public.system_booking_offer_ranking(p_booking_id uuid)
returns table(provider_id uuid, score numeric, factors jsonb)
language plpgsql security definer set search_path = public
as $function$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  return query select * from public._rank_cleaning_offers(p_booking_id) order by 2 desc, 1;
end;
$function$;

create function public.system_offer_missing_outcodes(p_booking_id uuid)
returns table(outcode text)
language plpgsql security definer set search_path = public
as $function$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  return query with districts as (
    select public._offer_outcode(b.address) as code from public.bookings b where b.id = p_booking_id
    union
    select public._offer_outcode(coalesce(s.home_postcode, profile.postcode))
      from public.providers p join public.profiles profile on profile.id = p.profile_id
      left join public.provider_profile_settings s on s.provider_id = p.id
      where public._cleaning_offer_qualified(p.id, p_booking_id)
  ) select code from districts where code is not null
    and not exists(select 1 from public.offer_geo_outcodes g where g.outcode = code)
    order by code limit 500;
end;
$function$;

-- Reuse the queue interface so all existing checkout, renewal and replacement
-- paths get waves. The SQL predicate is authoritative, not a caller's ID list.
create or replace function public.system_seed_booking_offer_queue(p_booking_id uuid, p_provider_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public
as $function$
declare b public.bookings; settings public.job_offer_settings; total integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  perform public.lock_visit_series(p_booking_id);
  select * into b from public.bookings where id = p_booking_id for update;
  if not found or b.status::text <> 'offered' or b.provider_id is not null then raise exception 'Booking is not awaiting a cleaner'; end if;
  select * into strict settings from public.job_offer_settings where id;
  update public.booking_offers set status = 'expired' where booking_id = b.id and status = 'open';
  delete from public.booking_offer_queue where booking_id = b.id;
  insert into public.booking_offer_runs(booking_id, cadence_minutes, run_id, wave_size, wave_wait_minutes, settings_version)
    values(b.id, settings.second_wave_after_minutes, gen_random_uuid(), settings.first_wave_size, settings.second_wave_after_minutes, settings.version)
    on conflict(booking_id) do update set
      run_id = excluded.run_id, wave_size = excluded.wave_size,
      wave_wait_minutes = excluded.wave_wait_minutes, settings_version = excluded.settings_version,
      cadence_minutes = excluded.cadence_minutes, started_at = clock_timestamp(),
      first_wave_at = null, second_wave_due_at = null, second_wave_at = null, exhausted_at = null;
  insert into public.booking_offer_queue(booking_id, provider_id, queue_position, ranking)
    select b.id, ranked.provider_id, row_number() over(order by ranked.score desc, ranked.provider_id)::integer,
      ranked.factors || jsonb_build_object('score', ranked.score)
    from public._rank_cleaning_offers(b.id) ranked;
  get diagnostics total = row_count;
  return jsonb_build_object('queued', total, 'wave_size', settings.first_wave_size, 'wait_minutes', settings.second_wave_after_minutes);
end;
$function$;

create or replace function public.system_initialize_booking_offer_queue(p_booking_id uuid, p_provider_ids uuid[])
returns boolean language plpgsql security definer set search_path = public
as $function$
declare b public.bookings;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  perform public.lock_visit_series(p_booking_id);
  select * into b from public.bookings where id = p_booking_id for update;
  if not found or b.status::text <> 'offered' or b.provider_id is not null then return false; end if;
  if exists(select 1 from public.booking_offer_runs where booking_id = p_booking_id) then return false; end if;
  perform public.system_seed_booking_offer_queue(p_booking_id, p_provider_ids);
  return true;
end;
$function$;

-- The queue insert and final assignment both retain the shared calendar and
-- vetting guards. Optional customer-submitted times may qualify an offer too.
create or replace function public.filter_professional_offer_queue()
returns trigger language plpgsql security definer set search_path = public
as $function$
begin
  if not public._cleaning_offer_qualified(new.provider_id, new.booking_id) then return null; end if;
  return new;
end;
$function$;

create function public._offer_wave_notice(p_run uuid, p_provider uuid, p_kind text, p_booking uuid)
returns void language plpgsql security definer set search_path = public
as $function$
declare inserted integer;
begin
  insert into public.job_offer_notices(run_id, provider_id, kind) values(p_run, p_provider, p_kind) on conflict do nothing;
  get diagnostics inserted = row_count;
  if inserted = 0 then return; end if;
  if p_kind = 'offered' and exists (
    select 1 from public.provider_profile_settings where provider_id = p_provider and alert_email
  ) then
    insert into public.job_offer_emails(run_id, booking_id, provider_id)
      values(p_run, p_booking, p_provider) on conflict do nothing;
  end if;
  insert into public.notifications(user_id, title, body, href)
    select profile_id,
      case when p_kind = 'taken' then 'This job has been taken' else 'New cleaning job offer' end,
      case when p_kind = 'taken' then 'Another cleaner accepted first. This offer is now closed.'
        else 'A cleaning visit in your coverage area is available. The first cleaner to accept gets the job.' end,
      case when p_kind = 'taken' then '/worker' else '/worker/job/' || p_booking::text end
    from public.providers where id = p_provider and (
      p_kind = 'taken' or not exists (
        select 1 from public.provider_profile_settings where provider_id = p_provider and not alert_app
      )
    );
end;
$function$;

create or replace function public._sync_booking_offer_queue()
returns trigger language plpgsql security definer set search_path = public
as $function$
declare current_run uuid;
begin
  if new.status is distinct from old.status and new.status in ('accepted', 'declined', 'expired', 'lost') then
    update public.booking_offer_queue set outcome = new.status, finished_at = coalesce(finished_at, clock_timestamp())
      where booking_id = new.booking_id and provider_id = new.provider_id and outcome = 'offered';
    select run_id into current_run from public.booking_offer_runs where booking_id = new.booking_id;
    update public.job_offer_deliveries set outcome = new.status, finished_at = coalesce(finished_at, clock_timestamp())
      where run_id = current_run and provider_id = new.provider_id and outcome = 'offered';
    if old.status = 'open' and new.status = 'lost' and current_run is not null and exists (
      select 1 from public.bookings where id = new.booking_id and status::text = 'scheduled' and provider_id <> new.provider_id
    ) then perform public._offer_wave_notice(current_run, new.provider_id, 'taken', new.booking_id); end if;
  end if;
  return new;
end;
$function$;

create function public._advance_cleaning_offer_waves(p_booking uuid)
returns jsonb language plpgsql security definer set search_path = public
as $function$
declare b public.bookings; r public.booking_offer_runs; candidate record;
  opened integer := 0; next_position integer; rank_position integer; wave_number integer; inserted integer;
  deadline timestamptz; stamp timestamptz := clock_timestamp();
begin
  perform public.lock_visit_series(p_booking);
  select * into b from public.bookings where id = p_booking for update;
  if not found then return jsonb_build_object('action', 'missing_booking'); end if;
  if b.status::text <> 'offered' or b.provider_id is not null then return jsonb_build_object('action', 'closed'); end if;
  if exists(select 1 from public.regular_booking_series where id = b.regular_series_id and billing_paused) then
    update public.booking_offers set status = 'expired' where booking_id = b.id and status = 'open';
    return jsonb_build_object('action', 'paused');
  end if;
  select * into r from public.booking_offer_runs where booking_id = b.id for update;
  if not found then return jsonb_build_object('action', 'no_queue'); end if;
  deadline := least(coalesce(b.offer_expires_at, b.scheduled_at - interval '2 hours'), b.scheduled_at - interval '2 hours');
  if deadline <= stamp then
    update public.booking_offers set status = 'expired' where booking_id = b.id and status = 'open';
    return jsonb_build_object('action', 'hard_deadline');
  end if;
  update public.booking_offers set status = 'expired' where booking_id = b.id and status = 'open'
    and not public._cleaning_offer_qualified(provider_id, b.id);
  if r.first_wave_at is null then wave_number := 1;
  elsif r.second_wave_at is null and r.second_wave_due_at <= stamp then wave_number := 2;
  else return jsonb_build_object('action', 'waiting', 'second_wave_due_at', r.second_wave_due_at); end if;

  -- Re-evaluate everyone at release time, including a newly qualified cleaner.
  select coalesce(max(queue_position), 0) into next_position from public.booking_offer_queue where booking_id = b.id;
  for candidate in select * from public._rank_cleaning_offers(b.id) ranked
    where not exists(select 1 from public.job_offer_deliveries d where d.run_id = r.run_id and d.provider_id = ranked.provider_id)
    order by score desc, provider_id
    limit case when wave_number = 1 then greatest(0, r.wave_size - (
      select count(*)::integer from public.booking_offers where booking_id = b.id and status = 'open'
    )) else 2147483647 end
  loop
    if not exists(select 1 from public.booking_offer_queue where booking_id = b.id and provider_id = candidate.provider_id) then
      next_position := next_position + 1;
      insert into public.booking_offer_queue(booking_id, provider_id, queue_position, ranking)
        values(b.id, candidate.provider_id, next_position, candidate.factors || jsonb_build_object('score', candidate.score));
    end if;
    insert into public.booking_offers(booking_id, provider_id, status) values(b.id, candidate.provider_id, 'open')
      on conflict(booking_id, provider_id) do update set status = 'open' where public.booking_offers.status not in ('declined', 'accepted');
    get diagnostics inserted = row_count;
    if inserted = 0 then continue; end if;
    update public.booking_offer_queue set outcome = 'offered', wave = wave_number,
      activated_at = stamp, respond_by = deadline, finished_at = null,
      ranking = candidate.factors || jsonb_build_object('score', candidate.score)
      where booking_id = b.id and provider_id = candidate.provider_id returning queue_position into rank_position;
    insert into public.job_offer_deliveries(run_id, booking_id, provider_id, wave, rank_position, ranking, outcome, offered_at)
      values(r.run_id, b.id, candidate.provider_id, wave_number, rank_position, candidate.factors || jsonb_build_object('score', candidate.score), 'offered', stamp);
    perform public._offer_wave_notice(r.run_id, candidate.provider_id, 'offered', b.id);
    opened := opened + 1;
  end loop;
  if wave_number = 1 then
    update public.booking_offer_runs set first_wave_at = stamp, second_wave_due_at = stamp + make_interval(mins => r.wave_wait_minutes),
      started_at = stamp where booking_id = b.id;
  else
    update public.booking_offer_runs set second_wave_at = stamp, exhausted_at = stamp where booking_id = b.id;
  end if;
  return jsonb_build_object('action', 'wave_opened', 'wave', wave_number, 'opened', opened,
    'second_wave_due_at', coalesce(r.second_wave_due_at, stamp + make_interval(mins => r.wave_wait_minutes)));
end;
$function$;

create or replace function public.system_rotate_booking_offer(p_booking_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $function$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  return public._advance_cleaning_offer_waves(p_booking_id);
end;
$function$;

create or replace function public._refresh_offer_queue_after_reschedule()
returns trigger language plpgsql security definer set search_path = public
as $function$
begin
  if new.status::text = 'offered' and new.provider_id is null then
    update public.booking_offer_queue set respond_by = least(coalesce(new.offer_expires_at, new.scheduled_at - interval '2 hours'), new.scheduled_at - interval '2 hours')
      where booking_id = new.id and outcome = 'offered';
  end if;
  return new;
end;
$function$;

create function public.close_competing_cleaning_offers()
returns trigger language plpgsql security definer set search_path = public
as $function$
begin
  if new.status::text = 'scheduled' and new.provider_id is not null and old.status::text = 'offered' then
    update public.booking_offers set status = 'lost' where booking_id = new.id and provider_id <> new.provider_id and status = 'open';
    update public.booking_offer_queue set outcome = 'lost', finished_at = clock_timestamp()
      where booking_id = new.id and provider_id <> new.provider_id and outcome = 'waiting';
  end if;
  return new;
end;
$function$;
create trigger close_competing_cleaning_offers after update of status, provider_id on public.bookings
  for each row execute function public.close_competing_cleaning_offers();

alter function public.provider_accept_booking_time(uuid, timestamptz) rename to provider_accept_booking_time_before_offer_waves;
create function public.provider_accept_booking_time(p_booking_id uuid, p_selected_slot timestamptz)
returns jsonb language plpgsql security definer set search_path = public
as $function$
declare b public.bookings; provider uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  perform public.lock_visit_series(p_booking_id);
  select * into b from public.bookings where id = p_booking_id for update;
  if not found or b.status::text <> 'offered' or b.provider_id is not null then raise exception 'This job has been taken or is no longer available'; end if;
  select id into provider from public.providers where profile_id = auth.uid();
  perform pg_advisory_xact_lock(hashtextextended('professional-schedule:' || provider::text, 0));
  if not public._cleaning_offer_qualified(provider, b.id, p_selected_slot) then raise exception 'This offer is no longer available for your service, checks or working hours'; end if;
  return public.provider_accept_booking_time_before_offer_waves(p_booking_id, p_selected_slot);
end;
$function$;
revoke all on function public.provider_accept_booking_time_before_offer_waves(uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.provider_accept_booking_time(uuid, timestamptz) from public, anon;
grant execute on function public.provider_accept_booking_time(uuid, timestamptz) to authenticated;

create function public.provider_decline_booking_offer(p_booking_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $function$
declare b public.bookings; v_provider uuid; changed integer;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  perform public.lock_visit_series(p_booking_id);
  select * into b from public.bookings where id = p_booking_id for update;
  if not found or b.status::text <> 'offered' or b.provider_id is not null then return jsonb_build_object('taken', true); end if;
  select id into v_provider from public.providers where profile_id = auth.uid();
  update public.booking_offers set status = 'declined' where booking_id = b.id and provider_id = v_provider and status = 'open';
  get diagnostics changed = row_count;
  return jsonb_build_object('declined', changed = 1);
end;
$function$;
revoke all on function public.provider_decline_booking_offer(uuid) from public, anon;
grant execute on function public.provider_decline_booking_offer(uuid) to authenticated;
revoke update on public.booking_offers from authenticated;

create function public.process_ranked_job_offer_waves(p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path = public
as $function$
declare candidate record; result jsonb; processed integer := 0; opened integer := 0;
  failures jsonb := '[]'::jsonb;
begin
  if auth.role() is distinct from 'service_role' and session_user <> 'postgres' then raise exception 'Service role required'; end if;
  for candidate in select b.id from public.bookings b join public.booking_offer_runs r on r.booking_id = b.id
    where b.status::text = 'offered' and b.provider_id is null
      and b.scheduled_at > clock_timestamp() + interval '2 hours'
      and coalesce(b.offer_expires_at, b.scheduled_at) > clock_timestamp()
      and not exists(select 1 from public.regular_booking_series s where s.id = b.regular_series_id and s.billing_paused)
      and (r.first_wave_at is null or (r.second_wave_at is null and r.second_wave_due_at <= clock_timestamp()))
    order by r.second_wave_due_at nulls first, b.id limit least(greatest(p_limit, 1), 500)
  loop
    begin
      result := public._advance_cleaning_offer_waves(candidate.id);
      processed := processed + 1;
      opened := opened + coalesce((result ->> 'opened')::integer, 0);
    exception when others then
      failures := failures || jsonb_build_array(jsonb_build_object('booking_id', candidate.id, 'error', sqlerrm));
    end;
  end loop;
  result := jsonb_build_object('processed', processed, 'opened', opened, 'errors', failures);
  insert into public.job_offer_wave_runtime(id, last_scheduler_at, result)
    values(true, clock_timestamp(), result)
    on conflict(id) do update set last_scheduler_at = excluded.last_scheduler_at, result = excluded.result;
  return result;
end;
$function$;

revoke all on function public._offer_outcode(text), public._cleaning_offer_qualified(uuid, uuid, timestamptz),
  public._rank_cleaning_offers(uuid), public._offer_wave_notice(uuid, uuid, text, uuid),
  public._advance_cleaning_offer_waves(uuid), public.close_competing_cleaning_offers()
  from public, anon, authenticated, service_role;
revoke all on function public.system_booking_offer_ranking(uuid), public.system_offer_missing_outcodes(uuid), public.process_ranked_job_offer_waves(integer)
  from public, anon, authenticated;
grant execute on function public.system_booking_offer_ranking(uuid), public.system_offer_missing_outcodes(uuid), public.process_ranked_job_offer_waves(integer) to service_role;

alter function public.claim_visit_matching_notices(boolean, boolean, integer, integer)
  rename to claim_visit_matching_notices_before_offer_waves;
create function public.claim_visit_matching_notices(
  p_email_enabled boolean, p_sms_enabled boolean default false,
  p_budget_pence integer default 0, p_cost_pence integer default 0
)
returns table (
  id uuid, claim_token uuid, channel text, recipient text,
  title text, body text, href text, kind text, booking_id uuid, scheduled_at timestamptz
)
language plpgsql security definer set search_path = public
as $function$
declare item record; token uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  return query select * from public.claim_visit_matching_notices_before_offer_waves(
    p_email_enabled, p_sms_enabled, p_budget_pence, p_cost_pence
  );
  update public.job_offer_emails e set status = 'failed', claim_token = null,
    last_error = 'Old or exhausted email submission needs provider reconciliation.'
    where e.status in ('pending', 'processing') and e.attempts > 0
      and (e.claimed_at < now() - interval '23 hours'
        or (e.attempts >= 8 and e.claimed_at < now() - interval '5 minutes'));
  update public.job_offer_emails e set status = 'cancelled', claim_token = null
    where e.status in ('pending', 'processing') and not exists (
      select 1 from public.booking_offers o
      join public.booking_offer_runs r on r.booking_id = o.booking_id and r.run_id = e.run_id
      join public.provider_profile_settings s on s.provider_id = o.provider_id and s.alert_email
      where o.booking_id = e.booking_id and o.provider_id = e.provider_id and o.status = 'open'
        and public._cleaning_offer_qualified(e.provider_id, e.booking_id)
    );
  if not p_email_enabled then return; end if;
  for item in select e.*, profile.email, b.scheduled_at
    from public.job_offer_emails e
    join public.providers p on p.id = e.provider_id
    join public.profiles profile on profile.id = p.profile_id
    join public.bookings b on b.id = e.booking_id
    where e.attempts < 8 and e.next_attempt_at <= now()
      and (e.status = 'pending' or (e.status = 'processing' and e.claimed_at > now() - interval '23 hours'
        and e.claimed_at < now() - interval '5 minutes'))
    order by e.next_attempt_at, e.id limit 20 for update of e skip locked
  loop
    token := gen_random_uuid();
    update public.job_offer_emails e set status = 'processing', claimed_at = now(), claim_token = token,
      attempts = e.attempts + 1 where e.id = item.id;
    id := item.id; claim_token := token; channel := 'email'; recipient := item.email;
    title := 'New cleaning job offer'; kind := 'job_offer';
    body := 'A cleaning visit in your coverage area is available. The first cleaner to accept gets the job.';
    href := '/worker/job/' || item.booking_id::text;
    booking_id := item.booking_id; scheduled_at := item.scheduled_at;
    return next;
  end loop;
end;
$function$;

alter function public.visit_matching_notice_allowed(uuid, uuid) rename to visit_matching_notice_allowed_before_offer_waves;
create function public.visit_matching_notice_allowed(p_id uuid, p_token uuid)
returns boolean language sql stable security definer set search_path = public
as $function$
  select auth.role() = 'service_role' and case when exists(select 1 from public.job_offer_emails where id = p_id) then exists (
    select 1 from public.job_offer_emails e
    join public.booking_offer_runs r on r.booking_id = e.booking_id and r.run_id = e.run_id
    join public.booking_offers o on o.booking_id = e.booking_id and o.provider_id = e.provider_id and o.status = 'open'
    join public.provider_profile_settings s on s.provider_id = e.provider_id and s.alert_email
    where e.id = p_id and e.status = 'processing' and e.claim_token = p_token
      and public._cleaning_offer_qualified(e.provider_id, e.booking_id)
  ) else public.visit_matching_notice_allowed_before_offer_waves(p_id, p_token) end;
$function$;

alter function public.finish_visit_matching_notice(uuid, uuid, text, text) rename to finish_visit_matching_notice_before_offer_waves;
create function public.finish_visit_matching_notice(p_id uuid, p_token uuid, p_reference text, p_error text default null)
returns void language plpgsql security definer set search_path = public
as $function$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  if not exists(select 1 from public.job_offer_emails where id = p_id) then
    perform public.finish_visit_matching_notice_before_offer_waves(p_id, p_token, p_reference, p_error);
    return;
  end if;
  update public.job_offer_emails e set
    status = case when p_error = 'Notice no longer applies.' then 'cancelled'
      when p_reference is not null then 'sent' when e.attempts >= 8 then 'failed' else 'pending' end,
    provider_ref = p_reference, sent_at = case when p_reference is not null then now() end,
    next_attempt_at = now() + interval '5 minutes', claim_token = null, last_error = left(p_error, 250)
    where e.id = p_id and e.claim_token = p_token and e.status = 'processing';
end;
$function$;
revoke all on function public.claim_visit_matching_notices_before_offer_waves(boolean,boolean,integer,integer),
  public.visit_matching_notice_allowed_before_offer_waves(uuid,uuid),
  public.finish_visit_matching_notice_before_offer_waves(uuid,uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function public.claim_visit_matching_notices(boolean,boolean,integer,integer),
  public.visit_matching_notice_allowed(uuid,uuid), public.finish_visit_matching_notice(uuid,uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.claim_visit_matching_notices(boolean,boolean,integer,integer),
  public.visit_matching_notice_allowed(uuid,uuid), public.finish_visit_matching_notice(uuid,uuid,text,text) to service_role;

create table public.job_offer_wave_runtime (
  id boolean primary key default true check(id),
  last_scheduler_at timestamptz not null,
  result jsonb not null
);
alter table public.job_offer_wave_runtime enable row level security;
revoke all on public.job_offer_wave_runtime from public, anon, authenticated;
grant select on public.job_offer_wave_runtime to service_role;

-- A database timer survives web deployments and requires no new credentials.
-- No booking payments, matching warnings, refunds or billing schedules change.
select cron.schedule('opulence-ranked-offer-waves', '* * * * *', 'select public.process_ranked_job_offer_waves(100);');

commit;
