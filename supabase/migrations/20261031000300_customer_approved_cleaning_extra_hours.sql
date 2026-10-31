-- Extra cleaning time uses the existing recoverable add-on payment operation.
-- The only exception to its normal 24-hour rule is a recorded customer approval
-- of the assigned cleaner's offer at the original booked hourly price.
begin;

create table public.cleaning_extra_hours_offers (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  customer_id uuid not null references public.profiles(id),
  provider_id uuid not null references public.providers(id),
  minutes integer not null check (minutes between 30 and 360 and minutes % 30 = 0),
  amount_pence integer not null check (amount_pence > 0),
  rate_pence integer not null check (rate_pence > 0),
  rate_minutes integer not null check (rate_minutes > 0),
  revision integer not null,
  status text not null default 'pending' check (status in (
    'pending', 'withdrawn', 'declined', 'processing', 'paid', 'payment_failed', 'review'
  )),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references public.profiles(id),
  consent_wording text,
  operation_id uuid unique references public.booking_visit_money_operations(id)
);
create unique index one_active_cleaning_extra_hours_offer
  on public.cleaning_extra_hours_offers(booking_id)
  where status in ('pending', 'processing');
alter table public.cleaning_extra_hours_offers enable row level security;
revoke all on public.cleaning_extra_hours_offers from public, anon, authenticated;
grant select on public.cleaning_extra_hours_offers to authenticated, service_role;
create policy cleaning_extra_hours_participants
  on public.cleaning_extra_hours_offers for select to authenticated
  using (
    customer_id = auth.uid() or exists (
      select 1 from public.providers
      where id = provider_id and profile_id = auth.uid()
    )
  );

create function public.offer_cleaning_extra_hours(p_booking uuid, p_minutes integer)
returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  b public.bookings;
  bill public.booking_visit_billing;
  offer public.cleaning_extra_hours_offers;
  rate_pence integer;
  rate_minutes integer;
begin
  if auth.uid() is null or p_minutes not between 30 and 360 or p_minutes % 30 <> 0 then
    raise exception 'Choose extra time in half-hour steps';
  end if;
  perform public.lock_visit_series(p_booking);
  select * into strict b from public.bookings where id = p_booking for update;
  select * into strict bill from public.booking_visit_billing
    where booking_id = p_booking for update;
  if b.status::text not in ('scheduled', 'in_progress')
    or b.customer_id = auth.uid() or not exists (
      select 1 from public.providers
      where id = b.provider_id and profile_id = auth.uid()
    ) or not public.provider_service_approved(b.provider_id, 'cleaning')
  then raise exception 'Only the assigned approved cleaner can offer extra time'; end if;
  if bill.status <> 'paid' or bill.active_operation_id is not null
    or bill.policy_refund_required then
    raise exception 'The original visit payment must be settled first';
  end if;
  if b.duration_minutes + p_minutes > 480 then
    raise exception 'The whole visit, including add-ons, cannot exceed eight hours';
  end if;
  rate_pence := coalesce(
    (b.cleaning_extras->>'bookedRatePence')::integer,
    bill.base_pence
  );
  rate_minutes := coalesce(
    (b.cleaning_extras->>'bookedRateMinutes')::integer,
    (b.cleaning_extras->>'baseMinutes')::integer
  );
  if rate_pence <= 0 or rate_minutes < 120 then
    raise exception 'The booked hourly price is unavailable';
  end if;
  update public.cleaning_extra_hours_offers set status = 'withdrawn'
    where booking_id = b.id and status = 'pending';
  insert into public.cleaning_extra_hours_offers(
    booking_id, customer_id, provider_id, minutes, amount_pence,
    rate_pence, rate_minutes, revision
  ) values (
    b.id, b.customer_id, b.provider_id, p_minutes,
    round(rate_pence::numeric * p_minutes / rate_minutes)::integer,
    rate_pence, rate_minutes, bill.revision
  ) returning * into offer;
  insert into public.notifications(user_id, title, body, href) values (
    b.customer_id, 'Your cleaner has offered extra time',
    'Review the extra time and its price in your visit. Nothing is added or charged unless you approve and pay.',
    '/account/visit/' || b.id
  );
  return to_jsonb(offer);
end;
$fn$;
revoke all on function public.offer_cleaning_extra_hours(uuid,integer) from public, anon;
grant execute on function public.offer_cleaning_extra_hours(uuid,integer) to authenticated;

create function public.decline_cleaning_extra_hours(p_offer uuid)
returns void
language plpgsql security definer set search_path = public
as $fn$
declare
  offer public.cleaning_extra_hours_offers;
begin
  select * into strict offer from public.cleaning_extra_hours_offers where id = p_offer;
  perform public.lock_visit_series(offer.booking_id);
  select * into strict offer from public.cleaning_extra_hours_offers
    where id = p_offer for update;
  if auth.uid() is null or (
    auth.uid() <> offer.customer_id and not exists (
      select 1 from public.providers
      where id = offer.provider_id and profile_id = auth.uid()
    )
  ) then raise exception 'Offer not found'; end if;
  if offer.status in ('declined', 'withdrawn') then return; end if;
  if offer.status <> 'pending' then raise exception 'This offer is already processing'; end if;
  update public.cleaning_extra_hours_offers
    set status = case when auth.uid() = customer_id then 'declined' else 'withdrawn' end
    where id = p_offer;
end;
$fn$;
revoke all on function public.decline_cleaning_extra_hours(uuid) from public, anon;
grant execute on function public.decline_cleaning_extra_hours(uuid) to authenticated;

-- Extend the existing operation checks narrowly. A caller cannot manufacture
-- an exception using a JSON flag: it must match a locked, approved offer.
do $adapter$
declare
  source text;
  marker text;
begin
  source := replace(pg_get_functiondef(
    'public.prepare_visit_money_operation(uuid,uuid,text,integer,jsonb)'::regprocedure
  ), E'\r\n', E'\n');
  marker := '  v_refunds jsonb;';
  if strpos(source, marker) = 0 then raise exception 'Operation declarations changed'; end if;
  source := replace(source, marker, marker || E'\n  extra_offer public.cleaning_extra_hours_offers;\n  is_extra_time boolean := false;');
  marker := '  if p_type not in (';
  if strpos(source, marker) = 0 then raise exception 'Operation type guard changed'; end if;
  source := replace(source, marker, $insert$
  if p_type = 'extras' and p_parameters ? 'extraHoursOffer' then
    select * into strict extra_offer from public.cleaning_extra_hours_offers
      where id = (p_parameters->>'extraHoursOffer')::uuid for update;
    if extra_offer.booking_id <> p_booking or extra_offer.customer_id is distinct from p_actor
      or extra_offer.provider_id is distinct from v_booking.provider_id
      or extra_offer.status <> 'processing' or extra_offer.approved_by is distinct from p_actor
      or extra_offer.revision <> v_bill.revision
      or (p_parameters->>'chargePence')::integer <> extra_offer.amount_pence
      or v_bill.status <> 'paid' or v_bill.policy_refund_required
      or v_booking.status::text not in ('scheduled', 'in_progress')
    then raise exception 'Extra time needs the customer''s current approval'; end if;
    is_extra_time := true;
  end if;
  if p_type not in ($insert$);
  marker := 'if v_booking.status::text not in (''offered'', ''declined'', ''scheduled'') and p_type not in (''late_refund'', ''policy_refund'')';
  if strpos(source, marker) = 0 then raise exception 'Visit state guard changed'; end if;
  source := replace(source, marker, marker || ' and not is_extra_time');
  marker := 'if p_type = ''charge'' or (p_type = ''extras'' and coalesce((p_parameters ->> ''chargePence'')::integer, 0) > 0) then';
  if strpos(source, marker) = 0 then raise exception 'Charge gate changed'; end if;
  source := replace(source, marker, 'if not is_extra_time and (p_type = ''charge'' or (p_type = ''extras'' and coalesce((p_parameters ->> ''chargePence'')::integer, 0) > 0)) then');
  marker := 'if p_type = ''extras'' and v_booking.scheduled_at < now() + interval ''24 hours'' then';
  if strpos(source, marker) = 0 then raise exception 'Add-on notice guard changed'; end if;
  source := replace(source, marker, 'if p_type = ''extras'' and not is_extra_time and v_booking.scheduled_at < now() + interval ''24 hours'' then');
  marker := '''amountPence'', v_bill.base_pence - v_bill.discount_pence';
  if strpos(source, marker) = 0 then raise exception 'Cleaning line guard changed'; end if;
  source := replace(source, marker, marker || ' + case when is_extra_time then extra_offer.amount_pence else 0 end');
  execute source;
end;
$adapter$;

create function public.prepare_cleaning_extra_hours(
  p_offer uuid, p_customer uuid, p_amount integer
)
returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  offer public.cleaning_extra_hours_offers;
  b public.bookings;
  bill public.booking_visit_billing;
  scope jsonb;
  lines jsonb;
  op jsonb;
  reason text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  select * into strict offer from public.cleaning_extra_hours_offers where id = p_offer;
  perform public.lock_visit_series(offer.booking_id);
  select * into strict b from public.bookings where id = offer.booking_id for update;
  select * into strict bill from public.booking_visit_billing where booking_id = b.id for update;
  select * into strict offer from public.cleaning_extra_hours_offers where id = p_offer for update;
  if p_customer is distinct from offer.customer_id or p_customer is distinct from b.customer_id
    or p_amount is distinct from offer.amount_pence
    or b.provider_id is distinct from offer.provider_id
  then raise exception 'Review the current offer and price'; end if;
  if offer.operation_id is not null then
    return jsonb_build_object('operation', offer.operation_id, 'status', offer.status);
  end if;
  if offer.status <> 'pending' or offer.revision <> bill.revision
    or b.status::text not in ('scheduled', 'in_progress')
    or bill.status <> 'paid' or bill.active_operation_id is not null
    or bill.policy_refund_required or b.duration_minutes + offer.minutes > 480
    or not exists(select 1 from public.profiles where id = p_customer and account_deleted_at is null)
    or not public.provider_service_approved(b.provider_id, 'cleaning')
    or (b.status::text = 'scheduled' and exists (
      select 1 from public.regular_booking_series
      where id = b.regular_series_id and billing_paused
    ))
  then raise exception 'The visit changed. Ask your cleaner for a new offer'; end if;
  perform pg_advisory_xact_lock(hashtextextended('professional-schedule:' || b.provider_id, 0));
  update public.cleaning_extra_hours_offers
    set status = 'processing', approved_at = now(), approved_by = p_customer,
      consent_wording = 'Approve ' || offer.minutes || ' extra cleaning minutes and pay £'
        || to_char(offer.amount_pence / 100.0, 'FM999999990.00') || ' now at the original booked hourly price.'
    where id = offer.id;
  select jsonb_agg(case when line->>'id' = 'cleaning' then
    line || jsonb_build_object(
      'amountPence', (line->>'amountPence')::integer + offer.amount_pence,
      'reservedMinutes', (line->>'reservedMinutes')::integer + offer.minutes
    ) else line end order by ordinal)
    into lines from jsonb_array_elements(bill.line_items) with ordinality entry(line, ordinal);
  scope := b.cleaning_extras || jsonb_build_object(
    'baseMinutes', (b.cleaning_extras->>'baseMinutes')::integer + offer.minutes,
    'basePricePence', bill.base_pence + offer.amount_pence,
    'durationMinutes', b.duration_minutes + offer.minutes,
    'grossPence', bill.amount_pence + bill.discount_pence + offer.amount_pence,
    'netPence', bill.amount_pence + offer.amount_pence,
    'lineItems', lines, 'bookedRatePence', offer.rate_pence,
    'bookedRateMinutes', offer.rate_minutes
  );
  op := public.prepare_visit_money_operation(b.id, p_customer, 'extras', bill.revision,
    jsonb_build_object(
      'extraHoursOffer', offer.id, 'scope', scope, 'lines', lines,
      'durationMinutes', b.duration_minutes + offer.minutes,
      'amountPence', bill.amount_pence + offer.amount_pence,
      'chargePence', offer.amount_pence, 'refundPence', 0, 'refunds', '[]'::jsonb,
      'added', jsonb_build_array(jsonb_build_object(
        'id', 'cleaning', 'label', 'Agreed extra cleaning time',
        'amountPence', offer.amount_pence, 'reservedMinutes', offer.minutes
      ))
    )
  );
  -- The existing operation reserves the longer slot before Stripe. Also check
  -- an in-progress job, whose ordinary duration trigger runs only when scheduled.
  reason := public.professional_booking_conflict(b.provider_id, b.id, b.scheduled_at);
  if reason is not null then raise exception '%', reason; end if;
  update public.cleaning_extra_hours_offers set operation_id = (op->>'id')::uuid
    where id = offer.id;
  return jsonb_build_object('operation', op->>'id', 'status', 'processing');
end;
$fn$;
revoke all on function public.prepare_cleaning_extra_hours(uuid,uuid,integer)
  from public, anon, authenticated;
grant execute on function public.prepare_cleaning_extra_hours(uuid,uuid,integer) to service_role;

alter function public.visit_charge_gate(uuid,uuid,text) rename to visit_charge_gate_before_extra_hours;
revoke all on function public.visit_charge_gate_before_extra_hours(uuid,uuid,text)
  from public, anon, authenticated, service_role;
create function public.visit_charge_gate(p_booking uuid,p_operation uuid default null,p_kind text default 'charge')
returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  op public.booking_visit_money_operations;
  b public.bookings;
  bill public.booking_visit_billing;
  allowed boolean;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  if p_operation is not null then
    select * into strict op from public.booking_visit_money_operations
      where id = p_operation and booking_id = p_booking;
    if op.operation_type = 'extras' and op.parameters ? 'extraHoursOffer' then
      perform public.lock_visit_series(p_booking);
      select * into strict b from public.bookings where id = p_booking;
      select * into strict bill from public.booking_visit_billing where booking_id = p_booking;
      allowed := b.status::text in ('scheduled', 'in_progress')
        and b.provider_id is not null and not bill.policy_refund_required
        and b.provider_id = (op.parameters->>'assignedProvider')::uuid
        and b.scheduled_at = (op.parameters->>'scheduledAt')::timestamptz
        and (b.status::text = 'in_progress' or not exists (
          select 1 from public.regular_booking_series
          where id = b.regular_series_id and billing_paused
        )) and exists (
          select 1 from public.cleaning_extra_hours_offers
          where id = (op.parameters->>'extraHoursOffer')::uuid
            and operation_id = op.id and status = 'processing'
            and approved_by = b.customer_id and provider_id = b.provider_id
        );
      return jsonb_build_object('allowed', coalesce(allowed, false),
        'reason', case when coalesce(allowed, false) then null else 'extra_time_visit_changed' end,
        'assigned', b.provider_id is not null, 'paused', false);
    end if;
  end if;
  return public.visit_charge_gate_before_extra_hours(p_booking, p_operation, p_kind);
end;
$fn$;
revoke all on function public.visit_charge_gate(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.visit_charge_gate(uuid,uuid,text) to service_role;

alter function public.finish_visit_money_operation(uuid,text,jsonb,text)
  rename to finish_visit_money_operation_before_extra_hours;
revoke all on function public.finish_visit_money_operation_before_extra_hours(uuid,text,jsonb,text)
  from public, anon, authenticated, service_role;
create function public.finish_visit_money_operation(
  p_operation uuid, p_outcome text, p_results jsonb, p_error text default null
)
returns void
language plpgsql security definer set search_path = public
as $fn$
declare
  offer public.cleaning_extra_hours_offers;
  op public.booking_visit_money_operations;
  blocked boolean;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  select * into strict op from public.booking_visit_money_operations where id = p_operation;
  perform public.lock_visit_series(op.booking_id);
  select * into offer from public.cleaning_extra_hours_offers
    where operation_id = p_operation for update;
  if found and offer.status <> 'processing' then return; end if;
  perform public.finish_visit_money_operation_before_extra_hours(p_operation,p_outcome,p_results,p_error);
  if offer.id is null or p_outcome = 'ambiguous' then return; end if;
  select policy_refund_required into blocked from public.booking_visit_billing
    where booking_id = op.booking_id;
  update public.cleaning_extra_hours_offers set status = case
    when blocked then 'review' when p_outcome = 'succeeded' then 'paid'
    else 'payment_failed' end where id = offer.id;
  if p_outcome = 'succeeded' and not blocked then
    update public.booking_visit_billing set base_pence = base_pence + offer.amount_pence
      where booking_id = op.booking_id;
  elsif blocked then
    update public.bookings set cleaning_extras = op.parameters->'oldScope',
      duration_minutes = (op.parameters->>'oldDuration')::integer,
      household_notes = op.parameters->>'oldNotes' where id = op.booking_id;
  end if;
  insert into public.notifications(user_id,title,body,href) values (
    offer.customer_id,
    case when p_outcome = 'succeeded' and not blocked then 'Extra cleaning time confirmed'
      else 'Extra cleaning time was not added' end,
    case when p_outcome = 'succeeded' and not blocked
      then 'Your approved extra time has been paid and added to this visit.'
      else 'The original paid visit stays recorded. Check the payment status before trying again.' end,
    '/account/visit/' || offer.booking_id
  );
end;
$fn$;
revoke all on function public.finish_visit_money_operation(uuid,text,jsonb,text)
  from public, anon, authenticated;
grant execute on function public.finish_visit_money_operation(uuid,text,jsonb,text) to service_role;

commit;
notify pgrst, 'reload schema';
