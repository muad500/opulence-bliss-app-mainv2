-- Client decision (development checklist item 36): stop offering Linen Care,
-- Window Cleaning, and Essential Clean and Linen Care for now.
-- Keep the rows for historical bookings, invoices, payments, and reschedules.

begin;

update public.packages
set active = false
where service_type = 'cleaning'
  and name in ('Linen Care', 'Window Cleaning', 'Essential Clean and Linen Care')
  and active;

commit;
