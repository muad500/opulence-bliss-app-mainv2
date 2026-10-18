# Prepared Production release — NOT executed

This package is held until the user says **merge**. It does not contain credentials.
Production has not been migrated, scheduled, configured, merged or deployed by its preparation.
Real staging email delivery must pass before release. Cleaner pay is decided at £15 per booked cleaning hour. Add-ons and products
are retained by the business, and tips go to the assigned cleaner in full. Saved
booking terms preserve the agreed pay, prices, tip minimum and refund bands. Keep `HANDYMAN_MARKETPLACE_ENABLED=false` and SMS off. The legal patch
`20261003002100` is excluded and remains held.

## Migration order

Git contains **seventeen** required release sources, rather than eight. The additional
source is the scope-notes correction `20261014000500`. Do not discard it or renumber
an applied migration. The installer checks the ledger first: exact matches are
skipped, mismatches stop the release before writes, and missing sources are applied
in one transaction with their original source recorded in the migration ledger.

1. `20261014000100_client_decisions_booking_extras.sql`
2. `20261014000200_per_visit_billing_foundations.sql`
3. `20261014000300_per_visit_checkout.sql`
4. `20261014000400_per_visit_operations.sql`
5. `20261014000500_visit_scope_notes.sql`
6. `20261017000100_assignment_aware_visit_billing.sql`
7. `20261018000100_late_acceptance_card_window.sql`
8. `20261018000200_matching_notice_freshness.sql`
9. `20261018000300_blocked_extras_reconciliation.sql`
10. `20261018000400_private_contact_and_messaging.sql`
11. `20261018000500_professional_insurance_and_address.sql`
12. `20261018000600_account_change_codes.sql`
13. `20261018000700_previous_customers_and_onboarding.sql`
14. `20261018000800_booking_preferences_and_support.sql`
15. `20261018000900_private_contact_windows.sql`
16. `20261018001000_cleaning_pay_and_booking_terms.sql`
17. `20261018001100_setup_is_not_a_visit_charge.sql`

New regular bookings save a card without an initial payment and charge each visit
when a cleaner accepts. Existing bookings retain their saved pricing and charging
model. Release checks must verify £15/hour pay, business-retained extras, a full tip
transfer, unchanged old-booking settings and acceptance-only regular charges.

## Package and preflight

Run `node scripts/prepare-production-visit-release.mjs` to prepare the secret-free
`artifacts/production-visit-release` folder from the committed staging checkout.
`node artifacts/production-visit-release/run.mjs` prints an **offline plan only**.
Its manifest pins the current main, staging commit, migration hashes, worker source
and web patch. If main changes, rebuild and review the package.

The production web patch omits `app/api/staging/**`, the staging fixture library,
staging integration runners, staging reports and all `supabase/staging/**` schedules.
The runner creates a separate checkout from the pinned main, applies that patch,
tests/builds it and pushes only the reviewed production projection. It never blindly
merges staging-only helpers into main. Existing main history is retained.

After explicit merge approval, provide these secure process inputs to the runner;
never put their values in this folder, Git, chat, command arguments or shared logs:

- `RELEASE_AUTHORIZATION=merge`, `RELEASE_REPOSITORY` (absolute reviewed checkout).
- `SUPABASE_ACCESS_TOKEN`, `SUPABASE_CLI` (official installed CLI executable).
- `PRODUCTION_SUPABASE_ANON_KEY`, `PRODUCTION_SUPABASE_SERVICE_ROLE_KEY`.
- `PRODUCTION_STRIPE_SECRET_KEY`, `PRODUCTION_STRIPE_WEBHOOK_ID`.
- `PRODUCTION_VISIT_PAYMENTS_CRON_SECRET` (32+ characters, private).
- `PRODUCTION_RESEND_API_KEY`, `PRODUCTION_BOOKING_EMAIL_FROM`,
  `PRODUCTION_SITE_URL=https://www.opulencebliss.com`.
- `STAGING_EMAIL_TEST_PASSED=yes` only after actual approved test email delivery.
- `PRODUCTION_WEB_ENV_READY=yes` only after separately verifying the web deployment
  uses Production Supabase, the matching live Stripe keys/webhook secret, its approved
  email sender, `CLEANING_PAY_PER_VISIT_ENABLED=true`, and marketplace **false**.
  This runner never pulls or prints Vercel environment settings and never logs in to Vercel.
- `LIVE_WEBHOOK_VERIFIED_EVENT_ID`: a recent real live event with no pending delivery;
  `LIVE_ENDPOINT_HTTP_200_VERIFIED`: the endpoint ID, only after verifying its HTTP 200
  attempt in Stripe Workbench. Do not make a live charge as a health check.

Then run the generated `run.mjs --execute`. Missing inputs and unresolved release
gates stop execution. No execution was performed while preparing this package.

## Sequence after approval

1. Verify account `acct_1UL6n3ILnegr7Mwu`, live mode and enabled Production webhook;
   verify pending deliveries are resolved. Check pinned main has not moved.
2. Apply missing exact-source migrations to **uiqcsihgqaktpjumyeap**; verify all seventeen
   ledger hashes. No broad `db push` and no legal migration.
3. Preserve existing webhook events and add `payment_intent.succeeded`,
   `payment_intent.payment_failed`, `refund.updated`, `customer.updated`.
4. Configure/deploy the pinned `visit-payments` worker with Production's own secrets,
   gateway JWT verification on and its private header guard. Store the matching cron
   credential and anonymous JWT in Production Vault, without printing them.
5. Install `opulence-production-visit-payments`, every five minutes. Observe **two
   automatic HTTP 200 responses** with the reviewed worker source and a fresh
   heartbeat; `per_visit_checkout_ready()` must be true **before the web merge**.
6. Test/build the projected Production tree, push to main, wait for that exact
   release marker and the Vercel automatic Production deployment.
7. Run read-only smoke checks. Record the Production commit/deployment and hashes.

## Smoke checks and stop conditions

- Homepage, `/book`, `/worker` load or redirect to the proper sign-in page.
- `/api/visit-billing-config` returns true; `/api/handyman/config` returns false.
- The staging audit endpoint is absent (404).
- Run `03-database-smoke.sql`: all source hashes match, scheduler active, recent
  successful invocations, fresh heartbeat and checkout ready; no unconfirmed new
  cleaner payouts. Never select Vault values or request headers for proof.
- Signed-in customer/worker screens: paid amounts only for customers, own jobs,
  service approvals, regular visit schedule and add-on controls. Verify a normal
  eligible cleaner can still be matched using a read-only availability query;
  do not manufacture live identity checks or create a live test booking.
- Confirm new email delivery and no duplicate processing from actual normal traffic;
  this is separate from an HTTP reachability check.

A failed backend gate prevents the web push. If a step has already succeeded,
inspect its ledger before resuming. Never blindly retry money operations, undo
live payments or roll back a used schema. Preserve audit history. If a deployment
fails, keep the last working web deployment and diagnose without enabling the marketplace.

This is a prepared package, not evidence that Production has been released or that
an unverified domain can send email. Wix DNS and the actual staging email test are
the remaining external email dependencies.
