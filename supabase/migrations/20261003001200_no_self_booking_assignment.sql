-- A professional can now also book as a customer, so they must never be
-- offered, assigned or paid for their own booking (development checklist item
-- 93). Without this they could accept their own job, be paid out for it and
-- review both sides of it, and a stolen card could be turned into a payout.
--
-- Matching already leaves the customer out. These rules make it impossible by
-- any route: offer acceptance, admin assignment or a future code path.

begin;

-- 1. A booking can never be assigned to the customer's own professional record.
create or replace function public.prevent_self_booking_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.provider_id is not null and exists (
    select 1 from public.providers p
    where p.id = new.provider_id and p.profile_id = new.customer_id
  ) then
    raise exception 'A professional cannot be assigned their own booking.'
      using errcode = 'check_violation';
  end if;
  return new;
end
$fn$;

drop trigger if exists prevent_self_booking_assignment on public.bookings;
create trigger prevent_self_booking_assignment
before insert or update of provider_id, customer_id on public.bookings
for each row execute function public.prevent_self_booking_assignment();

-- 2. Offers to the customer's own professional record are skipped silently, so
--    matching and rotation carry on with everyone else.
create or replace function public.skip_self_booking_offer()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if exists (
    select 1
    from public.bookings b
    join public.providers p on p.id = new.provider_id
    where b.id = new.booking_id and p.profile_id = b.customer_id
  ) then
    return null;
  end if;
  return new;
end
$fn$;

drop trigger if exists skip_self_booking_offer on public.booking_offer_queue;
create trigger skip_self_booking_offer
before insert on public.booking_offer_queue
for each row execute function public.skip_self_booking_offer();

drop trigger if exists skip_self_booking_offer on public.booking_offers;
create trigger skip_self_booking_offer
before insert on public.booking_offers
for each row execute function public.skip_self_booking_offer();

revoke all on function public.prevent_self_booking_assignment() from public, anon, authenticated;
revoke all on function public.skip_self_booking_offer() from public, anon, authenticated;

commit;
