begin;

create table public.cleaner_rate_retention_events (
  id bigint generated always as identity primary key,
  provider_id uuid not null references public.providers(id),
  action text not null check (action in ('retain', 'release')),
  hourly_pence integer check (hourly_pence in (1500, 1525, 1550)),
  notice_received_on date,
  absence_started_on date,
  notice_reference text not null check (length(btrim(notice_reference)) between 8 and 500),
  recorded_by uuid not null references public.profiles(id),
  effective_at timestamptz not null default clock_timestamp(),
  check (action = 'release' or (
    hourly_pence is not null and notice_received_on is not null
    and absence_started_on is not null and notice_received_on <= absence_started_on
  ))
);
create index cleaner_rate_retention_history
  on public.cleaner_rate_retention_events(provider_id, effective_at desc, id desc);
alter table public.cleaner_rate_retention_events enable row level security;
revoke all on public.cleaner_rate_retention_events from public, anon, authenticated, service_role;
grant select on public.cleaner_rate_retention_events to authenticated, service_role;
create policy "Authenticator admins read approved absence pay decisions"
  on public.cleaner_rate_retention_events for select to authenticated
  using (public.is_admin());
create trigger cleaner_rate_retention_immutable
before update or delete on public.cleaner_rate_retention_events
for each row execute function public.booking_events_immutable();

create function public.set_cleaner_rate_retention(
  p_provider uuid, p_retain boolean, p_notice_received date,
  p_absence_started date, p_reference text
)
returns integer language plpgsql security definer set search_path = public as $function$
declare
  experience public.cleaner_experience_clocks;
  earned integer;
begin
  if not public.is_admin() then
    raise exception 'Authenticator staff sign-in required' using errcode = 'insufficient_privilege';
  end if;
  if p_retain is null or length(btrim(coalesce(p_reference, ''))) not between 8 and 500 then
    raise exception 'Record the written notice reference or the reason for ending this exception';
  end if;
  perform 1 from public.providers where id = p_provider for update;
  if not found then raise exception 'Professional not found'; end if;
  select * into experience from public.cleaner_experience_clocks where provider_id = p_provider;
  if p_retain then
    if experience.provider_id is null then
      raise exception 'A completed cleaning job is required before retaining an earned rate';
    end if;
    if p_notice_received is null or p_absence_started is null
      or p_notice_received > current_date or p_notice_received > p_absence_started
      or p_absence_started < (experience.last_completed_at at time zone 'Europe/London')::date
    then raise exception 'Record written notice received before the absence began'; end if;
    earned := public.standard_cleaner_experience_rate(
      1500, experience.started_at, experience.last_completed_at, experience.last_completed_at
    );
  end if;
  insert into public.cleaner_rate_retention_events (
    provider_id, action, hourly_pence, notice_received_on,
    absence_started_on, notice_reference, recorded_by
  ) values (
    p_provider, case when p_retain then 'retain' else 'release' end,
    earned, case when p_retain then p_notice_received end,
    case when p_retain then p_absence_started end, btrim(p_reference), auth.uid()
  );
  return earned;
end;
$function$;
revoke all on function public.set_cleaner_rate_retention(uuid, boolean, date, date, text)
  from public, anon, service_role;
grant execute on function public.set_cleaner_rate_retention(uuid, boolean, date, date, text)
  to authenticated;

-- Evaluate the policy at booking creation, not later acceptance. Ending an
-- exception cannot lower a rate promised by an existing, unassigned booking.
create function public.retained_cleaner_rate_for_booking(
  p_provider uuid, p_booking_created timestamptz, p_base integer
)
returns integer language sql stable security definer set search_path = public as $function$
  select case when p_base <> 1500 then p_base else coalesce((
    select case when action = 'retain' then hourly_pence else p_base end
    from public.cleaner_rate_retention_events
    where provider_id = p_provider and effective_at <= p_booking_created
    order by effective_at desc, id desc limit 1
  ), p_base) end;
$function$;
revoke all on function public.retained_cleaner_rate_for_booking(uuid, timestamptz, integer)
  from public, anon, authenticated, service_role;

-- Preserve the existing-booking lock, deep-clean rate and immutable snapshots.
do $patch$
declare source text; expected text;
begin
  select pg_get_functiondef('public.snapshot_assigned_cleaner_pay()'::regprocedure) into source;
  source := replace(source, E'\r\n', E'\n');
  expected := E'else public.standard_cleaner_experience_rate(\n          v_base, v_clock.started_at, v_clock.last_completed_at, now()\n        )';
  if strpos(source, expected) = 0 then
    raise exception 'The agreed cleaner-pay snapshot changed; review before installation';
  end if;
  execute replace(source, expected,
    E'else greatest(\n          public.retained_cleaner_rate_for_booking(new.provider_id, new.created_at, v_base),\n          public.standard_cleaner_experience_rate(v_base, v_clock.started_at, v_clock.last_completed_at, now())\n        )');
end;
$patch$;

commit;
