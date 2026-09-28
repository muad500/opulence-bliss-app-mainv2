-- Only the customer or the assigned professional on a completed booking can
-- review it, and each of them only once (development checklist item 67).
--
-- The review forms only appear after a visit is completed, but the server
-- actions insert directly, and the original rules on the reviews table are not
-- in this repository. Enforcing eligibility here keeps fake or unearned
-- reviews out whatever the client sends, which the DMCC Act expects traders to
-- take reasonable steps to do, and it makes the Review Policy's statement that
-- reviews are left after a visit true in the database as well.
--
-- All inserts, including admin and server inserts, must meet these rules.

begin;

create or replace function public.enforce_review_eligibility()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_booking public.bookings;
begin
  if v_uid is null then
    raise exception 'Sign in to leave a review.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_booking from public.bookings where id = new.booking_id;
  if not found then
    raise exception 'A review must belong to a booking.' using errcode = 'check_violation';
  end if;
  if v_booking.status::text <> 'completed' then
    raise exception 'You can review a visit once it is completed.' using errcode = 'check_violation';
  end if;

  if new.reviewer = 'client' then
    if v_booking.customer_id is distinct from v_uid then
      raise exception 'Only the customer on this booking can review it.' using errcode = 'insufficient_privilege';
    end if;
  elsif new.reviewer = 'provider' then
    if not exists (
      select 1 from public.providers p
      where p.id = v_booking.provider_id and p.profile_id = v_uid
    ) then
      raise exception 'Only the professional on this booking can review it.' using errcode = 'insufficient_privilege';
    end if;
  else
    raise exception 'Unknown reviewer.' using errcode = 'check_violation';
  end if;

  -- Serialize concurrent submissions for the same booking and reviewer so a
  -- simultaneous retry cannot pass the duplicate check twice.
  perform pg_advisory_xact_lock(hashtextextended(new.booking_id::text || ':' || new.reviewer::text, 0));
  if exists (
    select 1 from public.reviews r
    where r.booking_id = new.booking_id and r.reviewer = new.reviewer
  ) then
    raise exception 'This visit has already been reviewed.' using errcode = 'unique_violation';
  end if;

  return new;
end
$fn$;

drop trigger if exists enforce_review_eligibility on public.reviews;
create trigger enforce_review_eligibility
before insert on public.reviews
for each row execute function public.enforce_review_eligibility();

revoke all on function public.enforce_review_eligibility() from public, anon, authenticated;

commit;
