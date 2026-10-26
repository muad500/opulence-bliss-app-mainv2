begin;

-- Existing bookings keep their recorded rate, including those that have not
-- found a cleaner yet. Membership is fixed at release, rather than inferred
-- from a date supplied by a client or the later time of acceptance.
create table public.existing_booking_cleaner_pay (
  booking_id uuid primary key references public.bookings(id),
  hourly_pence integer check (hourly_pence between 1 and 10000),
  recorded_at timestamptz not null default now()
);
alter table public.existing_booking_cleaner_pay enable row level security;
revoke all on public.existing_booking_cleaner_pay
  from public, anon, authenticated, service_role;
grant select on public.existing_booking_cleaner_pay to service_role;

insert into public.existing_booking_cleaner_pay (booking_id, hourly_pence)
select booking.id,
  coalesce(agreed.hourly_pence, (terms.terms ->> 'cleanerHourlyPence')::integer)
from public.bookings booking
left join public.booking_cleaning_billing_terms terms
  on terms.booking_id = booking.id
left join public.booking_cleaner_pay_terms agreed
  on agreed.booking_id = booking.id
  and agreed.provider_id = booking.provider_id;

create or replace function public.effective_booking_cleaner_hourly_pence(
  p_booking uuid
)
returns integer
language sql
stable
security definer
set search_path = public
as $function$
  select coalesce(
    agreed.hourly_pence,
    existing.hourly_pence,
    (terms.terms ->> 'cleanerHourlyPence')::integer
  )
  from public.booking_cleaning_billing_terms terms
  join public.bookings booking on booking.id = terms.booking_id
  left join public.booking_cleaner_pay_terms agreed
    on agreed.booking_id = booking.id
    and agreed.provider_id = booking.provider_id
  left join public.existing_booking_cleaner_pay existing
    on existing.booking_id = booking.id
  where booking.id = p_booking;
$function$;

create or replace function public.snapshot_assigned_cleaner_pay()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_base integer;
  v_deep boolean;
  v_existing public.existing_booking_cleaner_pay;
  v_clock public.cleaner_experience_clocks;
begin
  if new.provider_id is null then
    return new;
  end if;
  if new.provider_id is not distinct from old.provider_id
    and not (new.status::text = 'completed' and old.status::text <> 'completed')
  then
    return new;
  end if;

  select (terms.terms ->> 'cleanerHourlyPence')::integer,
    package.name in ('Signature Deep Clean', 'End of Tenancy / Move-In Clean')
  into v_base, v_deep
  from public.booking_cleaning_billing_terms terms
  join public.packages package on package.id = new.package_id
  where terms.booking_id = new.id;

  if v_base is not null
    and new.provider_id is distinct from old.provider_id
    and not exists (select 1 from public.payouts where booking_id = new.id)
  then
    perform 1 from public.providers where id = new.provider_id for update;
    select * into v_clock from public.cleaner_experience_clocks
      where provider_id = new.provider_id;
    select * into v_existing from public.existing_booking_cleaner_pay
      where booking_id = new.id;

    insert into public.booking_cleaner_pay_terms (
      booking_id, provider_id, hourly_pence, experience_started_at,
      last_completed_at, effective_at
    )
    values (
      new.id, new.provider_id,
      case
        when v_existing.booking_id is not null
          then coalesce(v_existing.hourly_pence, v_base)
        when v_deep then v_base
        else public.standard_cleaner_experience_rate(
          v_base, v_clock.started_at, v_clock.last_completed_at, now()
        )
      end,
      v_clock.started_at, v_clock.last_completed_at, now()
    )
    on conflict do nothing;

    -- Preserve the existing allocation path and its agreed per-visit snapshot.
    update public.payments set split_breakdown = split_breakdown
    where booking_id = new.id and coalesce(kind, '') <> 'tip';
  end if;

  if new.status::text = 'completed' and old.status::text <> 'completed' then
    perform public.advance_cleaner_experience(new.provider_id, now());
  end if;
  return new;
end;
$function$;

revoke all on function public.effective_booking_cleaner_hourly_pence(uuid)
  from public, anon, authenticated;
grant execute on function public.effective_booking_cleaner_hourly_pence(uuid)
  to service_role;
revoke all on function public.snapshot_assigned_cleaner_pay()
  from public, anon, authenticated, service_role;

commit;
