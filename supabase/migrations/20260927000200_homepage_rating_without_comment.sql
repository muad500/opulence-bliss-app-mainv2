-- A customer's public star rating can be highlighted even without a comment.
-- Never synthesize a quote; the UI explicitly says when no comment was written.
create or replace function public.homepage_review_highlights_feed()
returns table (
  id uuid,
  rating integer,
  comment text,
  recipient_name text
)
language sql
stable
security definer
set search_path = public
as $fn$
  select r.id, r.rating, r.comment,
    coalesce(nullif(trim(p.display_name), ''), 'Opulence professional') as recipient_name
  from public.homepage_review_highlights h
  join public.reviews r on r.id = h.review_id
  join public.bookings b on b.id = r.booking_id
  left join public.providers p on p.id = b.provider_id
  where r.visibility = 'public'
    and r.reviewer = 'client'
    and r.rating >= 4
  order by h.selected_at, h.review_id
  limit 3;
$fn$;

revoke all on function public.homepage_review_highlights_feed() from public;
grant execute on function public.homepage_review_highlights_feed() to anon, authenticated;

notify pgrst, 'reload schema';
