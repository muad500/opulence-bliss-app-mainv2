-- Show one consistent cleaning score in the footer and cleaning page. Include
-- genuine admin-entered customer feedback when it is visible on a public page,
-- but never count a marketing copy of a booking review twice or demo content.
begin;

create or replace function public.public_review_summary(p_service_type text default 'cleaning')
returns table (rating_avg numeric, rating_count integer)
language sql
stable
security definer
set search_path = public
as $fn$
  with customer_ratings as (
    select r.rating::numeric as rating
    from public.reviews r
    join public.bookings b on b.id = r.booking_id
    join public.packages pk on pk.id = b.package_id
    where r.reviewer = 'client'
      and pk.service_type = p_service_type

    union all

    select m.rating::numeric as rating
    from public.marketing_reviews m
    where m.service_type = p_service_type
      and not m.is_demo
      and m.source_review_id is null
      and m.created_by is not null
      and (m.published or m.homepage_featured)
  )
  select avg(rating)::numeric(3,2), count(*)::integer
  from customer_ratings;
$fn$;

revoke all on function public.public_review_summary(text) from public;
grant execute on function public.public_review_summary(text) to anon, authenticated;

commit;
