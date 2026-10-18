begin;

-- Append-only versions: editing settings can never rewrite an agreed booking.
create function public.valid_cleaning_billing_terms(p_terms jsonb)
returns boolean language plpgsql immutable set search_path = public
as $function$
declare v_key text; v_value numeric; v_previous integer := 100;
begin
  if jsonb_typeof(p_terms) <> 'object' then return false; end if;
  foreach v_key in array array['cleanerHourlyPence','productsFeePence','tipMinimumPence'] loop
    if coalesce(p_terms ->> v_key, '') !~ '^[0-9]+$' then return false; end if;
    v_value := (p_terms ->> v_key)::numeric;
    if v_value > 10000 or (v_key = 'cleanerHourlyPence' and v_value < 1)
      or (v_key = 'tipMinimumPence' and v_value < 50) then return false; end if;
  end loop;
  foreach v_key in array array['oven','fridge','cupboards','windows','ironing'] loop
    if coalesce(p_terms -> 'addonPrices' ->> v_key, '') !~ '^[0-9]+$'
      or (p_terms -> 'addonPrices' ->> v_key)::numeric > 50000 then return false; end if;
  end loop;
  foreach v_key in array array['full','three_quarter','half','none'] loop
    if coalesce(p_terms -> 'cancellationRefundPercent' ->> v_key, '') !~ '^[0-9]+$' then return false; end if;
    v_value := (p_terms -> 'cancellationRefundPercent' ->> v_key)::numeric;
    if v_value > v_previous then return false; end if;
    v_previous := v_value::integer;
  end loop;
  return true;
end;
$function$;

create table public.cleaning_billing_settings (
  id bigint generated always as identity primary key,
  terms jsonb not null check (public.valid_cleaning_billing_terms(terms)),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
insert into public.cleaning_billing_settings (terms) values ('{"version":"1","cleanerHourlyPence":1500,"addonPrices":{"oven":2000,"fridge":1000,"cupboards":1000,"windows":1500,"ironing":1500},"productsFeePence":500,"tipMinimumPence":300,"cancellationRefundPercent":{"full":100,"three_quarter":75,"half":50,"none":0}}');
alter table public.cleaning_billing_settings enable row level security;
revoke all on public.cleaning_billing_settings from public, anon, authenticated;
grant select, insert on public.cleaning_billing_settings to service_role;
grant usage, select on sequence public.cleaning_billing_settings_id_seq to service_role;

create table public.booking_cleaning_billing_terms (
  booking_id uuid primary key references public.bookings(id),
  terms jsonb not null check (public.valid_cleaning_billing_terms(terms)),
  charge_timing text not null check (charge_timing in ('checkout_then_48h', 'acceptance')),
  created_at timestamptz not null default now()
);
alter table public.booking_cleaning_billing_terms enable row level security;
revoke all on public.booking_cleaning_billing_terms from public, anon, authenticated;
grant select, insert on public.booking_cleaning_billing_terms to service_role;

create function public.immutable_cleaning_terms()
returns trigger language plpgsql set search_path = public
as $function$
begin
  raise exception 'Agreed billing settings are immutable; create a new settings version.';
end;
$function$;
create trigger immutable_cleaning_settings before update or delete on public.cleaning_billing_settings
for each row execute function public.immutable_cleaning_terms();
create trigger immutable_booking_cleaning_terms before update or delete on public.booking_cleaning_billing_terms
for each row execute function public.immutable_cleaning_terms();

create function public.set_cleaning_payment_allocation()
returns trigger language plpgsql security definer set search_path = public
as $function$
declare
  v_terms jsonb;
  v_lines jsonb;
  v_minutes integer;
  v_provider integer;
  v_extras integer;
begin
  if new.kind = 'tip' then return new; end if;
  select terms into v_terms from public.booking_cleaning_billing_terms where booking_id = new.booking_id;
  if not found then return new; end if;
  v_lines := new.split_breakdown -> 'reserved_lines';
  if v_lines is null then
    select line_items into v_lines from public.booking_visit_charges where payment_id = new.id;
  end if;
  if v_lines is null then
    select line_items into v_lines from public.booking_visit_billing where booking_id = new.booking_id;
  end if;
  select coalesce(sum((line ->> 'reservedMinutes')::integer) filter (where line ->> 'id' = 'cleaning'), 0),
    coalesce(sum((line ->> 'amountPence')::integer) filter (where line ->> 'id' <> 'cleaning'), 0)
  into v_minutes, v_extras from jsonb_array_elements(v_lines) line;
  v_provider := round(v_minutes * (v_terms ->> 'cleanerHourlyPence')::numeric / 60);
  new.split_breakdown := coalesce(new.split_breakdown, '{}'::jsonb) || jsonb_build_object(
    'provider', v_provider / 100.0,
    'platform_margin', new.gross_amount - v_provider / 100.0,
    'business_extras', v_extras / 100.0,
    'reserved_base', 0, 'reserved_extras', 0,
    'billing_model', 'per_visit', 'pay_rate_pending', false,
    'cleaner_hourly_pence', (v_terms ->> 'cleanerHourlyPence')::integer,
    'booked_cleaning_minutes', v_minutes,
    'billing_settings_version', v_terms ->> 'version'
  );
  return new;
end;
$function$;
create trigger set_cleaning_payment_allocation
before insert or update of split_breakdown, gross_amount on public.payments
for each row execute function public.set_cleaning_payment_allocation();

-- Only previously held, unconfirmed calculations are released at the decided rate.
-- Previously confirmed allocations and already-transferred money remain untouched.
insert into public.booking_cleaning_billing_terms (booking_id, terms, charge_timing)
select booking_id, '{"version":"1","cleanerHourlyPence":1500,"addonPrices":{"oven":2000,"fridge":1000,"cupboards":1000,"windows":1500,"ironing":1500},"productsFeePence":500,"tipMinimumPence":300,"cancellationRefundPercent":{"full":100,"three_quarter":75,"half":50,"none":0}}'::jsonb || jsonb_build_object('version', 'held-pay-release'), 'checkout_then_48h'
from public.booking_visit_billing where not rate_confirmed;
update public.booking_visit_billing set rate_confirmed = true
where booking_id in (select booking_id from public.booking_cleaning_billing_terms);
update public.payments set split_breakdown = split_breakdown
where coalesce(kind, '') <> 'tip'
  and booking_id in (select booking_id from public.booking_cleaning_billing_terms)
  and not exists (select 1 from public.payouts payout where payout.booking_id = payments.booking_id
    and payout.stripe_transfer_ref is not null);

create or replace function public.copy_checkout_cleaning_extras()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_session text := new.checkout_session_id;
  v_choices jsonb;
  v_choice jsonb;
  v_index integer := coalesce(new.regular_visit_number, 1) - 1;
begin
  if new.cleaning_extras <> '{}'::jsonb then
    raise exception 'Add-ons must be saved through checkout' using errcode = 'check_violation';
  end if;
  if new.regular_series_id is not null then
    select checkout_session_id into v_session
    from public.regular_booking_series
    where id = new.regular_series_id and customer_id = new.customer_id;
  end if;
  select cleaning_extras into v_choices
  from public.booking_checkout_time_choices
  where checkout_session_id = v_session and customer_id = new.customer_id;

  if jsonb_array_length(coalesce(v_choices, '[]'::jsonb)) > 0 then
    v_choice := v_choices -> v_index;
    if v_choice is null
      or jsonb_typeof(v_choice -> 'addons') <> 'array'
      or jsonb_typeof(v_choice -> 'petsAtHome') <> 'boolean'
      or jsonb_typeof(v_choice -> 'bringsProducts') <> 'boolean'
      or (v_choice ->> 'baseMinutes')::integer not between 120 and 480
      or mod((v_choice ->> 'baseMinutes')::integer, 30) <> 0
      or (v_choice ->> 'durationMinutes')::integer < 120
      or (v_choice ->> 'durationMinutes')::integer > 480
      or (v_choice ->> 'durationMinutes')::integer <>
        (v_choice ->> 'baseMinutes')::integer + 60 * jsonb_array_length(v_choice -> 'addons')
    then
      raise exception 'Invalid cleaning add-ons for this visit'
        using errcode = 'check_violation';
    end if;
    new.cleaning_extras := v_choice - 'notes' - 'billingSettings';
    new.duration_minutes := (v_choice ->> 'durationMinutes')::integer;
    new.household_notes := concat_ws(E'\n', new.household_notes, v_choice ->> 'notes');
  end if;
  return new;
end;
$function$;

create function public.snapshot_cleaning_booking_terms()
returns trigger language plpgsql security definer set search_path = public
as $function$
declare v_scope jsonb; v_terms jsonb;
begin
  select choices.cleaning_extras -> (coalesce(booking.regular_visit_number, 1) - 1)
  into v_scope
  from public.bookings booking
  left join public.regular_booking_series series on series.id = booking.regular_series_id
  join public.booking_checkout_time_choices choices
    on choices.checkout_session_id = coalesce(booking.checkout_session_id, series.checkout_session_id)
      and choices.customer_id = booking.customer_id
  where booking.id = new.booking_id;
  v_terms := coalesce(v_scope -> 'billingSettings', '{"version":"1","cleanerHourlyPence":1500,"addonPrices":{"oven":2000,"fridge":1000,"cupboards":1000,"windows":1500,"ironing":1500},"productsFeePence":500,"tipMinimumPence":300,"cancellationRefundPercent":{"full":100,"three_quarter":75,"half":50,"none":0}}'::jsonb);
  if not public.valid_cleaning_billing_terms(v_terms) then raise exception 'Booking settings snapshot is invalid'; end if;
  insert into public.booking_cleaning_billing_terms (booking_id, terms, charge_timing)
  values (new.booking_id, v_terms,
    case when v_scope ->> 'chargeTiming' = 'acceptance' then 'acceptance' else 'checkout_then_48h' end);
  update public.booking_visit_billing set rate_confirmed = true where booking_id = new.booking_id;
  update public.payments set split_breakdown = split_breakdown where booking_id = new.booking_id and coalesce(kind, '') <> 'tip';
  return new;
end;
$function$;
create trigger snapshot_cleaning_booking_terms after insert on public.booking_visit_billing
for each row execute function public.snapshot_cleaning_booking_terms();

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
  v_setup boolean := p_intent like 'seti_%';
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(p_session, '') = '' or coalesce(p_intent, '') = ''
    or coalesce(p_stripe_customer, '') = '' or coalesce(p_method, '') = ''
    or length(btrim(coalesce(p_address, ''))) < 5
    or (v_setup and (p_frequency = 'one_time' or p_first_amount <> 0))
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
    if not v_setup and not exists (select 1 from public.booking_visit_charges
      where booking_id = any(v_ids) and stripe_payment_intent = p_intent)
    then raise exception 'Checkout payment does not match the saved booking'; end if;
    return v_ids;
  end if;
  v_ids := '{}';
  select cleaning_extras into strict v_plan
  from public.booking_checkout_time_choices
  where checkout_session_id = p_session and customer_id = p_customer;
  if jsonb_array_length(v_plan) <> v_count then raise exception 'Visit scope missing'; end if;
  if v_setup and (v_plan -> 0 ->> 'chargeTiming') is distinct from 'acceptance' then
    raise exception 'Regular booking acceptance terms are missing'; end if;
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
    if not v_setup and v_index = 1 and v_amount <> p_first_amount then raise exception 'First visit payment mismatch'; end if;
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
      case when v_index = 1 and not v_setup then p_intent else null end,
      case when v_index = 1 and not v_setup then 'succeeded' else 'created' end
    ) returning id into v_payment;
    insert into public.booking_visit_billing (
      booking_id, customer_id, stripe_customer_id, stripe_payment_method_id,
      card_consent_at, card_consent_version,
      charge_due_at, amount_pence, base_pence, discount_pence, line_items, status
    ) values (
      v_booking, p_customer, p_stripe_customer, p_method,
      v_consent, 'visit-billing-v1',
      case when v_scope ->> 'chargeTiming' = 'acceptance' then 'infinity'::timestamptz
        else p_slots[v_index] - interval '48 hours' end,
      v_amount, v_base, v_discount, v_lines,
      case when v_index = 1 and not v_setup then 'paid' else 'unpaid' end
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


-- Preserve the 48h model for old bookings; new regular visits become due on assignment.
create or replace function public.track_visit_assignment()
returns trigger language plpgsql security definer set search_path = public
as $function$
begin
  if new.provider_id is distinct from old.provider_id then
    update public.booking_visit_billing bill
    set assigned_at = case when new.provider_id is not null then now() else null end,
      late_payment_grace_until = null, late_payment_grace_assignment_at = null,
      charge_due_at = case when exists (select 1 from public.booking_cleaning_billing_terms terms
          where terms.booking_id = new.id and terms.charge_timing = 'acceptance')
        then case when new.provider_id is not null then now() else 'infinity'::timestamptz end
        else bill.charge_due_at end
    where bill.booking_id = new.id;
  end if;
  return new;
end;
$function$;

create or replace function public.sync_visit_billing_schedule()
returns trigger language plpgsql security definer set search_path = public
as $function$
begin
  if new.scheduled_at is distinct from old.scheduled_at then
    update public.booking_visit_billing bill
    set charge_due_at = case when exists (select 1 from public.booking_cleaning_billing_terms terms
        where terms.booking_id = new.id and terms.charge_timing = 'acceptance')
      then case when new.provider_id is null then 'infinity'::timestamptz else coalesce(bill.assigned_at, now()) end
      else new.scheduled_at - interval '48 hours' end,
      updated_at = now()
    where bill.booking_id = new.id and bill.status in ('unpaid', 'failed', 'requires_action');
  end if;
  return new;
end;
$function$;

create or replace function public.prepare_visit_money_operation(
  p_booking uuid, p_actor uuid, p_type text, p_revision integer, p_parameters jsonb
)
returns jsonb
language plpgsql security definer set search_path = public
as $function$
declare
  v_booking public.bookings;
  v_bill public.booking_visit_billing;
  v_operation public.booking_visit_money_operations;
  v_duration integer;
  v_amount integer;
  v_refund_percent integer;
  v_gate jsonb;
  v_refunds jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required' using errcode = 'insufficient_privilege';
  end if;
  perform public.lock_visit_series(p_booking);
  select * into strict v_booking from public.bookings where id = p_booking for update;
  select * into strict v_bill from public.booking_visit_billing where booking_id = p_booking for update;
  if p_type not in ('charge', 'extras', 'cancel', 'unfilled', 'late_refund', 'policy_refund') then raise exception 'Invalid operation'; end if;
  if p_type = 'late_refund' and (p_actor is not null or not v_bill.deadline_missed) then raise exception 'Invalid late payment refund'; end if;
  if p_actor is not null and p_actor is distinct from v_booking.customer_id then
    raise exception 'Not your booking' using errcode = 'insufficient_privilege';
  end if;
  if p_type = 'extras' and p_actor is null then raise exception 'Customer confirmation required'; end if;
  if v_bill.active_operation_id is not null then
    select * into strict v_operation from public.booking_visit_money_operations where id = v_bill.active_operation_id;
    if v_operation.operation_type = p_type and v_operation.revision = p_revision then
      return to_jsonb(v_operation);
    end if;
    raise exception 'A payment change is still processing. Please wait.';
  end if;
  if v_bill.revision <> p_revision then raise exception 'The visit changed. Refresh and review it again.'; end if;
  if v_booking.status::text not in ('offered', 'declined', 'scheduled') and p_type not in ('late_refund', 'policy_refund') then
    raise exception 'This visit has started or closed';
  end if;
  if p_type = 'charge' or (p_type = 'extras' and coalesce((p_parameters ->> 'chargePence')::integer, 0) > 0) then
    v_gate := public.visit_charge_gate(p_booking, null, p_type);
    if not (v_gate ->> 'allowed')::boolean then
      raise exception 'VISIT_CHARGE_BLOCKED: %', v_gate ->> 'reason';
    end if;
  end if;
  if p_type = 'charge' and (p_actor is not null or v_bill.status not in ('unpaid', 'failed', 'requires_action')) then
    raise exception 'This visit is not due for charging';
  end if;
  if p_type = 'policy_refund' and (p_actor is not null or not v_bill.policy_refund_required) then
    raise exception 'No blocked payment needs refunding';
  end if;
  if p_type = 'unfilled' and (p_actor is not null or v_booking.provider_id is not null
    or v_booking.status::text <> 'offered' or v_booking.offer_expires_at > now()
    or not exists (select 1 from unnest(
      array[v_booking.scheduled_at] || coalesce(v_booking.optional_scheduled_at, '{}'::timestamptz[])
    ) slot where slot <= now() + interval '2 hours'))
  then raise exception 'This booking has not expired unmatched'; end if;
  if p_type = 'unfilled' and exists (select 1 from public.regular_booking_series
    where id = v_booking.regular_series_id and billing_paused)
  then raise exception 'This regular series is paused'; end if;
  if p_type = 'extras' and v_booking.scheduled_at < now() + interval '24 hours' then
    raise exception 'Add-on changes need at least 24 hours notice';
  end if;
  if p_type = 'cancel' and p_actor is null and v_bill.status = 'paid' then
    raise exception 'A paid visit cannot be cancelled for payment failure';
  end if;
  select terms -> 'cancellationRefundPercent' into v_refunds
  from public.booking_cleaning_billing_terms where booking_id = p_booking;
  v_refunds := coalesce(v_refunds, '{"full":100,"three_quarter":75,"half":50,"none":0}'::jsonb);
  if p_type in ('cancel', 'unfilled', 'late_refund', 'policy_refund') then
    v_refund_percent := case
      when p_type in ('unfilled', 'late_refund', 'policy_refund') then 100
      when p_actor is null then 0
      when v_booking.scheduled_at <= now() or
        (v_booking.scheduled_at at time zone 'Europe/London')::date = (now() at time zone 'Europe/London')::date then (v_refunds ->> 'none')::integer
      when v_booking.scheduled_at >= now() + interval '48 hours' then (v_refunds ->> 'full')::integer
      when v_booking.scheduled_at >= now() + interval '24 hours' then (v_refunds ->> 'three_quarter')::integer
      else (v_refunds ->> 'half')::integer end;
    if (p_parameters ->> 'refundPercent')::integer is distinct from v_refund_percent then
      raise exception 'The cancellation window changed. Review the updated refund.';
    end if;
  end if;
  insert into public.booking_visit_money_operations (
    booking_id, customer_id, operation_type, revision, idempotency_key, parameters
  ) values (
    p_booking, v_bill.customer_id, p_type, p_revision,
    'visit:' || gen_random_uuid()::text,
    p_parameters || jsonb_build_object(
      'oldScope', v_booking.cleaning_extras, 'oldDuration', v_booking.duration_minutes,
      'oldNotes', v_booking.household_notes, 'oldStatus', v_bill.status,
      'actor', p_actor, 'scheduledAt', v_booking.scheduled_at,
      'assignedProvider', v_booking.provider_id
    )
  ) returning * into v_operation;
  update public.booking_visit_billing set active_operation_id = v_operation.id,
    status = case when p_type = 'charge' then 'charging' when p_type = 'extras' then 'changing' else 'cancelling' end,
    updated_at = now() where booking_id = p_booking;
  perform set_config('opulence.visit_billing_operation', v_operation.id::text, true);
  if p_type = 'extras' then
    v_duration := (p_parameters -> 'scope' ->> 'durationMinutes')::integer;
    select sum((line ->> 'amountPence')::integer) into v_amount
      from jsonb_array_elements(p_parameters -> 'lines') line;
    if v_duration not between 120 and 480 or v_duration % 30 <> 0 or v_amount <= 0
      or (p_parameters ->> 'amountPence')::integer <> v_amount
      or not (p_parameters -> 'lines' @> jsonb_build_array(jsonb_build_object(
        'id', 'cleaning', 'amountPence', v_bill.base_pence - v_bill.discount_pence
      ))) then raise exception 'Invalid visit scope'; end if;
    -- Reserve the longer calendar slot BEFORE taking money. Capacity/window
    -- triggers reject this transaction if the assigned person has a clash.
    update public.bookings set cleaning_extras = p_parameters -> 'scope',
      duration_minutes = v_duration,
      household_notes = btrim(replace(coalesce(v_booking.household_notes, ''),
        coalesce(v_booking.cleaning_extras ->> 'notes', ''), ''))
        || E'\n' || coalesce(p_parameters -> 'scope' ->> 'notes', '')
      where id = p_booking;
  elsif p_type in ('cancel', 'unfilled', 'late_refund') then
    perform public._apply_booking_transition(p_booking, 'cancelled', p_actor,
      case when p_actor is null then 'system' else 'customer' end,
      case when p_type = 'unfilled' then 'No cleaner accepted this visit'
        when p_actor is null then 'Visit unpaid at the 24-hour deadline'
        else 'Customer cancelled this visit' end,
      jsonb_build_object('visit_money_operation', v_operation.id,
        'refund_percent', p_parameters -> 'refundPercent'));
    update public.booking_offers set status = 'expired' where booking_id = p_booking and status = 'open';
    if p_type = 'unfilled' then perform public.record_unmatched_visit(p_booking); end if;
  end if;
  return to_jsonb(v_operation);
end;
$function$;

create or replace function public.maybe_release_visit_payout(p_booking_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_booking public.bookings;
  v_payout public.payouts;
begin
  select * into v_booking from public.bookings
    where id = p_booking_id for update;
  if not found or v_booking.status::text <> 'completed' then
    return jsonb_build_object('released', false, 'reason', 'visit not completed');
  end if;
  select * into v_payout from public.payouts
    where booking_id = p_booking_id and payment_id is null
    order by created_at limit 1 for update;
  if not found or v_payout.status <> 'not_ready' then
    return jsonb_build_object('released', false, 'reason', 'visit payout not awaiting release');
  end if;
  if not exists (
    select 1 from public.payments
    where booking_id = p_booking_id
      and coalesce(kind, 'booking') <> 'tip'
      and (status = 'succeeded' or (status = 'partially_refunded' and exists (
        select 1 from public.booking_visit_charges charge
        where charge.payment_id = payments.id
          and charge.amount_pence - charge.refunded_pence >= round(v_payout.amount * 100)
          and charge.line_items @> '[{"id":"cleaning"}]'::jsonb
          and coalesce((charge.refunded_lines ->> 'cleaning')::integer, 0) = 0
      )))
  ) then
    return jsonb_build_object('released', false, 'reason', 'visit funds not captured');
  end if;
  if exists (
    select 1 from public.review_cases
    where booking_id = p_booking_id and status <> 'resolved'
      and (blocks_payment or blocks_payout)
  ) then
    perform public._apply_payout_transition(v_payout.id, 'held', null, 'system',
      'An open review case blocks this payout', '{}'::jsonb);
    return jsonb_build_object('released', false, 'reason', 'held by review case');
  end if;
  perform public._apply_payout_transition(v_payout.id, 'pending', null, 'system',
    'Completed visit and captured payment', '{}'::jsonb);
  return jsonb_build_object('released', true, 'payout_id', v_payout.id);
end $fn$;
revoke all on function public.maybe_release_visit_payout(uuid) from public, anon, authenticated;
grant execute on function public.maybe_release_visit_payout(uuid) to service_role;

revoke all on function public.valid_cleaning_billing_terms(jsonb), public.immutable_cleaning_terms(),
  public.set_cleaning_payment_allocation(), public.snapshot_cleaning_booking_terms()
from public, anon, authenticated;
grant execute on function public.valid_cleaning_billing_terms(jsonb) to service_role;
commit;
notify pgrst, 'reload schema';
