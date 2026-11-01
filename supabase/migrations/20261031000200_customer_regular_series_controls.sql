-- Customer controls preserve each visit's accepted cancellation policy.
-- Pausing never silently removes an assigned cleaner's confirmed booking.
begin;

alter table public.regular_booking_series
  add column ended_at timestamptz,
  add column customer_control_at timestamptz;

create or replace function public.regular_series_billing_state(p_series uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  series public.regular_booking_series;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles
    where id = auth.uid() and account_deleted_at is null
  ) then raise exception 'Sign in required'; end if;
  select * into series from public.regular_booking_series where id = p_series;
  if not found or (
    auth.uid() is distinct from series.customer_id and not public.is_admin()
  ) then raise exception 'Regular booking not found'; end if;
  return jsonb_build_object(
    'id', series.id, 'paused', series.billing_paused,
    'generation', series.pause_generation, 'reason', series.pause_reason,
    'ended', series.ended_at is not null,
    'processing', (
      select count(*) from public.booking_visit_money_operations op
      join public.bookings b on b.id = op.booking_id
      where b.regular_series_id = series.id
        and op.status in ('prepared', 'running', 'ambiguous')
    ),
    'remaining', (
      select count(*) from public.bookings
      where regular_series_id = series.id and scheduled_at > now()
        and status::text in ('offered', 'declined', 'scheduled')
    )
  );
end;
$fn$;
revoke all on function public.regular_series_billing_state(uuid) from public, anon;
grant execute on function public.regular_series_billing_state(uuid) to authenticated;

create function public.control_regular_series(
  p_series uuid, p_customer uuid, p_action text,
  p_generation integer, p_visits jsonb
)
returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  series public.regular_booking_series;
  visit public.bookings;
  bill public.booking_visit_billing;
  item jsonb;
  op jsonb;
  operations jsonb := '[]'::jsonb;
  total integer;
  first_visit uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required';
  end if;
  if p_action not in ('pause', 'end') or jsonb_typeof(p_visits) <> 'array' then
    raise exception 'Choose pause or end';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('visit-series:' || p_series, 0));
  select * into strict series from public.regular_booking_series
    where id = p_series for update;
  if p_customer is distinct from series.customer_id or not exists (
    select 1 from public.profiles
    where id = p_customer and account_deleted_at is null
  ) then raise exception 'Regular booking not found'; end if;
  if series.ended_at is not null or p_generation is distinct from series.pause_generation then
    raise exception 'This regular booking changed. Refresh and review it again';
  end if;
  -- Lock all future visits before stopping matching or preparing refunds.
  perform 1 from public.bookings where regular_series_id = p_series
    order by id for update;
  select count(*) into total from public.bookings
    where regular_series_id = p_series and scheduled_at > now()
      and status::text in ('offered', 'declined', 'scheduled');
  if total <> jsonb_array_length(p_visits) or total <> (
    select count(distinct value->>'id') from jsonb_array_elements(p_visits)
  ) then raise exception 'The visit list changed. Review it again'; end if;
  update public.regular_booking_series
    set billing_paused = true, pause_generation = pause_generation + 1,
      paused_at = now(), customer_control_at = now(),
      ended_at = case when p_action = 'end' then now() else null end,
      pause_reason = case when p_action = 'end' then 'customer_ended'
        else 'customer_paused' end
    where id = p_series;
  for item in select value from jsonb_array_elements(p_visits) loop
    select * into strict visit from public.bookings
      where id = (item->>'id')::uuid and regular_series_id = p_series
        and customer_id = p_customer and scheduled_at > now()
        and status::text in ('offered', 'declined', 'scheduled') for update;
    select * into strict bill from public.booking_visit_billing
      where booking_id = visit.id for update;
    if visit.scheduled_at is distinct from (item->>'scheduledAt')::timestamptz
      or bill.revision is distinct from (item->>'revision')::integer
      or bill.active_operation_id is not null
      or bill.policy_refund_required or bill.status = 'review'
    then raise exception 'A visit payment changed. Review it again'; end if;
    if (item->>'cancel')::boolean then
      op := public.prepare_visit_money_operation(
        visit.id, p_customer, 'cancel', bill.revision, item->'parameters'
      );
      operations := operations || jsonb_build_array(op->>'id');
    elsif p_action = 'end' or visit.provider_id is not null or exists (
      select 1 from public.booking_visit_charges
      where booking_id = visit.id and amount_pence > refunded_pence
    ) then raise exception 'An accepted or paid visit needs its cancellation preview';
    end if;
    update public.booking_offers set status = 'expired'
      where booking_id = visit.id and status = 'open';
  end loop;
  select id into first_visit from public.bookings
    where regular_series_id = p_series order by regular_visit_number limit 1;
  if first_visit is not null then
    perform public.queue_visit_matching_notice(
      first_visit, p_customer,
      case when p_action = 'end' then 'series_ended' else 'series_paused' end,
      'customer-series-control:' || p_series || ':' || (p_generation + 1),
      case when p_action = 'end' then 'Your regular booking has ended'
        else 'Your regular booking is paused' end,
      'Automatic charges and new offers are stopped. Accepted or paid future visits are cancelled under each visit''s agreed policy. Cancelled visits stay cancelled. Work already started is unaffected.',
      '/account/visit/' || first_visit
    );
  end if;
  return jsonb_build_object('operations', operations, 'paused', true,
    'ended', p_action = 'end');
end;
$fn$;
revoke all on function public.control_regular_series(uuid,uuid,text,integer,jsonb)
  from public, anon, authenticated;
grant execute on function public.control_regular_series(uuid,uuid,text,integer,jsonb)
  to service_role;

alter function public.resume_regular_series(uuid,integer)
  rename to resume_regular_series_before_customer_controls;
revoke all on function public.resume_regular_series_before_customer_controls(uuid,integer)
  from public, anon, authenticated, service_role;
create function public.resume_regular_series(p_series uuid, p_generation integer)
returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  series public.regular_booking_series;
begin
  perform pg_advisory_xact_lock(hashtextextended('visit-series:' || p_series, 0));
  select * into strict series from public.regular_booking_series
    where id = p_series for update;
  if auth.uid() is null or (
    auth.uid() is distinct from series.customer_id and not public.is_admin()
  ) then raise exception 'Regular booking not found'; end if;
  if series.ended_at is not null then
    raise exception 'This regular booking has ended. Make a new booking to restart';
  end if;
  if exists (
    select 1 from public.booking_visit_money_operations op
    join public.bookings b on b.id = op.booking_id
    where b.regular_series_id = p_series
      and op.status in ('prepared', 'running', 'ambiguous')
  ) then raise exception 'A visit payment is still processing'; end if;
  if not exists (
    select 1 from public.bookings where regular_series_id = p_series
      and scheduled_at > now() and status::text in ('offered', 'declined', 'scheduled')
  ) then raise exception 'There are no paused visits left. Please make a new booking'; end if;
  return public.resume_regular_series_before_customer_controls(p_series, p_generation);
end;
$fn$;
revoke all on function public.resume_regular_series(uuid,integer) from public, anon;
grant execute on function public.resume_regular_series(uuid,integer) to authenticated;

commit;
notify pgrst, 'reload schema';
