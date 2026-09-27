-- The client's rules for regular cleaning (development checklist items 40-42).
--
-- 40. Prices end in .99, as in the client's replies and booking form. Each
--     package stores the price for its base duration: 120 minutes, or 180 for
--     Signature Deep Clean. One-Time Essential Clean is already 45.98.
-- 41. A regular booking is 6 to 10 visits booked together, weekly, every two
--     weeks or monthly. It was exactly six, weekly or monthly only.
-- 42. Prices stay hidden until booking, so the per-hour notes shown on the
--     services page are removed.

begin;

-- 40. Prices
update public.packages set price = 37.98 where service_type = 'cleaning' and name = 'Essential Clean';
update public.packages set price = 45.98 where service_type = 'cleaning' and name in ('Express Clean', 'Guest Ready');
update public.packages set price = 74.97 where service_type = 'cleaning' and name = 'Signature Deep Clean';
update public.packages set price = 51.98 where service_type = 'cleaning' and name = 'End of Tenancy / Move-In Clean';

-- 42. Remove price notes such as "£18.90 per cleaner-hour"
update public.packages
set good_to_know = array(
  select note from unnest(good_to_know) as note
  where note !~ '£[0-9]'
)
where service_type = 'cleaning'
  and exists (select 1 from unnest(good_to_know) as note where note ~ '£[0-9]');

-- 41. Six to ten visits, including every two weeks
alter table public.bookings drop constraint if exists bookings_booking_frequency_check;
alter table public.bookings add constraint bookings_booking_frequency_check
  check (booking_frequency in ('one_time', 'weekly', 'fortnightly', 'monthly'));

alter table public.regular_booking_series drop constraint if exists regular_booking_series_frequency_check;
alter table public.regular_booking_series add constraint regular_booking_series_frequency_check
  check (frequency in ('weekly', 'fortnightly', 'monthly'));

alter table public.bookings drop constraint if exists bookings_regular_visit_number_check;
alter table public.bookings add constraint bookings_regular_visit_number_check check (
  (regular_series_id is null and regular_visit_number is null)
  or (regular_series_id is not null and regular_visit_number between 1 and 10)
);

-- The regular checkout, copied from 20260925000400 with the visit count, the
-- two-week schedule and the eight-hour cap updated.
create or replace function public.finalize_regular_customer_checkout(
  p_customer_id uuid,
  p_session_id text,
  p_payment_ref text,
  p_package_id uuid,
  p_postcode text,
  p_address text,
  p_request text,
  p_slots timestamptz[],
  p_duration_minutes integer,
  p_frequency text,
  p_preferred_provider_id uuid,
  p_total_pence integer,
  p_platform_pence integer,
  p_amounts integer[],
  p_platforms integer[],
  p_email text
)
returns uuid[]
language plpgsql security definer set search_path = public as $function$
declare
  v_series uuid;
  v_booking uuid;
  v_ids uuid[] := '{}'::uuid[];
  v_anchor timestamp;
  v_month_start date;
  v_expected_date date;
  v_expected timestamp;
  v_package public.packages;
  v_index integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(p_session_id, '') = '' or coalesce(p_payment_ref, '') = ''
     or char_length(btrim(coalesce(p_address, ''))) < 5
     or p_frequency not in ('weekly', 'fortnightly', 'monthly')
     or cardinality(p_slots) not between 6 and 10
     or cardinality(p_amounts) <> cardinality(p_slots)
     or cardinality(p_platforms) <> cardinality(p_slots)
     or p_duration_minutes < 120 or p_duration_minutes > 480
     or mod(p_duration_minutes, 30) <> 0
     or p_total_pence is null or p_total_pence <= 0
     or p_platform_pence is null or p_platform_pence < 0
     or p_platform_pence >= p_total_pence then
    raise exception 'Invalid regular checkout.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_session_id, 0));
  select id into v_series from public.regular_booking_series
   where checkout_session_id = p_session_id
     and customer_id = p_customer_id and stripe_payment_ref = p_payment_ref;
  if found then
    select array_agg(id order by regular_visit_number) into v_ids
      from public.bookings where regular_series_id = v_series;
    return v_ids;
  end if;
  if exists (select 1 from public.regular_booking_series where checkout_session_id = p_session_id or stripe_payment_ref = p_payment_ref) then
    raise exception 'Checkout reference already belongs to a different customer or payment.';
  end if;

  select * into v_package from public.packages
   where id = p_package_id and billing_type = 'per_visit'
     and lower(coalesce(service_type, '')) like '%clean%';
  if not found then raise exception 'Regular Essential Clean is not available.'; end if;

  if p_preferred_provider_id is not null and not exists (
    select 1 from public.bookings b join public.packages pkg on pkg.id = b.package_id
     where b.customer_id = p_customer_id and b.provider_id = p_preferred_provider_id
       and b.status::text = 'completed' and lower(coalesce(pkg.service_type, '')) like '%clean%'
  ) then
    raise exception 'Requested cleaner must come from a completed visit.';
  end if;

  if exists (select 1 from unnest(p_slots) as choice(slot) where slot is null)
     or (select count(distinct slot) from unnest(p_slots) as choice(slot)) <> cardinality(p_slots)
     or p_slots[cardinality(p_slots)] > now() + interval '1 year'
     or (select sum(value) from unnest(p_amounts) as amount(value)) <> p_total_pence
     or (select sum(value) from unnest(p_platforms) as margin(value)) <> p_platform_pence then
    raise exception 'Six to ten distinct, funded visits within one year are required.';
  end if;

  v_anchor := p_slots[1] at time zone 'Europe/London';
  for v_index in 1..cardinality(p_slots) loop
    if p_amounts[v_index] <= 0 or p_platforms[v_index] < 0
       or p_platforms[v_index] >= p_amounts[v_index] then
      raise exception 'Invalid visit payment allocation.';
    end if;
    if p_frequency = 'weekly' then
      v_expected_date := v_anchor::date + 7 * (v_index - 1);
    elsif p_frequency = 'fortnightly' then
      v_expected_date := v_anchor::date + 14 * (v_index - 1);
    else
      v_month_start := (date_trunc('month', v_anchor) + make_interval(months => v_index - 1))::date;
      v_expected_date := v_month_start + least(
        extract(day from v_anchor)::integer,
        extract(day from v_month_start + interval '1 month - 1 day')::integer
      ) - 1;
    end if;
    v_expected := v_expected_date + v_anchor::time;
    if (p_slots[v_index] at time zone 'Europe/London') <> v_expected then
      raise exception 'Visit dates must follow the chosen London schedule.';
    end if;
  end loop;

  insert into public.regular_booking_series(
    customer_id, package_id, checkout_session_id, stripe_payment_ref,
    frequency, total_amount, platform_amount
  ) values (
    p_customer_id, p_package_id, p_session_id, p_payment_ref,
    p_frequency, p_total_pence / 100.0, p_platform_pence / 100.0
  ) returning id into v_series;

  for v_index in 1..cardinality(p_slots) loop
    insert into public.bookings(
      customer_id, provider_id, package_id, scheduled_at, preferred_scheduled_at,
      optional_scheduled_at, status, address, customer_email, household_notes,
      offer_expires_at, duration_minutes, property_size_sqm, booking_frequency,
      preferred_provider_id, checkout_session_id, regular_series_id, regular_visit_number
    ) values (
      p_customer_id, null, p_package_id, p_slots[v_index], p_slots[v_index],
      '{}'::timestamptz[], 'offered', btrim(p_address), p_email, p_request,
      p_slots[v_index] - interval '2 hours', p_duration_minutes, null,
      p_frequency, p_preferred_provider_id,
      case when v_index = 1 then p_session_id else null end,
      v_series, v_index
    ) returning id into v_booking;
    v_ids := array_append(v_ids, v_booking);

    insert into public.payments(
      booking_id, gross_amount, split_breakdown, stripe_payment_ref, status
    ) values (
      v_booking, p_amounts[v_index] / 100.0,
      jsonb_build_object(
        'provider', (p_amounts[v_index] - p_platforms[v_index]) / 100.0,
        'platform_margin', p_platforms[v_index] / 100.0,
        'upfront_series_id', v_series
      ),
      p_payment_ref, 'succeeded'
    );
  end loop;
  insert into public.notifications(user_id, title, body, href)
  values(
    p_customer_id,
    'Six visits booked',
    'Your Essential Clean visits have been paid upfront. See each visit and its professional in My Bookings.',
    '/account'
  );
  return v_ids;
end
$function$;

revoke all on function public.finalize_regular_customer_checkout(
  uuid,text,text,uuid,text,text,text,timestamptz[],integer,text,uuid,integer,integer,integer[],integer[],text
) from public, anon, authenticated;
grant execute on function public.finalize_regular_customer_checkout(
  uuid,text,text,uuid,text,text,text,timestamptz[],integer,text,uuid,integer,integer,integer[],integer[],text
) to service_role;


commit;

notify pgrst, 'reload schema';
