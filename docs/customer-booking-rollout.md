# Customer booking changes

Cleaning sessions run from 2 to 8 hours in 30-minute increments between 07:00 and 20:00 Europe/London. The full visit must finish by 20:00, so the latest available start depends on its duration.

Pricing is proportional to the selected package's original price and duration, rounded to pence. Promotional previews and checkout use the same calculation. The property-size estimate uses 35 m² per cleaner-hour, rounded up to a half hour and clamped to 2–8 hours; customers can override the estimate. Properties above 280 m² show a multiple-visit advisory. This estimate should be calibrated with the cleaning team.

Returning customers can request a cleaner from a completed cleaning visit. The request moves that cleaner to the front of the queue only if the cleaner still passes service-area, service, vetting and fee checks; acceptance remains required.

Customer and cleaner booking details use the paid duration snapshot. Session countdowns start at recorded check-in; reaching zero does not automatically finish or charge a booking. Customer profile ratings use existing cleaner reviews.

## Before enabling in production

1. Apply the three `20260906*` Supabase migrations to a staging copy with the existing base schema and migrations, then run the SQL smoke checks below. These migrations do not reconstruct the original base schema, which is not included in this repository.
2. Publish the actual business Terms & Conditions and Privacy Policy. Set `NEXT_PUBLIC_TERMS_URL` and `NEXT_PUBLIC_PRIVACY_URL` to those URLs before building. Signup is deliberately unavailable until both are configured; no policy text or customer consent is invented.
3. Set `RESEND_API_KEY`, `BOOKING_EMAIL_FROM` (a verified address such as `Opulence Bliss <no-reply@YOUR_VERIFIED_DOMAIN>`), and HTTPS `NEXT_PUBLIC_SITE_URL`.
4. Set `CRON_SECRET` in the application. Set matching Supabase Vault secret `opulence_cron_secret` and `opulence_app_origin` to this deployment's HTTPS origin. The migration schedules delivery every minute using the existing pg_cron and pg_net extensions. Check cron execution and HTTP responses; a missing Vault setting prevents delivery.
5. Confirm Stripe sends signed `checkout.session.completed` events to `/api/stripe/webhook`. Booking finalisation runs from both the webhook and browser return with one checkout reference, and webhook failures return HTTP 500 for retry. Configure `STRIPE_WEBHOOK_SECRET`.
6. Deploy code and migrations together during a quiet checkout period. New checkouts are tied to the signed-in customer ID; in-flight checkouts created before this change do not have that metadata. Finish those first.
7. Validate Stripe test checkout, both customer signup paths, cleaner acceptance, and the private upload/notification flows before merging or enabling production traffic.

SMS is deferred at the owner's request. No SMS provider is configured or called.

## Delivery behavior

Booking receipt and cleaner acceptance enqueue no-reply email and create app notifications. Confirmed bookings enqueue 24-hour and 90-minute reminders; reminders whose thresholds have already passed at confirmation are skipped. A recorded check-in schedules the 30-minute-remaining alert. Rescheduling or cancellation invalidates obsolete pending notices. Existing bookings created before the migrations are not sent retrospective receipt notices.

Email claims use row locks, claim tokens, short leases, bounded retries and a stable Resend idempotency key. Missing email configuration does not consume retries; app notifications can still be dispatched. Failed email records remain available to administrators via SQL. This is delivery submission to Resend, not proof that a recipient opened an email.

Attachments use a private 10 MB Storage bucket, participant policies and short-lived signed URLs. JPG, PNG, WebP and PDF are supported. Posted files cannot be deleted through the uploader cleanup policy. No malware-scanning service is included.

Current staging tips have a £3 minimum and go in full to the assigned professional's
own Stripe account. New cleaning pay calculations remain held pending the client's
rate decision; the legacy rollout notes above do not override the current
per-visit release gates in `production-visit-release.md`.

## Verification

Run `npm ci`, `npm test`, `npx tsc --noEmit`, and the customer-booking GitHub workflow. Pure tests cover duration boundaries, pricing, size estimates, London time/DST, and existing booking-state projections.

Staging integration checks:

- A 2.5-hour clean costs 1.25 times a 2-hour package; invalid duration/size requests fail at checkout. Try a start that finishes exactly at 20:00, one that finishes after 20:00, 06:30 and 12:45.
- Refresh the successful Stripe checkout concurrently; exactly one booking/payment and one initial queue should exist.
- Verify a previous cleaner is requested first only when eligible; a provider ID from someone else's history is rejected.
- Test receipt, acceptance, reminders and 30-minute alerts with shortened staging-only due times. Invoke the cron twice concurrently and verify one app notification per event, one email submission per idempotency key, and reschedule/cancel invalidation.
- Disable email settings, run cron, restore them and verify email attempts were preserved. Inspect failed deliveries and cron HTTP failures.
- Upload an image and PDF from each participant. Verify another user cannot read/download/upload, and a sender cannot remove a posted file after losing booking access.
- Verify consent cannot be omitted from either customer signup form or the customer signup endpoint, and consent evidence is recorded in `signup_consents`.
