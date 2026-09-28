-- Admin-entered feedback may be a genuine customer review even when it did
-- not originate from an in-app booking. Keep the source reference required
-- only for booking-backed reviews; created_by identifies the admin who added
-- a manually sourced review.
begin;

alter table public.marketing_reviews
  drop constraint if exists marketing_reviews_homepage_source_or_demo;
alter table public.marketing_reviews
  add constraint marketing_reviews_homepage_admin_or_source
  check (
    not homepage_featured
    or is_demo
    or source_review_id is not null
    or created_by is not null
  );

commit;

notify pgrst, 'reload schema';
