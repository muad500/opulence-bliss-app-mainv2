-- Keep public help aligned without changing any previously accepted contract.
begin;
update public.faqs set answer='New bookings can be rescheduled free with at least 48 hours'' notice, subject to availability. With less notice, the original visit''s agreed cancellation charge applies; cancel and rebook, or contact support. Existing bookings keep their original agreed terms. Use My bookings to check the available changes.'
where lower(trim(question)) in ('can i reschedule my appointment?','can i change my booking?')
  and category<>'handyman';
-- The topic is unchanged; retain its existing retrieval vector. The next
-- protected assistant seed will refresh the embedding from this same guidance.
update public.ai_docs set content='New bookings can be rescheduled free with at least 48 hours'' notice, subject to availability. With less notice, the original visit''s agreed cancellation charge applies; cancel and rebook, or contact support. Existing bookings keep their original agreed terms. Use My bookings to check the available changes. Cancellation follows the policy accepted for that booking. The final-pack policy uses 0/25/50/up to 70% charges on the booking price, excluding tips, with a 12-hour band and a 15-minute no-access wait. The 14-day cancellation right remains separate and can entitle a customer to a full refund before work starts. Older bookings keep their original basis, bands and waiting period. Always use the live cancellation preview and reschedule window, and require confirmation before a change. Staff can reduce a charge; a cleaner can waive their compensation.'
where title='Cancelling and rescheduling';
commit;
