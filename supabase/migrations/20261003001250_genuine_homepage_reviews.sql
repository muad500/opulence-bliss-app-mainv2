-- Homepage reviews must be real and unedited (development checklist items 87
-- and 88), and two FAQ answers the client corrected are restored (81 and 82).
--
-- 87. Fictional "illustrative" reviews can no longer be shown or published.
--     Showing invented reviews in a customer reviews section risks misleading
--     people even with a label.
-- 88. A testimonial copied from a booking review always shows the customer's
--     own rating, words and date, whatever is submitted. A changed rating,
--     changed words or words written for a customer would present a review
--     the customer did not give, which the DMCC Act treats as a fake review.
--     Admins can still choose where a review appears.

begin;

-- 87. No fictional examples on the site.
update public.marketing_reviews
set homepage_featured = false,
    published = false,
    updated_at = now()
where is_demo and (homepage_featured or published);

alter table public.marketing_reviews
  drop constraint if exists marketing_reviews_homepage_admin_or_source;
alter table public.marketing_reviews
  drop constraint if exists marketing_reviews_homepage_real_only;
alter table public.marketing_reviews
  add constraint marketing_reviews_homepage_real_only check (
    not homepage_featured
    or (not is_demo and (source_review_id is not null or created_by is not null))
  );

drop policy if exists "public reads marketing reviews and labelled homepage demos"
  on public.marketing_reviews;
drop policy if exists "public reads featured real marketing reviews"
  on public.marketing_reviews;
create policy "public reads featured real marketing reviews"
on public.marketing_reviews
for select to public
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

-- 88. Copied booking reviews always match the original.
create or replace function public.keep_copied_review_faithful()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_source public.reviews;
begin
  if new.source_review_id is null then
    return new;
  end if;
  select * into v_source from public.reviews where id = new.source_review_id;
  if not found then
    raise exception 'The original booking review no longer exists.' using errcode = 'check_violation';
  end if;
  new.rating := v_source.rating;
  new.comment := coalesce(nullif(btrim(v_source.comment), ''), 'Rating shared without a written comment.');
  new.customer_name := 'Verified customer';
  new.location := null;
  new.reviewed_at := v_source.created_at::date;
  new.is_demo := false;
  return new;
end
$fn$;

drop trigger if exists keep_copied_review_faithful on public.marketing_reviews;
create trigger keep_copied_review_faithful
before insert or update on public.marketing_reviews
for each row execute function public.keep_copied_review_faithful();

revoke all on function public.keep_copied_review_faithful() from public, anon, authenticated;

-- Restore any existing copies to the customer's original rating and words.
update public.marketing_reviews set updated_at = now() where source_review_id is not null;

-- 81. Restore the two FAQ questions with the client's corrected answers.
insert into public.faqs (category, question, answer, published, sort_order)
select 'general', 'Are professionals vetted?',
       'Yes. All our cleaning professionals are vetted before they can take bookings.', true, 900
where not exists (select 1 from public.faqs where lower(btrim(question)) = 'are professionals vetted?');

insert into public.faqs (category, question, answer, published, sort_order)
select 'general', 'Can I send photos or files to my professional?',
       'Yes. You can share photos in your booking chat (JPG, PNG or WebP, up to 10 MB). Please only share photos related to your booking or the cleaning.', true, 901
where not exists (select 1 from public.faqs where lower(btrim(question)) = 'can i send photos or files to my professional?');

-- 82. Say how regular bookings work.
update public.faqs
set answer = btrim(answer) || ' A regular booking is 6 to 10 visits booked and paid for together.',
    updated_at = now()
where lower(btrim(question)) = 'can i book a one-off or recurring service?'
  and answer not ilike '%6 to 10%';

commit;

notify pgrst, 'reload schema';
