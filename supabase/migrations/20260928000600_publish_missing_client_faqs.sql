-- The client-correction answer updates targeted questions that were never
-- seeded on this project. Add them as normal, admin-editable FAQ entries.
begin;

update public.faqs
set answer = 'Yes. Book a one-off clean when you need it, or choose weekly, every two weeks or monthly regular cleaning. The regular rate requires 6 to 10 visits booked together, and you can book more visits later.',
    updated_at = now()
where lower(trim(question)) = 'can i book a one-off or recurring service?';

insert into public.faqs (category, question, answer, sort_order)
select seed.category, seed.question, seed.answer, seed.sort_order
from (values
  (
    'booking_pricing',
    'Can I send photos or files to my professional?',
    'Yes. You can share JPG, PNG or WebP photos related to your cleaning booking in the booking chat, up to 10 MB. PDF files are not accepted.',
    70
  ),
  (
    'quality',
    'Are professionals vetted?',
    'Yes. All our cleaning professionals are vetted before they can take bookings.',
    40
  ),
  (
    'general',
    'Can I arrange regular cleaning?',
    'Yes. Choose weekly, every two weeks or monthly when you book, and book 6 to 10 visits together. You can book more visits later.',
    25
  )
) as seed(category, question, answer, sort_order)
where not exists (
  select 1 from public.faqs existing
  where lower(trim(existing.question)) = lower(trim(seed.question))
);

commit;
