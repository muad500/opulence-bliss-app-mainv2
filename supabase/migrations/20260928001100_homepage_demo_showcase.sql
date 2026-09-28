-- Allow clearly labelled fictional examples on the homepage showcase.
-- Demo examples remain unpublished on genuine cleaning-review feeds and do
-- not affect booking reviews or customer rating aggregates.
begin;

alter table public.marketing_reviews
  drop constraint if exists marketing_reviews_no_homepage_samples;
alter table public.marketing_reviews
  add constraint marketing_reviews_homepage_source_or_demo
  check (not homepage_featured or is_demo or source_review_id is not null);

drop policy if exists "public reads featured real marketing reviews"
  on public.marketing_reviews;
create policy "public reads marketing reviews and labelled homepage demos"
on public.marketing_reviews for select to public
using (
  ((published and not is_demo) or homepage_featured)
  and (
    is_demo
    or source_review_id is null
    or exists (
      select 1 from public.reviews source
      where source.id = source_review_id
        and source.reviewer = 'client'
        and source.visibility = 'public'
    )
  )
);

commit;

notify pgrst, 'reload schema';
