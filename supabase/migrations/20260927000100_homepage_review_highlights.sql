-- Admin-selected highlights are separate from the complete public review feed.
-- A highlight may only expose an actual public, positive customer booking review.
begin;

create table public.homepage_review_highlights (
  review_id uuid primary key references public.reviews(id) on delete cascade,
  selected_at timestamptz not null default now(),
  selected_by uuid references auth.users(id) on delete set null
);

alter table public.homepage_review_highlights enable row level security;

create policy "admins manage homepage review highlights"
on public.homepage_review_highlights
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

grant select, insert, delete on public.homepage_review_highlights to authenticated;

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
    and nullif(trim(r.comment), '') is not null
  order by h.selected_at, h.review_id
  limit 3;
$fn$;

revoke all on function public.homepage_review_highlights_feed() from public;
grant execute on function public.homepage_review_highlights_feed() to anon, authenticated;

commit;

notify pgrst, 'reload schema';
