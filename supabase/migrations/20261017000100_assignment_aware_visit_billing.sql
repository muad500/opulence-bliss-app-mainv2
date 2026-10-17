begin;

alter table public.regular_booking_series
  add column billing_paused boolean not null default false,
  add column pause_generation integer not null default 0,
  add column paused_at timestamptz,
  add column resumed_at timestamptz,
  add column pause_reason text;

alter table public.bookings add column unmatched_at timestamptz;
alter table public.booking_visit_billing
  add column assigned_at timestamptz,
  add column policy_refund_required boolean not null default false,
  add column blocked_charge_operation uuid;

update public.booking_visit_billing bill
set assigned_at = now()
from public.bookings booking
where booking.id = bill.booking_id and booking.provider_id is not null;

update public.bookings booking
set unmatched_at = operation.created_at
from public.booking_visit_money_operations operation
where operation.booking_id = booking.id
  and operation.operation_type = 'unfilled'
  and booking.status::text = 'cancelled';

alter table public.booking_visit_money_operations
  drop constraint booking_visit_money_operations_operation_type_check;
alter table public.booking_visit_money_operations
  add constraint booking_visit_money_operations_operation_type_check
  check (operation_type in (
    'charge', 'extras', 'cancel', 'unfilled', 'late_refund', 'policy_refund'
  ));

-- This outbox also keeps cancellation and pause emails deliverable after the
-- booking has closed. Existing booking reminders retain their current rules.
create table public.visit_matching_notices (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id),
  series_id uuid references public.regular_booking_series(id),
  series_generation integer not null default 0,
  user_id uuid not null references public.profiles(id),
  event_key text not null,
  kind text not null check (kind in (
    'admin_48h', 'customer_24h', 'unmatched_cancelled',
    'series_paused', 'series_resumed', 'payment_reconciled'
  )),
  channel text not null check (channel in ('in_app', 'email', 'sms')),
  title text not null,
  body text not null,
  href text not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  attempts integer not null default 0,
  claim_token uuid,
  claimed_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  expires_at timestamptz not null,
  provider_ref text,
  sms_cost_cap_pence integer,
  sms_budget_month date,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (user_id, event_key, channel)
);
create index visit_matching_notices_due
  on public.visit_matching_notices (next_attempt_at)
  where status in ('pending', 'processing');
alter table public.visit_matching_notices enable row level security;
revoke all on public.visit_matching_notices from public, anon, authenticated;
grant select, update on public.visit_matching_notices to service_role;

create or replace function public.lock_visit_series(p_booking uuid)
returns void
language plpgsql security definer set search_path = public
as $function$
declare v_series uuid;
begin
  select regular_series_id into v_series from public.bookings where id = p_booking;
  perform pg_advisory_xact_lock(hashtextextended(
    'visit-series:' || coalesce(v_series, p_booking)::text, 0
  ));
end;
$function$;
revoke all on function public.lock_visit_series(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.queue_visit_matching_notice(
  p_booking uuid, p_user uuid, p_kind text, p_key text,
  p_title text, p_body text, p_href text
)
returns void
language plpgsql security definer set search_path = public
as $function$
declare
  v_series uuid;
  v_id uuid;
  v_channel text;
  v_generation integer := 0;
  v_channels text[] := array['in_app', 'email'];
begin
  select regular_series_id into v_series from public.bookings where id = p_booking;
  if v_series is not null then
    select pause_generation into v_generation from public.regular_booking_series where id = v_series;
  end if;
  if p_kind = 'unmatched_cancelled' and exists (
    select 1 from public.account_profile_details
    where user_id = p_user and contact_sms
  ) then
    v_channels := array_append(v_channels, 'sms');
  end if;
  foreach v_channel in array v_channels loop
    v_id := null;
    insert into public.visit_matching_notices (
      booking_id, series_id, series_generation, user_id, event_key, kind, channel,
      title, body, href, expires_at
    ) values (
      p_booking, v_series, v_generation, p_user, p_key, p_kind, v_channel,
      p_title, p_body, p_href,
      now() + case when v_channel = 'sms' then interval '24 hours' else interval '7 days' end
    ) on conflict (user_id, event_key, channel) do nothing
    returning id into v_id;
    if v_id is not null and v_channel = 'in_app' then
      insert into public.notifications (user_id, title, body, href)
      values (p_user, p_title, p_body, p_href);
      update public.visit_matching_notices
      set status = 'sent', sent_at = now() where id = v_id;
    end if;
  end loop;
end;
$function$;
revoke all on function public.queue_visit_matching_notice(uuid,uuid,text,text,text,text,text)
  from public, anon, authenticated, service_role;

create or replace function public.record_unmatched_visit(p_booking uuid)
returns void
language plpgsql security definer set search_path = public
as $function$
declare
  v_booking public.bookings;
  v_series public.regular_booking_series;
  v_recipient uuid;
begin
  perform public.lock_visit_series(p_booking);
  update public.bookings set unmatched_at = coalesce(unmatched_at, now())
  where id = p_booking returning * into strict v_booking;
  if v_booking.regular_series_id is null then return; end if;
  select * into strict v_series from public.regular_booking_series
  where id = v_booking.regular_series_id for update;
  if v_series.billing_paused or not exists (
    select 1 from public.bookings first_visit
    join public.bookings next_visit
      on next_visit.regular_series_id = first_visit.regular_series_id
      and next_visit.regular_visit_number = first_visit.regular_visit_number + 1
    where first_visit.regular_series_id = v_series.id
      and first_visit.unmatched_at is not null and next_visit.unmatched_at is not null
      and first_visit.unmatched_at > coalesce(v_series.resumed_at, '-infinity')
      and next_visit.unmatched_at > coalesce(v_series.resumed_at, '-infinity')
  ) then return; end if;

  update public.regular_booking_series
  set billing_paused = true, paused_at = now(),
    pause_generation = pause_generation + 1,
    pause_reason = 'Two consecutive visits had no cleaner'
  where id = v_series.id returning * into v_series;
  perform public.queue_visit_matching_notice(
    p_booking, v_booking.customer_id, 'series_paused',
    'series-paused:' || v_series.id || ':' || v_series.pause_generation,
    'Your regular visits are paused',
    'We could not find a cleaner for two visits in a row. Your remaining visits are paused and no further automatic payments will be taken. You or our team can explicitly resume the series when you are ready.',
    '/account/visit/' || p_booking
  );
  for v_recipient in select id from public.profiles where role::text = 'admin' loop
    perform public.queue_visit_matching_notice(
      p_booking, v_recipient, 'series_paused',
      'series-paused:' || v_series.id || ':' || v_series.pause_generation,
      'Regular series paused: two unmatched visits',
      'Two consecutive visits had no cleaner. Remaining visits, automatic charges and retries are paused. Review matching and explicitly resume the series.',
      '/admin/bookings'
    );
  end loop;
end;
$function$;
revoke all on function public.record_unmatched_visit(uuid)
  from public, anon, authenticated, service_role;

-- Called afresh before preparation, creation, confirmation and recovery. A
-- completed Stripe effect is reconciled even when a new charge is forbidden.
create or replace function public.visit_charge_gate(
  p_booking uuid, p_operation uuid default null, p_kind text default 'charge'
)
returns jsonb
language plpgsql security definer set search_path = public
as $function$
declare
  v_booking public.bookings;
  v_bill public.booking_visit_billing;
  v_op public.booking_visit_money_operations;
  v_paused boolean := false;
  v_reason text;
  v_kind text := p_kind;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required' using errcode = 'insufficient_privilege';
  end if;
  perform public.lock_visit_series(p_booking);
  select * into strict v_booking from public.bookings where id = p_booking;
  select * into strict v_bill from public.booking_visit_billing where booking_id = p_booking;
  if v_booking.regular_series_id is not null then
    select billing_paused into v_paused from public.regular_booking_series
    where id = v_booking.regular_series_id;
  end if;
  if p_operation is not null then
    select * into strict v_op from public.booking_visit_money_operations
    where id = p_operation and booking_id = p_booking;
    v_kind := v_op.operation_type;
  end if;
  if v_paused then v_reason := 'series_paused';
  elsif v_booking.status::text not in ('offered', 'scheduled', 'declined') then
    v_reason := 'visit_closed';
  elsif v_bill.policy_refund_required then v_reason := 'reconciliation_required';
  elsif v_kind = 'charge' then
    if v_booking.provider_id is null or v_booking.status::text <> 'scheduled' then
      v_reason := 'cleaner_unassigned';
    elsif v_bill.charge_due_at > now() then v_reason := 'not_due';
    elsif v_booking.scheduled_at <= now() + interval '2 hours' then
      v_reason := 'matching_deadline';
    elsif p_operation is not null and
      (v_op.parameters ->> 'assignedProvider')::uuid is distinct from v_booking.provider_id then
      v_reason := 'assignment_changed';
    elsif v_booking.scheduled_at <= now() + interval '24 hours' and (
      v_bill.attempts > 0 or (p_operation is not null
        and v_op.created_at < v_booking.scheduled_at - interval '24 hours')
    ) then v_reason := 'payment_deadline';
    end if;
  end if;
  return jsonb_build_object(
    'allowed', v_reason is null, 'reason', v_reason,
    'assigned', v_booking.provider_id is not null, 'paused', coalesce(v_paused, false)
  );
end;
$function$;
revoke all on function public.visit_charge_gate(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.visit_charge_gate(uuid,uuid,text) to service_role;

create or replace function public.track_visit_assignment()
returns trigger
language plpgsql security definer set search_path = public
as $function$
begin
  if new.provider_id is distinct from old.provider_id then
    update public.booking_visit_billing
    set assigned_at = case when new.provider_id is not null then now() else null end
    where booking_id = new.id;
  end if;
  return new;
end;
$function$;
create trigger track_visit_assignment after update of provider_id on public.bookings
for each row execute function public.track_visit_assignment();
revoke all on function public.track_visit_assignment() from public, anon, authenticated, service_role;

create or replace function public.guard_paused_series_assignment()
returns trigger
language plpgsql security definer set search_path = public
as $function$
begin
  if new.regular_series_id is not null and new.provider_id is not null
    and (new.provider_id is distinct from old.provider_id
      or (new.status::text = 'scheduled' and old.status::text <> 'scheduled'))
    and exists (select 1 from public.regular_booking_series
      where id = new.regular_series_id and billing_paused)
  then raise exception 'This regular series is paused. The customer or admin must resume it first.'; end if;
  return new;
end;
$function$;
create trigger guard_paused_series_assignment
before update of provider_id, status on public.bookings
for each row execute function public.guard_paused_series_assignment();
revoke all on function public.guard_paused_series_assignment() from public, anon, authenticated, service_role;

create or replace function public.queue_due_visit_matching_notices()
returns void
language plpgsql security definer set search_path = public
as $function$
declare
  v_candidate record;
  v_booking record;
  v_admin uuid;
  v_key text;
  v_time text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  for v_candidate in
    select booking.*, coalesce(series.pause_generation, 0) as generation
    from public.bookings booking
    join public.booking_visit_billing bill on bill.booking_id = booking.id
    left join public.regular_booking_series series on series.id = booking.regular_series_id
    where booking.status::text = 'offered' and booking.provider_id is null
      and booking.scheduled_at <= now() + interval '48 hours'
      and booking.scheduled_at > now() + interval '2 hours'
      and not coalesce(series.billing_paused, false)
    order by booking.scheduled_at limit 100
  loop
    perform public.lock_visit_series(v_candidate.id);
    -- The cursor may have been selected before acceptance or a series pause.
    -- Re-read under the same series lock used by those actions.
    select booking.*, coalesce(series.pause_generation, 0) as generation
    into v_booking
    from public.bookings booking
    left join public.regular_booking_series series on series.id = booking.regular_series_id
    where booking.id = v_candidate.id
      and booking.status::text = 'offered' and booking.provider_id is null
      and booking.scheduled_at <= now() + interval '48 hours'
      and booking.scheduled_at > now() + interval '2 hours'
      and not coalesce(series.billing_paused, false);
    if not found then continue; end if;
    v_key := v_booking.id || ':' || v_booking.scheduled_at || ':' || v_booking.generation;
    v_time := to_char(v_booking.scheduled_at at time zone 'Europe/London', 'DD Mon YYYY, HH24:MI') || ' (London time)';
    for v_admin in select id from public.profiles where role::text = 'admin' loop
      perform public.queue_visit_matching_notice(
        v_booking.id, v_admin, 'admin_48h', 'matching-48h:' || v_key,
        'Cleaner needed for an upcoming visit',
        'No cleaner is assigned for the visit on ' || v_time || '. Please review matching. Unassigned later regular visits will not be charged.',
        '/admin/bookings'
      );
    end loop;
    if v_booking.scheduled_at <= now() + interval '24 hours' then
      perform public.queue_visit_matching_notice(
        v_booking.id, v_booking.customer_id, 'customer_24h', 'matching-24h:' || v_key,
        'We''re still finding a cleaner for your visit',
        'We''re still finding a cleaner for your visit on ' || v_time || '. We will let you know when a cleaner accepts. If no cleaner accepts by two hours before the visit, we will cancel that visit and refund anything already paid for it.',
        '/account/visit/' || v_booking.id
      );
    end if;
  end loop;
end;
$function$;
revoke all on function public.queue_due_visit_matching_notices() from public, anon, authenticated;
grant execute on function public.queue_due_visit_matching_notices() to service_role;

create or replace function public.claim_visit_matching_notices(
  p_email_enabled boolean, p_sms_enabled boolean default false,
  p_budget_pence integer default 0, p_cost_pence integer default 0
)
returns table (
  id uuid, claim_token uuid, channel text, recipient text,
  title text, body text, href text, kind text, booking_id uuid, scheduled_at timestamptz
)
language plpgsql security definer set search_path = public
as $function$
declare
  item record;
  v_token uuid;
  v_month date := date_trunc('month', now() at time zone 'Europe/London')::date;
  v_spent bigint := 0;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  if p_sms_enabled then
    if p_budget_pence <= 0 or p_budget_pence > 1000000
      or p_cost_pence <= 0 or p_cost_pence > p_budget_pence
    then raise exception 'SMS budget required'; end if;
    perform pg_advisory_xact_lock(hashtextextended('booking-sms-budget:' || v_month::text, 0));
    select coalesce(sum(cost), 0) into v_spent from (
      select sms_cost_cap_pence as cost from public.booking_notification_deliveries where sms_budget_month = v_month
      union all select sms_cost_cap_pence from public.visit_matching_notices where sms_budget_month = v_month
    ) spent;
  end if;
  update public.visit_matching_notices notice
  set status = 'failed', last_error = 'SMS submission uncertain; manual review required.', claim_token = null
  where notice.channel = 'sms' and notice.status = 'processing'
    and notice.claimed_at < now() - interval '10 minutes';
  update public.visit_matching_notices notice
  set status = 'failed', last_error = 'Old email submission needs provider reconciliation.', claim_token = null
  where notice.channel = 'email' and notice.status in ('pending', 'processing')
    and notice.attempts > 0 and notice.claimed_at < now() - interval '23 hours';
  update public.visit_matching_notices notice
  set status = 'cancelled', claim_token = null
  where notice.status in ('pending', 'processing') and (
    notice.expires_at <= now() or (notice.kind in ('admin_48h', 'customer_24h') and not exists (
      select 1 from public.bookings booking
      left join public.regular_booking_series series on series.id = booking.regular_series_id
      where booking.id = notice.booking_id and booking.status::text = 'offered'
        and booking.provider_id is null and booking.scheduled_at > now() + interval '2 hours'
        and not coalesce(series.billing_paused, false)
        and notice.series_generation = coalesce(series.pause_generation, 0)
    ))
  );
  for item in
    select notice.*, profile.email, profile.phone, booking.scheduled_at
    from public.visit_matching_notices notice
    join public.profiles profile on profile.id = notice.user_id
    join public.bookings booking on booking.id = notice.booking_id
    left join public.account_profile_details preferences on preferences.user_id = notice.user_id
    where notice.attempts < 8 and notice.next_attempt_at <= now()
      and (notice.status = 'pending' or (notice.channel = 'email'
        and notice.status = 'processing' and notice.claimed_at < now() - interval '5 minutes'))
      and ((notice.channel = 'email' and p_email_enabled)
        or (notice.channel = 'sms' and p_sms_enabled and coalesce(preferences.contact_sms, false)
          and profile.phone ~ '^\+44[0-9]{10}$'))
    order by notice.created_at, notice.id limit 20 for update of notice skip locked
  loop
    if item.channel = 'sms' then
      if v_spent + p_cost_pence > p_budget_pence then continue; end if;
      v_spent := v_spent + p_cost_pence;
    end if;
    v_token := gen_random_uuid();
    update public.visit_matching_notices notice
    set status = 'processing', claimed_at = now(), claim_token = v_token,
      attempts = attempts + 1,
      sms_budget_month = case when item.channel = 'sms' then v_month else null end,
      sms_cost_cap_pence = case when item.channel = 'sms' then p_cost_pence else null end
    where notice.id = item.id;
    id := item.id; claim_token := v_token; channel := item.channel;
    recipient := case when item.channel = 'email' then item.email else item.phone end;
    title := item.title; body := item.body; href := item.href; kind := item.kind;
    booking_id := item.booking_id; scheduled_at := item.scheduled_at;
    return next;
  end loop;
end;
$function$;
revoke all on function public.claim_visit_matching_notices(boolean,boolean,integer,integer) from public, anon, authenticated;
grant execute on function public.claim_visit_matching_notices(boolean,boolean,integer,integer) to service_role;

create or replace function public.finish_visit_matching_notice(
  p_id uuid, p_token uuid, p_reference text, p_error text default null
)
returns void
language plpgsql security definer set search_path = public
as $function$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  update public.visit_matching_notices notice
  set status = case when p_error = 'Notice no longer applies.' then 'cancelled'
      when p_reference is not null then 'sent'
      when notice.channel = 'sms' or notice.attempts >= 8 then 'failed' else 'pending' end,
    provider_ref = p_reference,
    sent_at = case when p_reference is not null then now() else null end,
    next_attempt_at = now() + interval '5 minutes',
    claim_token = null, last_error = left(p_error, 250)
  where notice.id = p_id and notice.claim_token = p_token and notice.status = 'processing';
end;
$function$;
revoke all on function public.finish_visit_matching_notice(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.finish_visit_matching_notice(uuid,uuid,text,text) to service_role;

create or replace function public.regular_series_billing_state(p_series uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $function$
declare v_series public.regular_booking_series;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles where id = auth.uid() and account_deleted_at is null
  ) then raise exception 'Sign in required' using errcode = 'insufficient_privilege'; end if;
  select * into v_series from public.regular_booking_series where id = p_series;
  if not found or (auth.uid() is distinct from v_series.customer_id and not public.is_admin()) then
    raise exception 'Series not found' using errcode = 'insufficient_privilege';
  end if;
  return jsonb_build_object('id', v_series.id, 'paused', v_series.billing_paused,
    'generation', v_series.pause_generation, 'pausedAt', v_series.paused_at,
    'reason', v_series.pause_reason);
end;
$function$;
revoke all on function public.regular_series_billing_state(uuid) from public, anon;
grant execute on function public.regular_series_billing_state(uuid) to authenticated;

create or replace function public.resume_regular_series(p_series uuid, p_generation integer)
returns jsonb
language plpgsql security definer set search_path = public
as $function$
declare v_series public.regular_booking_series; v_booking uuid; v_admin uuid;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles where id = auth.uid() and account_deleted_at is null
  ) then raise exception 'Sign in required' using errcode = 'insufficient_privilege'; end if;
  perform pg_advisory_xact_lock(hashtextextended('visit-series:' || p_series::text, 0));
  select * into v_series from public.regular_booking_series where id = p_series for update;
  if not found or (auth.uid() is distinct from v_series.customer_id and not public.is_admin()) then
    raise exception 'Series not found' using errcode = 'insufficient_privilege';
  end if;
  if not v_series.billing_paused then return jsonb_build_object('paused', false); end if;
  if p_generation is distinct from v_series.pause_generation then
    raise exception 'This series changed. Refresh before resuming.';
  end if;
  update public.regular_booking_series
  set billing_paused = false, resumed_at = now(), pause_reason = null where id = p_series;
  select id into v_booking from public.bookings where regular_series_id = p_series
    order by regular_visit_number limit 1;
  perform public.queue_visit_matching_notice(
    v_booking, v_series.customer_id, 'series_resumed',
    'series-resumed:' || p_series || ':' || p_generation,
    'Your regular visits have resumed',
    'Matching has resumed for your remaining visits. Unassigned later visits will not be charged. Once a cleaner accepts, payment is taken 48 hours before the visit, or immediately if it is closer.',
    '/account/visit/' || v_booking
  );
  for v_admin in select id from public.profiles where role::text = 'admin' loop
    perform public.queue_visit_matching_notice(
      v_booking, v_admin, 'series_resumed', 'series-resumed:' || p_series || ':' || p_generation,
      'Regular series resumed', 'The customer or an administrator explicitly resumed this series. Assignment is still required before later-visit charges.', '/admin/bookings'
    );
  end loop;
  return jsonb_build_object('paused', false);
end;
$function$;
revoke all on function public.resume_regular_series(uuid,integer) from public, anon;
grant execute on function public.resume_regular_series(uuid,integer) to authenticated;

-- Replace operations atomically with the assignment/pause protocol.
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
  if p_type in ('cancel', 'unfilled', 'late_refund', 'policy_refund') then
    v_refund_percent := case
      when p_type in ('unfilled', 'late_refund', 'policy_refund') then 100
      when p_actor is null then 0
      when v_booking.scheduled_at <= now() or
        (v_booking.scheduled_at at time zone 'Europe/London')::date = (now() at time zone 'Europe/London')::date then 0
      when v_booking.scheduled_at >= now() + interval '48 hours' then 100
      when v_booking.scheduled_at >= now() + interval '24 hours' then 75
      else 50 end;
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


create or replace function public.finish_visit_money_operation(
  p_operation uuid, p_outcome text, p_results jsonb, p_error text default null
)
returns void
language plpgsql security definer set search_path = public
as $function$
declare
  v_op public.booking_visit_money_operations;
  v_bill public.booking_visit_billing;
  v_booking public.bookings;
  v_result jsonb;
  v_charge public.booking_visit_charges;
  v_payment uuid;
  v_previous text;
  v_next text;
  v_net integer;
  v_series uuid;
  v_count integer;
  v_gate jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  if p_outcome not in ('succeeded', 'failed', 'ambiguous', 'blocked') then raise exception 'Invalid outcome'; end if;
  select booking_id into strict v_series from public.booking_visit_money_operations where id = p_operation;
  perform public.lock_visit_series(v_series);
  select * into strict v_booking from public.bookings where id = v_series for update;
  select * into strict v_bill from public.booking_visit_billing where booking_id = v_series for update;
  select * into strict v_op from public.booking_visit_money_operations where id = p_operation for update;
  if v_op.status in ('succeeded', 'failed') then return; end if;
  if v_bill.active_operation_id is distinct from p_operation then raise exception 'Operation no longer owns this visit'; end if;
  if p_outcome = 'ambiguous' then
    update public.booking_visit_money_operations set status = 'ambiguous', stripe_objects = p_results,
      lease_until = null, error = p_error where id = p_operation;
    return;
  end if;
  perform set_config('opulence.visit_billing_operation', p_operation::text, true);
  -- Failed card payments are recorded too; an ambiguous Stripe outcome MUST
  -- stay active until reconciliation, never become a new charge attempt.
  for v_result in select value from jsonb_array_elements(p_results) loop
    if v_result ->> 'type' = 'charge' and v_result ->> 'status' = 'succeeded' then
      if (v_result ->> 'amountPence')::integer <= 0 then raise exception 'Invalid charge'; end if;
      if v_op.operation_type = 'charge' then
        select id, status into v_payment, v_previous from public.payments
          where booking_id = v_bill.booking_id and stripe_payment_ref is null
            and coalesce(kind, '') <> 'tip' order by created_at limit 1 for update;
      else v_payment := null; v_previous := null; end if;
      if v_payment is null then
        insert into public.payments (booking_id, stripe_payment_ref, gross_amount, status, split_breakdown)
        values (v_bill.booking_id, v_result ->> 'id', (v_result ->> 'amountPence')::integer / 100.0,
          'succeeded', jsonb_build_object('provider', 0, 'platform_margin', 0,
            'billing_model', 'per_visit', 'pay_rate_pending', true,
            'reserved_lines', v_result -> 'lines')) returning id into v_payment;
        insert into public.payment_events (payment_id, to_status, actor_kind, reason, meta)
        values (v_payment, 'succeeded', 'system', 'Per-visit charge confirmed', jsonb_build_object('operation', p_operation));
      else
        update public.payments set stripe_payment_ref = v_result ->> 'id',
          gross_amount = (v_result ->> 'amountPence')::integer / 100.0,
          status = 'succeeded', status_changed_at = now(),
          split_breakdown = jsonb_build_object('provider', 0, 'platform_margin', 0,
            'billing_model', 'per_visit', 'pay_rate_pending', true, 'reserved_lines', v_result -> 'lines')
          where id = v_payment;
        insert into public.payment_events (payment_id, from_status, to_status, actor_kind, reason, meta)
        values (v_payment, v_previous, 'succeeded', 'system', 'Per-visit charge confirmed', jsonb_build_object('operation', p_operation));
      end if;
      insert into public.booking_visit_charges (booking_id, stripe_payment_intent, amount_pence, line_items, operation_id, payment_id)
      values (v_bill.booking_id, v_result ->> 'id', (v_result ->> 'amountPence')::integer,
        v_result -> 'lines', p_operation, v_payment) on conflict (stripe_payment_intent) do nothing;
    elsif v_result ->> 'type' = 'refund' then
      select * into strict v_charge from public.booking_visit_charges where id = (v_result ->> 'chargeId')::uuid for update;
      update public.booking_visit_charges set refunded_pence = refunded_pence + (v_result ->> 'amountPence')::integer,
        refunded_lines = coalesce(v_result -> 'refundedLines', refunded_lines) where id = v_charge.id;
      v_next := case when v_charge.refunded_pence + (v_result ->> 'amountPence')::integer = v_charge.amount_pence then 'refunded' else 'partially_refunded' end;
      select status into v_previous from public.payments where id = v_charge.payment_id;
      update public.payments set status = v_next, status_changed_at = now() where id = v_charge.payment_id;
      insert into public.payment_events (payment_id, from_status, to_status, actor_kind, reason, meta)
      values (v_charge.payment_id, v_previous, v_next, 'system', 'Visit refund confirmed',
        jsonb_build_object('operation', p_operation, 'stripe_refund', v_result ->> 'id', 'amount_pence', v_result -> 'amountPence'));
    end if;
  end loop;
  if p_outcome in ('failed', 'blocked') and v_op.operation_type = 'extras' then
    update public.bookings set cleaning_extras = v_op.parameters -> 'oldScope',
      duration_minutes = (v_op.parameters ->> 'oldDuration')::integer,
      household_notes = v_op.parameters ->> 'oldNotes' where id = v_bill.booking_id;
  end if;
  if p_outcome = 'succeeded' and v_op.operation_type in ('charge', 'extras')
    and exists (select 1 from jsonb_array_elements(p_results) result
      where result ->> 'type' = 'charge' and result ->> 'status' = 'succeeded') then
    v_gate := public.visit_charge_gate(v_booking.id, v_op.id, v_op.operation_type);
  end if;
  update public.booking_visit_money_operations
  set status = case when p_outcome = 'blocked' then 'failed' else p_outcome end,
    stripe_objects = p_results,
    lease_until = null, completed_at = now(), error = p_error where id = p_operation;
  update public.booking_visit_billing set active_operation_id = null,
    policy_refund_required = case
      when v_op.operation_type = 'policy_refund' and p_outcome = 'succeeded' then false
      when v_gate is not null and not (v_gate ->> 'allowed')::boolean then true
      else policy_refund_required end,
    blocked_charge_operation = case
      when v_op.operation_type = 'policy_refund' and p_outcome = 'succeeded' then null
      when v_gate is not null and not (v_gate ->> 'allowed')::boolean then v_op.id
      else blocked_charge_operation end,
    status = case
      when p_outcome = 'blocked' then
        case when v_booking.status::text = 'cancelled' then 'cancelled'
          when v_op.operation_type = 'extras' then v_op.parameters ->> 'oldStatus'
          else 'unpaid' end
      when v_gate is not null and not (v_gate ->> 'allowed')::boolean then 'review'
      when v_op.operation_type = 'policy_refund' then
        case when v_booking.status::text = 'cancelled' then 'cancelled' else 'unpaid' end
      when v_op.operation_type in ('cancel', 'unfilled', 'late_refund') then 'cancelled'
      when p_outcome = 'failed' and v_bill.deadline_missed then 'cancelled'
      when p_outcome = 'failed' and v_op.operation_type = 'charge' then 'failed'
      when p_outcome = 'failed' then v_op.parameters ->> 'oldStatus'
      when v_op.operation_type = 'charge' then 'paid'
      else v_op.parameters ->> 'oldStatus' end,
    amount_pence = case when p_outcome = 'succeeded' and v_op.operation_type = 'extras'
      then (v_op.parameters ->> 'amountPence')::integer else amount_pence end,
    line_items = case when p_outcome = 'succeeded' and v_op.operation_type = 'extras'
      then v_op.parameters -> 'lines' else line_items end,
    revision = revision + 1,
    attempts = attempts + case when v_op.operation_type = 'charge' and p_outcome <> 'blocked' then 1 else 0 end,
    retry_after = case when p_outcome = 'failed' and v_op.operation_type = 'charge' then now() + interval '6 hours' else null end,
    last_error = p_error, updated_at = now() where booking_id = v_bill.booking_id;
  if v_op.operation_type in ('cancel', 'unfilled', 'late_refund') then
    if v_op.operation_type = 'unfilled' then
      perform public.queue_visit_matching_notice(
        v_bill.booking_id, v_bill.customer_id, 'unmatched_cancelled',
        'unmatched:' || v_bill.booking_id, 'We couldn''t match your booking',
        case when jsonb_array_length(coalesce(v_op.parameters -> 'refunds', '[]'::jsonb)) > 0
          then 'No cleaner accepted this visit by the two-hour deadline, so it has been cancelled. Your payment for this visit has been refunded in full.'
          else 'No cleaner accepted this visit by the two-hour deadline, so it has been cancelled. No payment was taken for this visit.' end,
        '/account/visit/' || v_bill.booking_id
      );
    else
    insert into public.notifications (user_id, title, body, href) values (
      v_bill.customer_id,
      case when v_op.operation_type = 'unfilled' then 'We couldn''t match your booking' else 'Visit cancelled' end,
      case when v_op.operation_type = 'unfilled' then 'No cleaner accepted this visit. Any payment for it has been refunded in full.'
        when v_op.parameters ->> 'actor' is null then 'This visit was still unpaid 24 hours before its start and has been cancelled. Please update your saved card.'
        else 'Your visit has been cancelled and its payment adjustment has been confirmed.' end,
      '/account/visit/' || v_bill.booking_id::text);
    end if;
    if v_booking.provider_id is not null then
      insert into public.notifications (user_id, title, body, href)
      select profile_id, 'Visit cancelled', 'This visit has been removed from your schedule.', '/worker'
      from public.providers where id = v_booking.provider_id;
    end if;
    v_series := v_booking.regular_series_id;
    if v_op.parameters ->> 'actor' is not null and v_series is not null
      and exists (select 1 from public.bookings where regular_series_id = v_series and regular_visit_number = 1 and status::text = 'completed')
      and not exists (select 1 from public.bookings where regular_series_id = v_series and regular_visit_number > 1 and status::text <> 'cancelled')
    then
      insert into public.regular_series_cancellation_flags (customer_id, cancelled_after_first, series_ids)
      values (v_bill.customer_id, 1, array[v_series])
      on conflict (customer_id) do update set
        cancelled_after_first = regular_series_cancellation_flags.cancelled_after_first + 1,
        series_ids = array_append(regular_series_cancellation_flags.series_ids, v_series), updated_at = now()
      where not v_series = any(regular_series_cancellation_flags.series_ids)
      returning cancelled_after_first into v_count;
      if v_count >= 2 then
        insert into public.notifications (user_id, title, body, href)
        select id, 'Regular series cancellation pattern', 'A customer has cancelled two regular series after their first completed visit. Please review; their rate is unchanged.', '/admin/customers/' || v_bill.customer_id::text
        from public.profiles where role::text = 'admin';
      end if;
    end if;
  elsif p_outcome = 'failed' and v_op.operation_type = 'charge' then
    insert into public.notifications (user_id, title, body, href) values (v_bill.customer_id,
      'Update your saved card', 'Your visit payment failed. Update your saved card in Payments. We will retry; if still unpaid 24 hours before the visit, it will be cancelled.', '/account/settings/payments');
  end if;
end;
$function$;


create or replace function public.guard_visit_billing_booking_changes()
returns trigger language plpgsql security definer set search_path = public
as $function$
declare v_bill public.booking_visit_billing; v_owned boolean;
begin
  select * into v_bill from public.booking_visit_billing where booking_id = old.id for update;
  if not found then return new; end if;
  v_owned := v_bill.active_operation_id is not null and
    current_setting('opulence.visit_billing_operation', true) = v_bill.active_operation_id::text;
  if new.package_id is distinct from old.package_id then raise exception 'To change your package, cancel this visit and rebook.'; end if;
  if new.status::text = 'cancelled' and old.status::text <> 'cancelled' and not coalesce(v_owned, false) then
    raise exception 'Use the visit cancellation form so its payment is adjusted.';
  end if;
  if new.scheduled_at is distinct from old.scheduled_at then
    if old.scheduled_at < now() + interval '24 hours' then raise exception 'Date changes need at least 24 hours notice'; end if;
    if new.scheduled_at < now() + interval '24 hours' and v_bill.status <> 'paid' then raise exception 'An unpaid visit needs at least 24 hours notice'; end if;
  end if;
  if (new.scheduled_at is distinct from old.scheduled_at or new.status is distinct from old.status)
    and v_bill.active_operation_id is not null and not coalesce(v_owned, false)
  then raise exception 'A payment change is still processing. Please wait.'; end if;
  if new.status::text = 'in_progress' and v_bill.status <> 'paid'
    and new.scheduled_at <= now() + interval '24 hours'
  then raise exception 'This visit must be paid before work can proceed'; end if;
  return new;
end;
$function$;


create or replace function public.mark_visit_payment_deadline(p_booking uuid)
returns void language plpgsql security definer set search_path = public
as $function$
declare v_book public.bookings; v_bill public.booking_visit_billing; v_op public.booking_visit_money_operations;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  perform public.lock_visit_series(p_booking);
  select * into strict v_book from public.bookings where id = p_booking for update;
  select * into strict v_bill from public.booking_visit_billing where booking_id = p_booking for update;
  if v_book.scheduled_at > now() + interval '24 hours' or v_bill.status = 'paid'
    or v_bill.deadline_missed or v_book.provider_id is null
    or exists (select 1 from public.regular_booking_series where id = v_book.regular_series_id and billing_paused)
  then return; end if;
  if v_bill.active_operation_id is not null then
    select * into v_op from public.booking_visit_money_operations where id = v_bill.active_operation_id;
    if v_bill.attempts = 0 and v_op.created_at >= v_book.scheduled_at - interval '24 hours' then return; end if;
  end if;
  if v_bill.active_operation_id is null then return; end if;
  perform set_config('opulence.visit_billing_operation', v_bill.active_operation_id::text, true);
  perform public.system_transition_booking(p_booking, 'cancelled', 'Unpaid at the 24-hour deadline; delayed payment reconciliation pending');
  update public.booking_visit_billing set deadline_missed = true where booking_id = p_booking;
  update public.booking_offers set status = 'expired' where booking_id = p_booking and status = 'open';
  insert into public.notifications (user_id, title, body, href) values (v_bill.customer_id,
    'Visit cancelled', 'Your visit was still unpaid at the 24-hour deadline. A delayed payment will be refunded; please update your card.', '/account/visit/' || p_booking::text);
  insert into public.notifications (user_id, title, body, href)
  select profile_id, 'Visit cancelled', 'This unpaid visit has been removed from your schedule.', '/worker'
  from public.providers where id = v_book.provider_id;
end;
$function$;


create or replace function public.provider_accept_booking_time(
  p_booking_id uuid,
  p_selected_slot timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_uid uuid := auth.uid();
  v_provider public.providers;
  v_booking public.bookings;
  v_preference text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  select * into v_provider
    from public.providers
   where profile_id = v_uid;
  if not found or v_provider.vetting_status <> 'approved' or v_provider.is_suspended then
    raise exception 'provider account is not available to accept bookings'
      using errcode = 'insufficient_privilege';
  end if;

  perform public.lock_visit_series(p_booking_id);
  select * into v_booking
    from public.bookings
   where id = p_booking_id
   for update;
  if not found or v_booking.status::text <> 'offered' or v_booking.provider_id is not null then
    raise exception 'this booking is no longer available';
  end if;

  if not exists (
    select 1 from public.booking_offers offer
     where offer.booking_id = p_booking_id
       and offer.provider_id = v_provider.id
       and offer.status = 'open'
  ) then
    raise exception 'there is no open offer for this booking'
      using errcode = 'insufficient_privilege';
  end if;

  if p_selected_slot = coalesce(v_booking.preferred_scheduled_at, v_booking.scheduled_at) then
    v_preference := 'preferred';
  elsif p_selected_slot = any(v_booking.optional_scheduled_at) then
    v_preference := 'optional';
  else
    raise exception 'choose one of the customer submitted times'
      using errcode = 'check_violation';
  end if;

  if p_selected_slot <= now() + interval '2 hours' then
    raise exception 'the matching deadline for that booking has passed'
      using errcode = 'check_violation';
  end if;

  update public.bookings
     set scheduled_at = p_selected_slot
   where id = p_booking_id;

  return public._apply_booking_transition(
    p_booking_id,
    'scheduled',
    v_uid,
    'provider',
    null,
    jsonb_build_object(
      'selected_slot', p_selected_slot,
      'selected_preference', v_preference
    )
  );
end
$function$;

create or replace function public.due_assigned_visit_payments(
  p_limit integer default 50, p_bookings uuid[] default null
)
returns table (booking_id uuid)
language plpgsql security definer set search_path = public
as $function$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  return query
    select bill.booking_id from public.booking_visit_billing bill
    join public.bookings booking on booking.id = bill.booking_id
    left join public.regular_booking_series series on series.id = booking.regular_series_id
    where bill.status in ('unpaid', 'failed', 'requires_action')
      and bill.charge_due_at <= now() and bill.active_operation_id is null
      and not bill.policy_refund_required
      and booking.status::text = 'scheduled' and booking.provider_id is not null
      and not coalesce(series.billing_paused, false)
      and (p_bookings is null or bill.booking_id = any(p_bookings))
      and (bill.retry_after is null or bill.retry_after <= now()
        or booking.scheduled_at <= now() + interval '24 hours')
    order by bill.charge_due_at, bill.booking_id limit least(greatest(p_limit, 1), 100);
end;
$function$;
revoke all on function public.due_assigned_visit_payments(integer,uuid[]) from public, anon, authenticated;
grant execute on function public.due_assigned_visit_payments(integer,uuid[]) to service_role;

create or replace function public.claim_visit_money_operation(p_operation uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $function$
declare v_op public.booking_visit_money_operations; v_gate jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  select * into strict v_op from public.booking_visit_money_operations where id = p_operation;
  perform public.lock_visit_series(v_op.booking_id);
  select * into strict v_op from public.booking_visit_money_operations where id = p_operation for update;
  if v_op.status in ('succeeded', 'failed') or v_op.lease_until > now() then return null; end if;
  if v_op.operation_type in ('charge', 'extras') then
    v_gate := public.visit_charge_gate(v_op.booking_id, v_op.id, v_op.operation_type);
  end if;
  -- Claim blocked operations too, so an existing Stripe outcome is settled.
  -- The runner must not create/confirm a payment when this fresh gate is false.
  update public.booking_visit_money_operations
  set status = 'running', lease_until = now() + interval '3 minutes',
    parameters = parameters || jsonb_build_object('claimChargeGate', v_gate)
  where id = p_operation returning * into v_op;
  return to_jsonb(v_op);
end;
$function$;

create or replace function public.visit_matching_notice_allowed(p_id uuid, p_token uuid)
returns boolean
language plpgsql security definer set search_path = public
as $function$
declare v_notice public.visit_matching_notices; v_booking public.bookings; v_series public.regular_booking_series;
begin
  if auth.role() is distinct from 'service_role' then return false; end if;
  select * into v_notice from public.visit_matching_notices
  where id = p_id and claim_token = p_token and status = 'processing' and expires_at > now();
  if not found then return false; end if;
  select * into strict v_booking from public.bookings where id = v_notice.booking_id;
  if v_booking.regular_series_id is not null then
    select * into strict v_series from public.regular_booking_series where id = v_booking.regular_series_id;
  end if;
  if v_notice.kind in ('admin_48h', 'customer_24h') then
    return v_booking.status::text = 'offered' and v_booking.provider_id is null
      and v_booking.scheduled_at > now() + interval '2 hours'
      and not coalesce(v_series.billing_paused, false)
      and v_notice.series_generation = coalesce(v_series.pause_generation, 0);
  elsif v_notice.kind = 'series_paused' then
    return v_series.billing_paused and v_notice.series_generation = v_series.pause_generation;
  elsif v_notice.kind = 'series_resumed' then
    return not v_series.billing_paused and v_notice.series_generation = v_series.pause_generation;
  end if;
  return true;
end;
$function$;
revoke all on function public.visit_matching_notice_allowed(uuid,uuid) from public, anon, authenticated;
grant execute on function public.visit_matching_notice_allowed(uuid,uuid) to service_role;

-- Both SMS queues share one monthly spending cap and one budget lock.
create or replace function public.claim_booking_sms(p_budget_pence integer,p_cost_cap_pence integer)
returns table(id uuid,claim_token uuid,phone text,kind text,booking_id uuid,scheduled_at timestamptz)
language plpgsql security definer set search_path=public as $fn$
declare item record; spent bigint; month date:=date_trunc('month',now() at time zone 'Europe/London')::date; token uuid; claimed integer:=0;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
 if p_budget_pence<=0 or p_budget_pence>1000000 or p_cost_cap_pence<=0 or p_cost_cap_pence>p_budget_pence then raise exception 'SMS budget required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('booking-sms-budget:'||month::text,0));
 -- No automatic retries after a lease expires: provider acceptance is unknown.
 update public.booking_notification_deliveries d set status='failed',last_error='SMS outcome uncertain; manual provider review required.',claim_token=null where d.channel='sms' and d.status='processing' and d.claimed_at<now()-interval '10 minutes';
 update public.booking_notification_deliveries d set status='cancelled',claim_token=null where d.channel='sms' and d.status='pending' and(d.expires_at<=now() or not exists(select 1 from public.bookings b join public.account_profile_details s on s.user_id=d.user_id where b.id=d.booking_id and b.status::text in('offered','scheduled') and s.contact_sms and(d.kind='received' or (b.status::text='scheduled' and (d.kind='confirmed' or s.notify_bookings)))));
 select coalesce(sum(cost), 0) into spent from (
   select sms_cost_cap_pence as cost from public.booking_notification_deliveries where sms_budget_month = month
   union all select sms_cost_cap_pence from public.visit_matching_notices where sms_budget_month = month
 ) combined;
 for item in select d.id,d.booking_id,d.kind,p.phone,b.scheduled_at from public.booking_notification_deliveries d join public.profiles p on p.id=d.user_id join public.bookings b on b.id=d.booking_id where d.channel='sms' and d.status='pending' and d.due_at<=now() and d.expires_at>now() and p.phone~'^\+44[0-9]{10}$' order by d.due_at,d.id limit 5 for update of d skip locked loop
  if spent+p_cost_cap_pence>p_budget_pence then exit; end if;
  token:=gen_random_uuid();
  update public.booking_notification_deliveries d set status='processing',claimed_at=now(),claim_token=token,attempts=d.attempts+1,sms_budget_month=month,sms_cost_cap_pence=p_cost_cap_pence where d.id=item.id;
  spent:=spent+p_cost_cap_pence;claimed:=claimed+1;
  id:=item.id;claim_token:=token;phone:=item.phone;kind:=item.kind;booking_id:=item.booking_id;scheduled_at:=item.scheduled_at;return next;
 end loop;
end $fn$;

commit;
notify pgrst, 'reload schema';
