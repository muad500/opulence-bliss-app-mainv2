-- Reviews and ratings shown to the public must not leave out negative reviews.
-- Under the Digital Markets, Competition and Consumers Act 2024 (Schedule 20),
-- suppressing negative reviews, or presenting ratings that exclude them, is a
-- banned practice. Until now:
--   * a customer's 1-3 star review of a cleaner was forced private, even when
--     the customer asked for it to be public;
--   * each cleaner's public rating counted only public 4 and 5 star reviews;
--   * the public review feed showed only 4 and 5 star customer reviews;
--   * published marketing testimonials had to be 4 or 5 stars.
--
-- From now on the reviewer decides whether their own review text is public,
-- whatever the rating, and public ratings count every customer review.
--
-- Existing private reviews stay private. Customers were told that 1-3 star
-- feedback would never appear publicly, so their text is not made public now.
-- Their star ratings are included in averages, which reveals no text.

begin;

-- 1. Honour the reviewer's own choice of visibility.
create or replace function public.enforce_review_visibility()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if new.visibility <> 'public' then
    new.visibility := 'private';
  end if;
  return new;
end
$fn$;

-- 2. Public ratings count every customer review. Copied unchanged from
--    20260908000200 apart from the two subqueries for the public figures.
create or replace function public.recompute_review_ratings(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_provider_id uuid;
  v_customer_id uuid;
begin
  select provider_id, customer_id
    into v_provider_id, v_customer_id
  from public.bookings
  where id = p_booking_id;

  if v_provider_id is not null then
    update public.providers p
    set rating_avg = (
          select avg(r.rating)::numeric(3,2)
          from public.reviews r
          join public.bookings b on b.id = r.booking_id
          where b.provider_id = v_provider_id and r.reviewer = 'client'
        ),
        rating_count = (
          select count(*)::integer
          from public.reviews r
          join public.bookings b on b.id = r.booking_id
          where b.provider_id = v_provider_id and r.reviewer = 'client'
        ),
        public_rating_avg = (
          select avg(r.rating)::numeric(3,2)
          from public.reviews r
          join public.bookings b on b.id = r.booking_id
          where b.provider_id = v_provider_id
            and r.reviewer = 'client'
        ),
        public_rating_count = (
          select count(*)::integer
          from public.reviews r
          join public.bookings b on b.id = r.booking_id
          where b.provider_id = v_provider_id
            and r.reviewer = 'client'
        )
    where p.id = v_provider_id;
  end if;

  if v_customer_id is not null then
    update public.profiles pr
    set client_rating_avg = (
          select avg(r.rating)::numeric(3,2)
          from public.reviews r
          join public.bookings b on b.id = r.booking_id
          where b.customer_id = v_customer_id and r.reviewer = 'provider'
        ),
        client_rating_count = (
          select count(*)::integer
          from public.reviews r
          join public.bookings b on b.id = r.booking_id
          where b.customer_id = v_customer_id and r.reviewer = 'provider'
        )
    where pr.id = v_customer_id;
  end if;
end
$fn$;

revoke all on function public.recompute_review_ratings(uuid)
  from public, anon, authenticated;

-- 3. Recalculate every cleaner's public rating from all customer reviews.
update public.providers p
set public_rating_avg = (
      select avg(r.rating)::numeric(3,2)
      from public.reviews r
      join public.bookings b on b.id = r.booking_id
      where b.provider_id = p.id
        and r.reviewer = 'client'
    ),
    public_rating_count = (
      select count(*)::integer
      from public.reviews r
      join public.bookings b on b.id = r.booking_id
      where b.provider_id = p.id
        and r.reviewer = 'client'
    );

-- 4. The public feed shows every public review, whatever the rating.
--    Copied unchanged from 20260911000100 apart from the rating condition.
create or replace function public.public_reviews_feed(p_limit integer default 60)
returns table (
  id uuid,
  reviewer text,
  rating integer,
  comment text,
  created_at timestamptz,
  recipient_name text,
  recipient_type text
)
language sql
stable
security definer
set search_path = public
as $fn$
  select
    r.id,
    r.reviewer,
    r.rating,
    r.comment,
    r.created_at,
    case
      when r.reviewer = 'client'
        then coalesce(nullif(trim(p.display_name), ''), 'Opulence professional')
      else 'Verified client'
    end as recipient_name,
    case when r.reviewer = 'client' then 'professional' else 'client' end
      as recipient_type
  from public.reviews r
  join public.bookings b on b.id = r.booking_id
  left join public.providers p on p.id = b.provider_id
  where r.visibility = 'public'
  order by r.created_at desc
  limit least(greatest(coalesce(p_limit, 60), 1), 100);
$fn$;

revoke all on function public.public_reviews_feed(integer) from public;
grant execute on function public.public_reviews_feed(integer)
  to anon, authenticated;

-- 5. An honest overall score for the services page: the average and count of
--    every customer review for that service. It returns only the two numbers,
--    so no private review text is exposed.
create or replace function public.public_review_summary(p_service_type text default 'cleaning')
returns table (rating_avg numeric, rating_count integer)
language sql
stable
security definer
set search_path = public
as $fn$
  select avg(r.rating)::numeric(3,2), count(*)::integer
  from public.reviews r
  join public.bookings b on b.id = r.booking_id
  join public.packages pk on pk.id = b.package_id
  where r.reviewer = 'client'
    and pk.service_type = p_service_type;
$fn$;

revoke all on function public.public_review_summary(text) from public;
grant execute on function public.public_review_summary(text) to anon, authenticated;

-- 6. Marketing testimonials: any rating may be published, but a prototype
--    sample never may, since publishing reviews that are not from real
--    customers is itself banned. Samples now default to off.
update public.marketing_reviews
set published = false,
    updated_at = now()
where published and is_demo;

alter table public.marketing_reviews alter column is_demo set default false;

alter table public.marketing_reviews
  drop constraint if exists marketing_reviews_positive_when_published;
alter table public.marketing_reviews
  add constraint marketing_reviews_no_published_samples
  check (not (published and is_demo));

drop policy if exists "public reads published positive marketing reviews" on public.marketing_reviews;
create policy "public reads published real marketing reviews"
on public.marketing_reviews
for select to public
using (published and not is_demo);

commit;

notify pgrst, 'reload schema';
