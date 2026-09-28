-- A single captured PaymentIntent funds every visit in an upfront regular
-- series. Preserve one-row-per-intent uniqueness for ordinary payments while
-- allowing one allocation per booking in the regular series.
begin;

create unique index payments_single_stripe_ref_key
  on public.payments (stripe_payment_ref)
  where (split_breakdown ->> 'upfront_series_id') is null;

create unique index payments_regular_ref_booking_key
  on public.payments (stripe_payment_ref, booking_id)
  where (split_breakdown ->> 'upfront_series_id') is not null;

drop index public.payments_stripe_ref_key;

commit;
