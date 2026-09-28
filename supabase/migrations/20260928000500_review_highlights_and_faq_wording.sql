-- Keep homepage highlights to genuine positive booking reviews while every
-- public review remains available on the full reviews page. Update the FAQ
-- language to match photo-only chat and six-visit regular bookings.
begin;

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
  limit 6;
$fn$;

revoke all on function public.homepage_review_highlights_feed() from public;
grant execute on function public.homepage_review_highlights_feed() to anon, authenticated;

update public.faqs
set answer = 'Yes. You can share JPG, PNG or WebP photos related to your cleaning booking in the booking chat, up to 10 MB. PDF files are not accepted.',
    updated_at = now()
where lower(trim(question)) = 'can i send photos or files to my professional?';

update public.faqs
set answer = 'Yes. All our cleaning professionals are vetted before they can take bookings.',
    updated_at = now()
where lower(trim(question)) = 'are professionals vetted?';

update public.faqs
set answer = 'Yes. Choose weekly, every two weeks or monthly when you book, and book 6 to 10 visits together. You can book more visits later.',
    updated_at = now()
where lower(trim(question)) = 'can i arrange regular cleaning?';

commit;

notify pgrst, 'reload schema';
