-- The cleaning landing page displays only real public reviews of completed
-- cleaning visits, regardless of rating. Admin-entered sample testimonials
-- never enter this feed.
begin;

create or replace function public.cleaning_reviews_feed(p_limit integer default 6)
returns table (
  id uuid,
  rating integer,
  comment text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $fn$
  select r.id, r.rating, r.comment, r.created_at
  from public.reviews r
  join public.bookings b on b.id = r.booking_id
  join public.packages pk on pk.id = b.package_id
  where r.reviewer = 'client'
    and r.visibility = 'public'
    and b.status::text = 'completed'
    and pk.service_type = 'cleaning'
  order by r.created_at desc
  limit least(greatest(coalesce(p_limit, 6), 1), 30);
$fn$;

revoke all on function public.cleaning_reviews_feed(integer) from public;
grant execute on function public.cleaning_reviews_feed(integer) to anon, authenticated;

commit;
notify pgrst, 'reload schema';
