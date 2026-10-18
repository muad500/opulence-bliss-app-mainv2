-- New visit billing is private and applies only to new-model checkouts.
-- Existing bookings, authorisations, payments and payout agreements remain intact.
begin;

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

create table public.regular_series_cancellation_flags (
  customer_id uuid primary key references public.profiles(id),
  cancelled_after_first integer not null default 0,
  series_ids uuid[] not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.booking_visit_billing enable row level security;
alter table public.booking_visit_money_operations enable row level security;
alter table public.booking_visit_charges enable row level security;
alter table public.regular_series_cancellation_flags enable row level security;
revoke all on public.booking_visit_billing, public.booking_visit_money_operations,
  public.booking_visit_charges, public.regular_series_cancellation_flags
  from public, anon, authenticated;
grant select, insert, update on public.booking_visit_billing,
  public.booking_visit_money_operations, public.booking_visit_charges,
  public.regular_series_cancellation_flags to service_role;

create or replace function public.sync_visit_billing_schedule()
returns trigger
language plpgsql security definer set search_path = public
as $function$
begin
  if new.scheduled_at is distinct from old.scheduled_at then
    update public.booking_visit_billing
    set charge_due_at = new.scheduled_at - interval '48 hours', updated_at = now()
    where booking_id = new.id and status in ('unpaid', 'failed', 'requires_action');
  end if;
  return new;
end;
$function$;
create trigger sync_visit_billing_schedule
after update of scheduled_at on public.bookings
for each row execute function public.sync_visit_billing_schedule();

create or replace function public.guard_visit_billing_booking_changes()
returns trigger
language plpgsql security definer set search_path = public
as $function$
declare
  v_billing public.booking_visit_billing;
begin
  select * into v_billing from public.booking_visit_billing
  where booking_id = old.id for update;
  if not found then return new; end if;
  if new.package_id is distinct from old.package_id then
    raise exception 'To change your package, cancel this visit and rebook.' using errcode = 'check_violation';
  end if;
  if (new.scheduled_at is distinct from old.scheduled_at or new.status is distinct from old.status)
    and v_billing.active_operation_id is not null
    and current_setting('opulence.visit_billing_operation', true) is distinct from v_billing.active_operation_id::text
  then
    raise exception 'A payment change is still processing. Please wait.' using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;
create trigger guard_visit_billing_booking_changes
before update of scheduled_at, package_id, status on public.bookings
for each row execute function public.guard_visit_billing_booking_changes();

create or replace function public.protect_cleaning_extras()
returns trigger
language plpgsql security definer set search_path = public
as $function$
declare
  v_operation uuid;
begin
  if new.cleaning_extras is not distinct from old.cleaning_extras then return new; end if;
  select active_operation_id into v_operation from public.booking_visit_billing where booking_id = old.id;
  if auth.role() is distinct from 'service_role' or v_operation is null
    or current_setting('opulence.visit_billing_operation', true) is distinct from v_operation::text
  then
    raise exception 'Use the booking add-ons form to change paid scope.' using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

create or replace function public.hold_unconfirmed_visit_payout()
returns trigger
language plpgsql security definer set search_path = public
as $function$
begin
  if new.amount > 0 and exists (
    select 1 from public.booking_visit_billing
    where booking_id = new.booking_id and not rate_confirmed
  ) and not exists (
    select 1 from public.payments where id = new.payment_id and kind = 'tip'
  ) then
    raise exception 'Cleaner pay has not been confirmed for this booking.' using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;
create trigger hold_unconfirmed_visit_payout
before insert or update of amount, status on public.payouts
for each row execute function public.hold_unconfirmed_visit_payout();

revoke all on function public.sync_visit_billing_schedule(),
  public.guard_visit_billing_booking_changes(), public.hold_unconfirmed_visit_payout(), public.protect_cleaning_extras()
  from public, anon, authenticated;

commit;
notify pgrst, 'reload schema';
