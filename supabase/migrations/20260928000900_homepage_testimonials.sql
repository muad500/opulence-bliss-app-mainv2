-- Allow admins to feature genuine, editable customer testimonials on the
-- homepage without changing the original booking-review records.
begin;

alter table public.marketing_reviews
  add column if not exists homepage_featured boolean not null default false;

alter table public.marketing_reviews
  add column if not exists source_review_id uuid
  references public.reviews(id) on delete cascade;

alter table public.marketing_reviews
  add constraint marketing_reviews_no_homepage_samples
  check (not homepage_featured or (not is_demo and source_review_id is not null));

drop policy if exists "public reads published real marketing reviews"
  on public.marketing_reviews;
create policy "public reads featured real marketing reviews"
on public.marketing_reviews for select to public
using (
  (published or homepage_featured)
  and not is_demo
  and (
    source_review_id is null
    or exists (
      select 1 from public.reviews source
      where source.id = source_review_id
        and source.reviewer = 'client'
        and source.visibility = 'public'
    )
  )
);

create index if not exists marketing_reviews_homepage_idx
  on public.marketing_reviews(homepage_featured, sort_order, reviewed_at desc)
  where homepage_featured;

create unique index if not exists marketing_reviews_source_review_idx
  on public.marketing_reviews(source_review_id)
  where source_review_id is not null;

commit;

notify pgrst, 'reload schema';
