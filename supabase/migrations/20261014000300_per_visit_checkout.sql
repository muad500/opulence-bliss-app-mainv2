begin;

create or replace function public.finalize_per_visit_checkout(
  p_customer uuid, p_session text, p_intent text, p_package uuid,
  p_address text, p_notes text, p_frequency text, p_slots timestamptz[],
  p_optional timestamptz[], p_preferred_provider uuid,
  p_stripe_customer text, p_method text, p_first_amount integer, p_email text
)
returns uuid[]
language plpgsql security definer set search_path = public
as $function$
declare
  v_plan jsonb;
  v_pkg public.packages;
  v_series uuid;
  v_ids uuid[] := '{}';
  v_booking uuid;
  v_payment uuid;
  v_scope jsonb;
  v_lines jsonb;
  v_base integer;
  v_amount integer;
  v_discount integer;
  v_total integer := 0;
  v_first timestamptz;
  v_anchor timestamp;
  v_expected timestamp;
  v_date date;
  v_month date;
  v_count integer := cardinality(p_slots);
  v_index integer;
  v_consent timestamptz;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(p_session, '') = '' or coalesce(p_intent, '') = ''
    or coalesce(p_stripe_customer, '') = '' or coalesce(p_method, '') = ''
    or length(btrim(coalesce(p_address, ''))) < 5
    or p_frequency not in ('one_time', 'weekly', 'fortnightly', 'monthly')
    or v_count is null or (v_count <> 1 and v_count not between 6 and 10)
    or (p_frequency = 'one_time') <> (v_count = 1)
  then raise exception 'Invalid visit checkout'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_session, 0));
  select array_agg(b.id order by coalesce(b.regular_visit_number, 1)) into v_ids
  from public.bookings b
  left join public.regular_booking_series series on series.id = b.regular_series_id
  where b.customer_id = p_customer
    and (b.checkout_session_id = p_session or series.checkout_session_id = p_session);
  if cardinality(v_ids) > 0 then
    if not exists (select 1 from public.booking_visit_charges
      where booking_id = any(v_ids) and stripe_payment_intent = p_intent)
    then raise exception 'Checkout payment does not match the saved booking'; end if;
    return v_ids;
  end if;
  v_ids := '{}';
  select cleaning_extras into strict v_plan
  from public.booking_checkout_time_choices
  where checkout_session_id = p_session and customer_id = p_customer;
  if jsonb_array_length(v_plan) <> v_count then raise exception 'Visit scope missing'; end if;
  v_consent := (v_plan -> 0 ->> 'cardConsentAt')::timestamptz;
  if v_consent is null or v_plan -> 0 ->> 'cardConsentVersion' <> 'visit-billing-v1' then
    raise exception 'Saved card consent is missing';
  end if;
  select * into strict v_pkg from public.packages
  where id = p_package and billing_type = 'per_visit'
    and lower(coalesce(service_type, '')) like '%clean%';
  if (v_pkg.name = 'Essential Clean') <> (v_count > 1) then
    raise exception 'The package does not match this frequency';
  end if;
  if exists (select 1 from public.profiles where id = p_customer
    and (role::text = 'admin' or account_deleted_at is not null))
  then raise exception 'Customer account unavailable'; end if;
  if exists (select 1 from unnest(p_slots) slot where slot is null)
    or (select count(distinct slot) from unnest(p_slots) slot) <> v_count
    or p_slots[v_count] > now() + interval '1 year'
  then raise exception 'Invalid visit dates'; end if;
  v_anchor := p_slots[1] at time zone 'Europe/London';
  for v_index in 1..v_count loop
    v_scope := v_plan -> (v_index - 1);
    v_amount := (v_scope ->> 'netPence')::integer;
    v_base := (v_scope ->> 'basePricePence')::integer;
    v_discount := coalesce((v_scope ->> 'discountPence')::integer, 0);
    v_lines := v_scope -> 'lineItems';
    if v_amount is null or v_amount <= 0 or v_base <= 0 or v_discount < 0
      or jsonb_typeof(v_lines) <> 'array'
      or (select sum((line ->> 'amountPence')::integer) from jsonb_array_elements(v_lines) line) <> v_amount
    then raise exception 'Invalid visit amount or line items'; end if;
    if v_index = 1 and v_amount <> p_first_amount then raise exception 'First visit payment mismatch'; end if;
    if v_count > 1 then
      if p_frequency = 'weekly' then
        v_date := v_anchor::date + 7 * (v_index - 1);
      elsif p_frequency = 'fortnightly' then
        v_date := v_anchor::date + 14 * (v_index - 1);
      else
        v_month := (date_trunc('month', v_anchor) + make_interval(months => v_index - 1))::date;
        v_date := v_month + least(extract(day from v_anchor)::integer,
          extract(day from v_month + interval '1 month - 1 day')::integer) - 1;
      end if;
      v_expected := v_date + v_anchor::time;
      if (p_slots[v_index] at time zone 'Europe/London') <> v_expected then raise exception 'Visit dates do not follow this schedule'; end if;
    end if;
    v_total := v_total + v_amount;
  end loop;
  if v_count > 1 then
    insert into public.regular_booking_series
      (customer_id, package_id, checkout_session_id, stripe_payment_ref, frequency, total_amount, platform_amount)
    values (p_customer, p_package, p_session, p_intent, p_frequency, v_total / 100.0, 0)
    returning id into v_series;
  end if;

  for v_index in 1..v_count loop
    v_scope := v_plan -> (v_index - 1);
    v_amount := (v_scope ->> 'netPence')::integer;
    v_base := (v_scope ->> 'basePricePence')::integer;
    v_discount := coalesce((v_scope ->> 'discountPence')::integer, 0);
    v_lines := v_scope -> 'lineItems';
    v_first := p_slots[v_index];
    if v_count = 1 then
      select min(slot) into v_first from (
        select p_slots[1] as slot union all select unnest(coalesce(p_optional, '{}'))
      ) choices;
    end if;
    insert into public.bookings (
      customer_id, provider_id, package_id, scheduled_at, preferred_scheduled_at,
      optional_scheduled_at, status, address, customer_email, household_notes,
      offer_expires_at, duration_minutes, booking_frequency, preferred_provider_id,
      checkout_session_id, regular_series_id, regular_visit_number
    ) values (
      p_customer, null, p_package, p_slots[v_index], p_slots[v_index],
      case when v_count = 1 then coalesce(p_optional, '{}') else '{}'::timestamptz[] end,
      'offered', btrim(p_address), p_email, p_notes, v_first - interval '2 hours',
      (v_scope ->> 'durationMinutes')::integer, p_frequency, p_preferred_provider,
      case when v_index = 1 then p_session else null end, v_series,
      case when v_series is not null then v_index else null end
    ) returning id into v_booking;
    insert into public.payments (booking_id, gross_amount, split_breakdown, stripe_payment_ref, status)
    values (
      v_booking, v_amount / 100.0,
      jsonb_build_object('provider', 0, 'platform_margin', 0,
        'reserved_base', (v_base - v_discount) / 100.0,
        'reserved_extras', (v_amount - v_base + v_discount) / 100.0,
        'billing_model', 'per_visit', 'pay_rate_pending', true)
        || case when v_series is null then '{}'::jsonb else jsonb_build_object('upfront_series_id', v_series) end,
      case when v_index = 1 then p_intent else null end,
      case when v_index = 1 then 'succeeded' else 'created' end
    ) returning id into v_payment;
    insert into public.booking_visit_billing (
      booking_id, customer_id, stripe_customer_id, stripe_payment_method_id,
      card_consent_at, card_consent_version,
      charge_due_at, amount_pence, base_pence, discount_pence, line_items, status
    ) values (
      v_booking, p_customer, p_stripe_customer, p_method,
      v_consent, 'visit-billing-v1', p_slots[v_index] - interval '48 hours',
      v_amount, v_base, v_discount, v_lines,
      case when v_index = 1 then 'paid' else 'unpaid' end
    );
    if v_index = 1 then
      insert into public.booking_visit_charges
        (booking_id, stripe_payment_intent, amount_pence, line_items, payment_id)
      values (v_booking, p_intent, v_amount, v_lines, v_payment);
    end if;
    v_ids := array_append(v_ids, v_booking);
  end loop;
  return v_ids;
end;
$function$;
revoke all on function public.finalize_per_visit_checkout(
  uuid, text, text, uuid, text, text, text, timestamptz[], timestamptz[], uuid, text, text, integer, text
) from public, anon, authenticated;
grant execute on function public.finalize_per_visit_checkout(
  uuid, text, text, uuid, text, text, text, timestamptz[], timestamptz[], uuid, text, text, integer, text
) to service_role;

create or replace function public.per_visit_checkout_ready()
returns boolean language sql security definer set search_path = public
as $function$
  select to_regclass('public.booking_visit_billing') is not null
    and to_regclass('public.booking_visit_money_operations') is not null
    and to_regprocedure('public.finalize_per_visit_checkout(uuid,text,text,uuid,text,text,text,timestamptz[],timestamptz[],uuid,text,text,integer,text)') is not null;
$function$;
revoke all on function public.per_visit_checkout_ready() from public, anon, authenticated;
grant execute on function public.per_visit_checkout_ready() to service_role;

commit;
notify pgrst, 'reload schema';
