\set ON_ERROR_STOP on
-- Isolated PostgreSQL fixture, NOT a project migration. Never run on a linked
-- Supabase database. The database-name guard executes before any DDL.
do $$begin
  if current_database()<>'launch_safety_test' then raise exception 'Use the isolated launch_safety_test database only'; end if;
end$$;
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create schema storage;
grant usage on schema auth,public,storage to anon,authenticated,service_role;
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
create function auth.role() returns text language sql stable as $$select auth.jwt()->>'role'$$;
create table public.profiles(id uuid primary key,role text,full_name text,email text,account_deleted_at timestamptz);
create table public.providers(id uuid primary key default gen_random_uuid(),profile_id uuid references profiles,vetting_status text default 'pending',service_approvals jsonb default '{}',dbs_verified boolean default false,stripe_account_id text);
create function public.current_provider_id() returns uuid language sql stable security definer as $$select id from public.providers where profile_id=auth.uid()$$;
create function public.is_admin() returns boolean language sql stable security definer as $$select coalesce(auth.jwt()->>'aal'='aal2',false) and exists(select 1 from profiles where id=auth.uid() and role='admin' and account_deleted_at is null)$$;
create table public.packages(id uuid primary key default gen_random_uuid(),name text);
create table public.regular_booking_series(id uuid primary key,customer_id uuid,billing_paused boolean default false);
create table public.bookings(id uuid primary key default gen_random_uuid(),customer_id uuid references profiles,provider_id uuid references providers,package_id uuid references packages,status text,scheduled_at timestamptz,regular_series_id uuid,subscription_id uuid,regular_visit_number integer,offer_expires_at timestamptz,optional_scheduled_at timestamptz[],cleaning_extras jsonb default '{}',duration_minutes integer,household_notes text);
alter table public.bookings add column created_at timestamptz not null default now()-interval '30 days';
create table public.booking_events(id bigint generated always as identity primary key,booking_id uuid,from_status text,to_status text,actor_id uuid,actor_kind text,reason text,meta jsonb default '{}',created_at timestamptz default now());
create function public.booking_events_immutable() returns trigger language plpgsql as $$begin raise exception 'append only'; end$$;
create trigger booking_events_no_update before update or delete on public.booking_events for each row execute function public.booking_events_immutable();
create table public.check_in_challenges(id uuid primary key default gen_random_uuid(),booking_id uuid,gps_lat numeric,gps_lng numeric,distance_metres integer,geofence_pass boolean,created_at timestamptz default now());
create table public.check_ins(id uuid primary key default gen_random_uuid(),booking_id uuid,arrived_at timestamptz default now(),left_at timestamptz,gps_lat numeric,gps_lng numeric,geofence_pass boolean);
create table public.review_cases(id uuid primary key default gen_random_uuid(),booking_id uuid,category text,status text default 'open',blocks_payment boolean,blocks_payout boolean);
create function public.account_booking_actor(p_id uuid,p_assigned boolean) returns text language sql security definer as $$select case when b.customer_id=auth.uid() then 'customer' when b.provider_id=current_provider_id() then 'provider' end from bookings b where b.id=p_id$$;
create function public._apply_booking_transition(p_id uuid,p_status text,p_actor uuid,p_kind text,p_reason text,p_meta jsonb) returns jsonb language plpgsql security definer as $$begin
  update bookings set status=p_status where id=p_id;
  insert into booking_events(booking_id,to_status,actor_id,actor_kind,reason,meta) values(p_id,p_status,p_actor,p_kind,p_reason,p_meta);
  return '{"changed":true}'; end$$;
create function public.open_review_case(p_booking uuid,p_category text,p_priority text,p_blocks_payment boolean,p_blocks_payout boolean,p_notes text,p_created_by uuid default null) returns uuid language plpgsql as $$declare v_id uuid; begin
 insert into review_cases(booking_id,category,blocks_payment,blocks_payout) values(p_booking,p_category,p_blocks_payment,p_blocks_payout) returning id into v_id;return v_id;end$$;
create table public.provider_dbs_checks(provider_id uuid primary key references providers,certificate_number text,issue_date date,certificate_storage_path text,certificate_original_name text,certificate_mime_type text,status text,uploaded_at timestamptz);
alter table public.provider_dbs_checks enable row level security;
grant select on public.provider_dbs_checks to authenticated;
create policy "applicants and admins read DBS evidence" on public.provider_dbs_checks for select to authenticated using(provider_id=current_provider_id() or is_admin());
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security;
grant select on storage.objects to authenticated;
create function storage.foldername(p_path text) returns text[] language sql immutable as $$select string_to_array(p_path,'/')$$;
create policy "applicants and admins read DBS certificates" on storage.objects for select to authenticated using(bucket_id='provider-dbs' and ((storage.foldername(name))[1]=current_provider_id()::text or is_admin()));
create table public.legal_documents(slug text primary key constraint legal_documents_slug_check check(slug in ('terms','privacy','cancellation-refund','handyman-terms','review-policy','professional-partner-agreement')),title text,audience text,content_html text,version text,published boolean);
create table public.account_legal_acceptances(user_id uuid,document_slug text,version text,accepted_at timestamptz,booking_id uuid);
create table public.cleaning_billing_settings(id bigint generated always as identity primary key,terms jsonb);
create table public.booking_cleaning_billing_terms(booking_id uuid primary key references bookings,terms jsonb,charge_timing text);
create table public.payments(id uuid primary key default gen_random_uuid(),booking_id uuid references bookings,stripe_payment_ref text,gross_amount numeric,status text,kind text,split_breakdown jsonb default '{}',created_at timestamptz default now(),status_changed_at timestamptz);
create table public.payment_events(payment_id uuid,from_status text,to_status text,actor_kind text,reason text,meta jsonb);
create table public.payouts(id uuid primary key default gen_random_uuid(),booking_id uuid references bookings,provider_id uuid references providers,payment_id uuid,stripe_transfer_ref text,amount numeric,status text,created_at timestamptz default now());
create table public.payout_events(payout_id uuid,from_status text,to_status text,reason text,created_at timestamptz default now());
create function public._apply_payout_transition(p_id uuid,p_status text,p_actor uuid,p_kind text,p_reason text,p_meta jsonb) returns jsonb language plpgsql security definer as $$begin
 insert into payout_events(payout_id,from_status,to_status,reason) select id,status,p_status,p_reason from payouts where id=p_id;
 update payouts set status=p_status where id=p_id;return '{"changed":true}';end$$;
create table public.money_operations(id uuid primary key default gen_random_uuid(),booking_id uuid,operation_key text,status text);
create table public.booking_offers(booking_id uuid,status text);
create table public.notifications(user_id uuid,title text,body text,href text);
create table public.regular_series_cancellation_flags(customer_id uuid primary key,cancelled_after_first integer,series_ids uuid[],updated_at timestamptz);
create function public.lock_visit_series(p_id uuid) returns void language sql as $$select pg_advisory_xact_lock(hashtextextended(p_id::text,0))$$;
create function public.visit_charge_gate(p_booking uuid,p_operation uuid,p_kind text) returns jsonb language sql as $$select '{"allowed":true,"assigned":true,"paused":false}'::jsonb$$;
create function public.record_unmatched_visit(p_id uuid) returns void language sql as $$select$$;
create function public.late_acceptance_card_update_deadline(p_date timestamptz,p_now timestamptz) returns timestamptz language sql as $$select p_date$$;
create function public.queue_visit_matching_notice(uuid,uuid,text,text,text,text,text) returns void language sql as $$select$$;

-- The actual pre-launch billing functions and schema are loaded below by the
-- fixture runner, before the new migrations. No network or real user is used.
create table public.booking_visit_billing (
  booking_id uuid primary key references public.bookings(id),
  customer_id uuid not null references public.profiles(id),
  stripe_customer_id text not null,
  stripe_payment_method_id text not null,
  method_updated_at timestamptz not null default now(),
  card_consent_at timestamptz not null,
  card_consent_version text not null,
  charge_due_at timestamptz not null,
  amount_pence integer not null check (amount_pence > 0),
  base_pence integer not null check (base_pence > 0),
  discount_pence integer not null default 0 check (discount_pence >= 0),
  line_items jsonb not null check (jsonb_typeof(line_items) = 'array'),
  status text not null check (status in (
    'unpaid', 'charging', 'paid', 'failed', 'requires_action',
    'changing', 'cancelling', 'cancelled', 'review'
  )),
  revision integer not null default 1,
  attempts integer not null default 0,
  retry_after timestamptz,
  last_error text,
  active_operation_id uuid,
  rate_confirmed boolean not null default false,
  deadline_missed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index booking_visit_billing_due
  on public.booking_visit_billing (charge_due_at, retry_after)
  where status in ('unpaid', 'failed', 'requires_action', 'charging', 'review');

create table public.booking_visit_money_operations (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.booking_visit_billing(booking_id),
  customer_id uuid not null references public.profiles(id),
  operation_type text not null check (operation_type in ('charge', 'extras', 'cancel', 'unfilled', 'late_refund')),
  revision integer not null,
  idempotency_key text not null unique,
  parameters jsonb not null,
  status text not null default 'prepared' check (status in ('prepared', 'running', 'succeeded', 'failed', 'ambiguous')),
  stripe_objects jsonb not null default '[]'::jsonb,
  lease_until timestamptz,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create unique index one_active_visit_money_operation
  on public.booking_visit_money_operations (booking_id)
  where status in ('prepared', 'running', 'ambiguous');
alter table public.booking_visit_billing
  add constraint booking_visit_billing_active_operation_fk
  foreign key (active_operation_id) references public.booking_visit_money_operations(id);

create table public.booking_visit_charges (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.booking_visit_billing(booking_id),
  stripe_payment_intent text not null unique,
  amount_pence integer not null check (amount_pence > 0),
  refunded_pence integer not null default 0 check (refunded_pence >= 0 and refunded_pence <= amount_pence),
  line_items jsonb not null,
  refunded_lines jsonb not null default '{}'::jsonb,
  operation_id uuid references public.booking_visit_money_operations(id),
  payment_id uuid references public.payments(id),
  created_at timestamptz not null default now()
);


alter table public.booking_visit_money_operations drop constraint booking_visit_money_operations_operation_type_check;
alter table public.booking_visit_money_operations add constraint booking_visit_money_operations_operation_type_check check(operation_type in ('charge','extras','cancel','unfilled','late_refund','policy_refund'));
alter table public.booking_visit_billing add column assigned_at timestamptz,add column policy_refund_required boolean default false,add column blocked_charge_operation uuid,add column late_payment_grace_until timestamptz,add column late_payment_grace_assignment_at timestamptz;
create function public.set_cleaning_payment_allocation() returns trigger language plpgsql as $$begin return new;end$$;
create trigger set_cleaning_payment_allocation before insert or update of split_breakdown,gross_amount on public.payments for each row execute function public.set_cleaning_payment_allocation();
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
  v_grace_until timestamptz;
  v_new_grace boolean := false;
  v_blocked_type text;
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
  select operation_type into v_blocked_type from public.booking_visit_money_operations
  where id = v_bill.blocked_charge_operation;
  v_grace_until := v_bill.late_payment_grace_until;
  -- Start at most one window for this assignment. Retries never extend it.
  if p_outcome = 'failed' and v_op.operation_type = 'charge'
    and v_booking.provider_id is not null and v_bill.assigned_at is not null
    and v_bill.assigned_at >= v_booking.scheduled_at - interval '24 hours'
    and v_bill.late_payment_grace_assignment_at is distinct from v_bill.assigned_at
    and not v_bill.deadline_missed
  then
    v_new_grace := true;
    v_grace_until := public.late_acceptance_card_update_deadline(v_booking.scheduled_at, now());
  end if;
  update public.booking_visit_money_operations
  set status = case when p_outcome = 'blocked' then 'failed' else p_outcome end,
    stripe_objects = p_results,
    lease_until = null, completed_at = now(), error = p_error where id = p_operation;
  update public.booking_visit_billing set active_operation_id = null,
    late_payment_grace_until = v_grace_until,
    late_payment_grace_assignment_at = case when v_new_grace then v_bill.assigned_at
      else late_payment_grace_assignment_at end,
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
        case when v_booking.status::text = 'cancelled' then 'cancelled'
          when v_blocked_type = 'extras' then 'review' else 'unpaid' end
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
    retry_after = case when p_outcome = 'failed' and v_op.operation_type = 'charge' then case when v_grace_until > now() then least(now() + interval '15 minutes', v_grace_until)
        else now() + interval '6 hours' end else null end,
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
        when v_op.parameters ->> 'actor' is null then
          case when v_bill.late_payment_grace_until is not null
            then 'The card-update window ended without payment, so this visit has been cancelled. Please update your saved card before booking again.'
            else 'This visit was still unpaid 24 hours before its start and has been cancelled. Please update your saved card.' end
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
      'Update your saved card',
      case when v_grace_until > now() then
        'Your visit payment failed. Update your saved card in Payments before '
        || to_char(v_grace_until at time zone 'Europe/London', 'DD Mon YYYY, HH24:MI')
        || ' (London time). We will retry within this card-update window; if still unpaid at its end, the visit will be cancelled.'
      when v_grace_until is not null then
        'Your visit payment failed too close to the visit for a card-update window. This visit will be cancelled.'
      else 'Your visit payment failed. Update your saved card in Payments. We will retry; if still unpaid 24 hours before the visit, it will be cancelled.' end,
      '/account/settings/payments');
  end if;
  if v_op.operation_type = 'policy_refund' and p_outcome = 'succeeded' then
    perform public.queue_visit_matching_notice(
      v_bill.booking_id, v_bill.customer_id, 'payment_reconciled',
      'blocked-payment-refunded:' || p_operation,
      'A delayed payment has been refunded',
      case when v_blocked_type = 'extras' then
        'An add-on payment arrived after matching changed and has been refunded. Your earlier payment is still recorded. Our team will review the visit before any further payment is taken.'
      else 'A delayed payment arrived after this visit was paused, closed or unassigned. That payment has been refunded in full. This does not resume your visits.' end,
      '/account/visit/' || v_bill.booking_id
    );
    if v_blocked_type = 'extras' then
      perform public.queue_visit_matching_notice(
        v_bill.booking_id, reviewer.id, 'payment_reconciled', 'blocked-extras-review:' || p_operation,
        'Add-on payment reconciliation needs review',
        'A captured add-on charge has been refunded after matching changed. Existing payments are recorded; automatic billing is blocked for this visit until its scope and paid balance are reviewed.',
        '/admin/bookings'
      ) from public.profiles reviewer where reviewer.role::text = 'admin' and reviewer.account_deleted_at is null;
    end if;
  end if;
end;
$function$;

insert into public.cleaning_billing_settings(terms) values('{"cleanerHourlyPence":1500,"addonPrices":{"oven":2000,"fridge":1000,"cupboards":1000,"windows":1500,"ironing":1500},"productsFeePence":500,"tipMinimumPence":300,"cancellationRefundPercent":{"full":100,"three_quarter":75,"half":50,"none":0}}');
insert into public.profiles(id,role,email) values
 ('00000000-0000-4000-8000-000000000001','customer','customer@example.invalid'),
 ('00000000-0000-4000-8000-000000000002','provider','professional@example.invalid'),
 ('00000000-0000-4000-8000-000000000003','admin','onboarding@example.invalid'),
 ('00000000-0000-4000-8000-000000000004','admin','other-staff@example.invalid');
insert into public.providers(id,profile_id) values('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002');
insert into public.bookings(id,customer_id,provider_id,status,scheduled_at) values('20000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','scheduled',now()-interval '10 minutes');
insert into public.check_in_challenges(booking_id,gps_lat,gps_lng,distance_metres,geofence_pass) values('20000000-0000-4000-8000-000000000001',51.5,-0.1,25,true);
insert into public.check_ins(booking_id,gps_lat,gps_lng,geofence_pass) values('20000000-0000-4000-8000-000000000001',51.5,-0.1,true);
insert into public.booking_events(booking_id,to_status,meta) values('20000000-0000-4000-8000-000000000001','scheduled','{"gps_lat":51.5,"nested":{"gps_lng":-0.1,"distance_metres":25}}');
\ir ../migrations/20261024000100_checkin_location_minimisation.sql
\ir ../migrations/20261024000200_named_dbs_onboarding_access.sql
\ir ../migrations/20261024000300_professional_safeguarding.sql
\ir ../migrations/20261024000400_launch_cleaning_pay_terms.sql
\ir ../migrations/20261024000500_cleaning_cancellation_settlements.sql
\ir ../migrations/20261024000600_cleaning_payout_parts.sql

create function public.assert_launch(p_ok boolean,p_message text) returns void language plpgsql as $$begin
 if p_ok is distinct from true then raise exception 'FAIL: %',p_message;end if;
 raise notice 'PASS: %',p_message;
end$$;
select public.assert_launch(not exists(select 1 from check_ins where gps_lat is not null or gps_lng is not null),'old check-in coordinates deleted');
select public.assert_launch((select distance_metres=25 and geofence_pass from check_ins limit 1),'old non-precise distance/result preserved');
select public.assert_launch(not exists(select 1 from check_in_challenges where gps_lat is not null or gps_lng is not null),'old OTP challenge coordinates deleted');
select public.assert_launch((select meta='{"nested":{"distance_metres":25}}'::jsonb from booking_events limit 1),'coordinates removed from historical event metadata only');
update check_in_challenges set gps_lat=52,gps_lng=1;
select public.assert_launch(not exists(select 1 from check_in_challenges where gps_lat is not null or gps_lng is not null),'old writer cannot reintroduce coordinates');
do $$begin
 begin update booking_events set reason='changed'; raise exception 'audit update allowed';
 exception when others then if sqlerrm<>'append only' then raise;end if;end;
 raise notice 'PASS: booking audit remains append-only after purge';
end$$;

insert into provider_dbs_checks(provider_id,certificate_number,issue_date,status,certificate_storage_path)
values('10000000-0000-4000-8000-000000000002','000000000000','2026-10-01','pending','10000000-0000-4000-8000-000000000002/certificate.pdf');
insert into storage.objects(bucket_id,name) values('provider-dbs','10000000-0000-4000-8000-000000000002/certificate.pdf');
set role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000003","aal":"aal1"}',false);
do $$begin
 begin perform set_dbs_onboarding_staff(array['00000000-0000-4000-8000-000000000003'::uuid]); raise exception 'password-only grant allowed';
 exception when insufficient_privilege then null;end;
 raise notice 'PASS: password-only admin cannot grant DBS access';
end$$;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000003","aal":"aal2"}',false);
select set_dbs_onboarding_staff(array['00000000-0000-4000-8000-000000000003'::uuid]);
select public.assert_launch((select count(*)=0 from provider_dbs_checks),'even named staff cannot bypass audit with table SELECT');
select public.assert_launch((select count(*)=0 from storage.objects),'named staff cannot bypass logged certificate route');
select public.assert_launch((select count(*)=1 from staff_view_dbs_record('10000000-0000-4000-8000-000000000002','record_view')),'named onboarding staff can read record via audited RPC');
select public.assert_launch((select count(*)=1 from staff_view_dbs_record('10000000-0000-4000-8000-000000000002','certificate_view')),'certificate access is separately logged');
select public.assert_launch((select count(*)=3 from dbs_access_events),'grant, record view and certificate view are logged');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000004","aal":"aal2"}',false);
do $$begin
 begin perform staff_view_dbs_record('10000000-0000-4000-8000-000000000002');raise exception 'unlisted admin read allowed';
 exception when insufficient_privilege then null;end;
 raise notice 'PASS: unlisted MFA admin cannot view DBS evidence';
end$$;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000002"}',false);
select public.assert_launch((select count(*)=1 from provider_dbs_checks),'applicant retains own record access');
reset role;

-- Safeguarding is required for NEW registrations, not retroactively fabricated
-- for existing professionals. Both service approval branches are enforced.
do $$declare v_id uuid;begin
 insert into providers(profile_id) values('00000000-0000-4000-8000-000000000001') returning id into v_id;
 begin update providers set safeguarding_required=false where id=v_id;raise exception 'applicant removed safeguarding requirement';
 exception when check_violation then null;end;
 begin update providers set service_approvals='{"handyman":"approved"}' where id=v_id;raise exception 'approval without safeguarding allowed';
 exception when check_violation then null;end;
 insert into account_legal_acceptances(user_id,document_slug,version,accepted_at) values('00000000-0000-4000-8000-000000000001','safeguarding','1.0',now());
 update providers set service_approvals='{"handyman":"approved"}' where id=v_id;
 perform assert_launch((select safeguarding_required from providers where id=v_id),'new handyman registration requires safeguarding acceptance');
 update providers set vetting_status='approved' where id='10000000-0000-4000-8000-000000000002';
 raise notice 'PASS: legacy professional approval is unaffected';
end$$;

insert into packages(name) values('One-Time Essential Clean'),('Signature Deep Clean'),('End of Tenancy / Move-In Clean');
create function public.launch_cleaning_fixture(p_package text,p_start timestamptz default now()-interval '1 hour') returns uuid language plpgsql as $$
declare v_booking uuid; v_payment uuid; v_terms jsonb; v_version text; v_lines jsonb;
begin
 select id::text,terms into v_version,v_terms from cleaning_billing_settings order by id desc limit 1;
 v_terms:=v_terms||jsonb_build_object('version',v_version);
 insert into bookings(customer_id,provider_id,package_id,status,scheduled_at,duration_minutes)
 select '00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',id,'scheduled',p_start,180 from packages where name=p_package returning id into v_booking;
 insert into booking_cleaning_billing_terms(booking_id,terms,charge_timing) values(v_booking,v_terms,'checkout_then_48h');
 v_lines:='[{"id":"cleaning","label":"Cleaning","amountPence":5000,"reservedMinutes":120},{"id":"oven","label":"Oven","amountPence":2000,"reservedMinutes":60},{"id":"products","label":"Products","amountPence":500,"reservedMinutes":0}]';
 insert into booking_visit_billing(booking_id,customer_id,stripe_customer_id,stripe_payment_method_id,card_consent_at,card_consent_version,charge_due_at,amount_pence,base_pence,line_items,status,rate_confirmed)
 values(v_booking,'00000000-0000-4000-8000-000000000001','cus_fixture','pm_fixture',now(),'fixture',p_start,7500,5000,v_lines,'paid',true);
 insert into payments(booking_id,stripe_payment_ref,gross_amount,status,split_breakdown)
 values(v_booking,'pi_'||v_booking,75,'succeeded',jsonb_build_object('reserved_lines',v_lines)) returning id into v_payment;
 insert into booking_visit_charges(booking_id,stripe_payment_intent,amount_pence,line_items,payment_id)
 values(v_booking,'pi_'||v_booking,7500,v_lines,v_payment);
 return v_booking;
end$$;

do $$declare v_booking uuid;v_deep uuid;v_end uuid;v_charge uuid;v_op jsonb;v_plan jsonb;v_next jsonb;v_results jsonb;v_params jsonb;v_payout uuid;begin
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 v_booking:=launch_cleaning_fixture('One-Time Essential Clean');
 v_deep:=launch_cleaning_fixture('Signature Deep Clean');
 v_end:=launch_cleaning_fixture('End of Tenancy / Move-In Clean');
 perform assert_launch((select round((split_breakdown->>'provider')::numeric*100)=3400 from payments where booking_id=v_booking),'standard pay £30 plus products £4, not add-on reserved time');
 perform assert_launch((select round((split_breakdown->>'provider')::numeric*100)=3900 from payments where booking_id=v_deep),'Signature Deep Clean £35 plus products £4');
 perform assert_launch((select round((split_breakdown->>'provider')::numeric*100)=3900 from payments where booking_id=v_end),'End of Tenancy £35 plus products £4');
 select id into v_charge from booking_visit_charges where booking_id=v_booking;
 v_params:=jsonb_build_object('refundPercent',30,'refunds',jsonb_build_array(jsonb_build_object('chargeId',v_charge,'intentId','pi_'||v_booking,'amountPence',4000,'refundedLines',jsonb_build_object('cleaning',1500,'oven',2000,'products',500))));
 v_op:=prepare_visit_money_operation(v_booking,'00000000-0000-4000-8000-000000000001','cancel',1,v_params);
 v_results:=jsonb_build_array(jsonb_build_object('type','refund','id','re_fixture','chargeId',v_charge,'amountPence',4000,'refundedLines',jsonb_build_object('cleaning',1500,'oven',2000,'products',500)));
 perform finish_visit_money_operation((v_op->>'id')::uuid,'succeeded',v_results);
 perform assert_launch((select charge_pence=3500 and cleaner_pay_pence=2100 from cleaning_cancellation_settlements where booking_id=v_booking),'70% cleaning charge and 70% cleaner compensation; extras/products fully refunded');
 perform assert_launch((select refunded_pence=4000 from booking_visit_charges where id=v_charge),'refund recorded against original funding charge');
 v_plan:=prepare_cleaning_payout(v_booking,jsonb_build_array(jsonb_build_object('chargeId',v_charge,'intentId','pi_'||v_booking,'amountPence',2100)));
 perform assert_launch((v_plan->>'ready')::boolean,'cancelled visit compensation can become ready for payout');
 v_payout:=(v_plan->>'payoutId')::uuid;
 update cleaning_payout_parts set transfer_ref='tr_fixture' where charge_id=v_charge;
 update payouts set status='paid',stripe_transfer_ref='tr_fixture' where id=v_payout;
 perform set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001"}',true);
 begin perform prepare_cleaning_cancellation_adjustment(v_booking,'waive',1000,0);raise exception 'customer waived cleaner compensation';
 exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000002"}',true);
 v_next:=prepare_cleaning_cancellation_adjustment(v_booking,'waive',1000,0);
 perform assert_launch((v_next->'parameters'->'reversals'->0->>'amountPence')::integer=1000,'waiver after payout prepares a £10 transfer reversal');
 perform assert_launch((v_next->'parameters'->'refunds'->0->>'amountPence')::integer=1000,'waiver adds £10 to customer refund');
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 perform finish_visit_money_operation((v_next->>'id')::uuid,'ambiguous','[]');
 perform assert_launch((select cleaner_pay_pence=2100 and revision=0 from cleaning_cancellation_settlements where booking_id=v_booking),'ambiguous waiver cannot change compensation or be applied twice');
 v_results:=jsonb_build_array(jsonb_build_object('type','reversal','id','trr_fixture','chargeId',v_charge,'amountPence',1000),jsonb_build_object('type','refund','id','re_waiver','chargeId',v_charge,'amountPence',1000,'refundedLines',v_next->'parameters'->'refunds'->0->'refundedLines'));
 perform finish_visit_money_operation((v_next->>'id')::uuid,'succeeded',v_results);
 perform finish_visit_money_operation((v_next->>'id')::uuid,'succeeded',v_results);
 perform assert_launch((select cleaner_pay_pence=1100 and charge_pence=2500 and waived_pence=1000 and revision=1 from cleaning_cancellation_settlements where booking_id=v_booking),'confirmed waiver changes totals exactly once');
 perform assert_launch((select reversed_pence=1000 from cleaning_payout_parts where charge_id=v_charge),'confirmed transfer reversal is retained in audit');
 perform assert_launch((select amount=11 from payouts where id=v_payout),'payout net reflects reversal');
 perform set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000003","aal":"aal2"}',true);
 begin perform prepare_cleaning_cancellation_adjustment(v_booking,'reduce_charge',80,1);raise exception 'staff increased cancellation charge';exception when others then if sqlerrm='staff increased cancellation charge' then raise;end if;end;
 v_next:=prepare_cleaning_cancellation_adjustment(v_booking,'reduce_charge',0,1);
 perform assert_launch((v_next->'parameters'->>'refundPence')::integer=2500,'staff can reduce the remaining charge to zero');
 raise notice 'PASS: cancellation adjustments are authorised and revision-locked';
end$$;

do $$declare v_result jsonb;v_op jsonb;v_id uuid:='20000000-0000-4000-8000-000000000001';v_noaccess uuid;v_charge uuid;begin
 perform set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000002"}',true);
 begin perform report_booking_exception(v_id,'client_unavailable','No access',null,'{}');raise exception 'no access before fifteen minutes';exception when check_violation then null;end;
 update bookings set scheduled_at=now()-interval '16 minutes' where id=v_id;
 v_result:=report_booking_exception(v_id,'client_unavailable','No access',null,'{"gps_lat":51.5,"gps_lng":-0.1,"distance_metres":25,"location_verified":true}');
 perform assert_launch((v_result->>'ok')::boolean,'no-access report allowed after fifteen minutes');
 perform assert_launch(not exists(select 1 from booking_events where meta ? 'gps_lat' or meta ? 'gps_lng'),'future exception reports cannot persist coordinates');
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 v_noaccess:=launch_cleaning_fixture('One-Time Essential Clean',now()-interval '16 minutes');
 perform set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000002"}',true);
 perform report_booking_exception(v_noaccess,'client_unavailable','No access',null,'{}');
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 select id into v_charge from booking_visit_charges where booking_id=v_noaccess;
 v_op:=prepare_visit_money_operation(v_noaccess,'00000000-0000-4000-8000-000000000001','cancel',1,
   jsonb_build_object('refundPercent',30,'staffActor','00000000-0000-4000-8000-000000000003','staffChargePercent',70,'noAccess',true,
     'refunds',jsonb_build_array(jsonb_build_object('chargeId',v_charge,'intentId','pi_'||v_noaccess,'amountPence',4000,'refundedLines','{"cleaning":1500,"oven":2000,"products":500}'::jsonb))));
 perform assert_launch((select actor_kind='admin' and actor_id='00000000-0000-4000-8000-000000000003'::uuid and reason like 'No access%' from booking_events where booking_id=v_noaccess and to_status='cancelled'),'no-access cancellation records the real staff actor and reason');
end$$;

do $$declare v_booking uuid;v_charge uuid;v_op jsonb;v_results jsonb;begin
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 v_booking:=launch_cleaning_fixture('One-Time Essential Clean',now()+interval '1 hour');
 update bookings set created_at=now() where id=v_booking;
 select id into v_charge from booking_visit_charges where booking_id=v_booking;
 perform assert_launch(cleaning_statutory_cancellation_free(v_booking),'new customer cancellation is inside statutory period');
 begin
   perform prepare_visit_money_operation(v_booking,'00000000-0000-4000-8000-000000000001','cancel',1,'{"refundPercent":30,"refunds":[]}');
   raise exception 'late fee charged inside statutory period';
 exception when others then if sqlerrm='late fee charged inside statutory period' then raise;end if;end;
 v_op:=prepare_visit_money_operation(v_booking,'00000000-0000-4000-8000-000000000001','cancel',1,'{"refundPercent":100,"refunds":[]}');
 v_results:=jsonb_build_array(jsonb_build_object('type','refund','id','re_statutory','chargeId',v_charge,'amountPence',7500,'refundedLines','{"cleaning":5000,"oven":2000,"products":500}'::jsonb));
 perform finish_visit_money_operation((v_op->>'id')::uuid,'succeeded',v_results);
 perform assert_launch((select charge_pence=0 and cleaner_pay_pence=0 from cleaning_cancellation_settlements where booking_id=v_booking),'statutory cancellation refunds all paid lines and creates no late compensation');
end$$;

select 'Launch safety isolated database checks passed' as result;
