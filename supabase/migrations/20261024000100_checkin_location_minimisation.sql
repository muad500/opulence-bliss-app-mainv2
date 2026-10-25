-- Keep the geofence result, distance and time, never precise device coordinates.
-- RPC signatures remain compatible with old deployments; database triggers also
-- protect against an old client/server attempting to persist coordinates.
begin;

alter table public.check_ins add column if not exists distance_metres integer;

create or replace function public.minimise_checkin_location()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  new.gps_lat := null;
  new.gps_lng := null;
  if tg_table_name = 'check_ins' and new.distance_metres is null then
    select c.distance_metres into new.distance_metres
      from public.check_in_challenges c
     where c.booking_id = new.booking_id
       and c.geofence_pass = new.geofence_pass
       and c.created_at <= new.arrived_at
     order by c.created_at desc limit 1;
  end if;
  return new;
end
$fn$;
revoke all on function public.minimise_checkin_location() from public, anon, authenticated;

create trigger minimise_checkin_challenge_location
before insert or update on public.check_in_challenges
for each row execute function public.minimise_checkin_location();
create trigger minimise_checkin_location
before insert or update on public.check_ins
for each row execute function public.minimise_checkin_location();

-- Deliberately delete the previously retained precise coordinates. No coordinate
-- backup is made. Updating check_ins also backfills the non-precise distance.
update public.check_ins set gps_lat = null, gps_lng = null;
update public.check_in_challenges set gps_lat = null, gps_lng = null
 where gps_lat is not null or gps_lng is not null;

create or replace function public.without_device_coordinates(p_value jsonb)
returns jsonb language plpgsql immutable set search_path = public as $fn$
declare v_result jsonb;
begin
  if jsonb_typeof(p_value) = 'object' then
    select coalesce(jsonb_object_agg(k, public.without_device_coordinates(v)), '{}'::jsonb)
      into v_result from jsonb_each(p_value) e(k,v)
     where k not in ('gps_lat','gps_lng','gpsLat','gpsLng');
    return v_result;
  elsif jsonb_typeof(p_value) = 'array' then
    select coalesce(jsonb_agg(public.without_device_coordinates(v) order by n), '[]'::jsonb)
      into v_result from jsonb_array_elements(p_value) with ordinality e(v,n);
    return v_result;
  end if;
  return p_value;
end
$fn$;

-- No other event evidence is changed. The append-only guard is suspended only
-- within this transaction for this narrowly scoped privacy deletion.
alter table public.booking_events disable trigger booking_events_no_update;
update public.booking_events set meta = public.without_device_coordinates(meta)
 where meta is distinct from public.without_device_coordinates(meta);
alter table public.booking_events enable trigger booking_events_no_update;

create or replace function public.minimise_booking_event_location()
returns trigger language plpgsql set search_path = public as $fn$
begin
  new.meta := public.without_device_coordinates(new.meta);
  return new;
end
$fn$;
revoke all on function public.minimise_booking_event_location() from public, anon, authenticated;
create trigger minimise_booking_event_location before insert on public.booking_events
for each row execute function public.minimise_booking_event_location();

-- Enforce the no-access wait on the server, not just in the button.
create or replace function public.report_booking_exception(
  p_booking_id uuid, p_category text, p_reason text, p_notes text default null,
  p_meta jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_uid uuid := auth.uid();
  v_kind text;
  v_case_id uuid;
  v_scheduled timestamptz;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = 'insufficient_privilege'; end if;
  v_kind := public.account_booking_actor(p_booking_id, true);
  if v_kind is null then raise exception 'not your booking' using errcode = 'insufficient_privilege'; end if;
  if p_category = 'worker_no_show' and v_kind <> 'customer' then
    raise exception 'only the customer can report a provider no-show' using errcode = 'insufficient_privilege';
  elsif p_category = 'client_unavailable' then
    if v_kind <> 'provider' then
      raise exception 'only the assigned provider can report no access' using errcode = 'insufficient_privilege';
    end if;
    select scheduled_at into v_scheduled from public.bookings where id = p_booking_id for update;
    if v_scheduled is null or now() < v_scheduled + interval '15 minutes' then
      raise exception 'Wait 15 minutes after the scheduled start before reporting no access.' using errcode = 'check_violation';
    end if;
  elsif p_category <> 'worker_no_show' then
    raise exception 'unsupported exception category' using errcode = 'check_violation';
  end if;
  perform public._apply_booking_transition(p_booking_id, 'needs_review', v_uid, v_kind,
    p_reason, public.without_device_coordinates(coalesce(p_meta, '{}'::jsonb)));
  v_case_id := public.open_review_case(p_booking_id, p_category,
    case when p_category = 'worker_no_show' then 'urgent' else 'high' end,
    true, true, p_notes, null);
  return jsonb_build_object('ok', true, 'case_id', v_case_id);
end
$fn$;
revoke all on function public.report_booking_exception(uuid,text,text,text,jsonb) from public, anon;
grant execute on function public.report_booking_exception(uuid,text,text,text,jsonb) to authenticated;

commit;
