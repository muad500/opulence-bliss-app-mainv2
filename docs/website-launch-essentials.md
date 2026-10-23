# Customer website launch essentials — 23 October 2026

New cleaning checkouts record the exact policy wording and document copies accepted, and email those copies to the account email address. One regular checkout creates one contract email listing its visits. The existing operational confirmation/reminder emails retain their own preferences and delivery path.

## Implemented

- Shared wording for the visible legal/saved-card checkboxes and the server record. Early-start evidence uses the existing shared wording.
- Server-side identity snapshot, UTC acceptance time, Vercel's trusted forwarding IP (or null outside that host), user agent, versions, original HTML, displayed HTML and content fingerprints.
- Database rejection of stale/tampered sources, duplicate or unchecked consents, and attempts to rewrite saved booking evidence.
- Customer downloads from the booking; staff evidence and delivery-status page behind the existing authenticator requirement, with a separate same-host staff download API.
- Three policy PDF attachments and a model cancellation form. Every page is rendered; no excerpt/truncation is used. The original HTML remains available in the account data export.
- A dedicated essential-email queue with claims, backoff, saved payloads and stable Resend idempotency keys. Attempts older than 23 hours require provider-log review, avoiding a second send beyond Resend's 24-hour idempotency window.
- Existing checkout copy fixes: one-off “Book and pay £…”, “No VAT is charged”, and footer contact email.

The email attaches the versions served by the current legal pages. This PR does not publish the new client policy pack or invent versions, dates or historic acceptances. Publication still needs the client's cancellation/rescheduling answers and accurate privacy/cookie wording. It also does not implement the rewards, business contracts or handyman financial changes described in the pack.

## Migration and deployment order

1. Compare the staging migration ledger to the repository before writing. Required existing versions are `20261021000200`, `20261021000300` and the latest staging migration `20261023000100`. Inspect any ledger entry for `20261023000200`; compare its stored source to this exact file, stop on any mismatch, and skip only an identical already-applied source.
2. Apply **only** `supabase/migrations/20261023000200_booking_legal_evidence.sql` to staging project **comwdjprdedmsnxtvuuk**. Its source SHA-256 is `252c5c0235d508b7426f2dfd0c6367c599a8adfa1b7fe0760dbd79b9e2672b86`. Preserve the exact source in the migration ledger. The transaction is additive and leaves the old checkout writer available.
3. Deploy the branch to a staging Preview. New web code requires `checkout_legal_evidence_ready()`; an incomplete installation blocks new checkout before a Stripe session is created.
4. Use the existing verified no-reply sender, `RESEND_API_KEY`, HTTPS `NEXT_PUBLIC_SITE_URL` and booking-notifications scheduler. No new key or schedule is required. Staging contract mail additionally requires the exact test mailbox in `STAGING_EMAIL_RECIPIENTS`.
5. Complete the hosted checks below before merging/releasing. The production operator must repeat ledger/source checks and apply the additive migration before the web release in their own coordinated release window.

For the first staging inspection, run `supabase/staging/booking-legal-preflight.sql` in the named staging dashboard. It is read-only and reports ledger source hashes, installed functions, published versions, scheduler and Vault presence without revealing secret values. Any ledger mismatch requires inspection, not a repair or an automatic skip. This Preview and the stable staging URL currently redirect unauthenticated requests to Vercel protection; keep that protection enabled and use the existing staging session/bypass for tests.

The 19 October staging configuration report records `Opulence Bliss Staging <staging@opulencebliss.com>`, whereas both the existing booking-email route and this contract queue deliberately require a no-reply sender. Verify the deployed setting and, if still necessary, set only the Preview sender to a verified `no-reply@opulencebliss.com` address before the delivery check. No sender or key was changed here. Also check the actual booking-email scheduler includes the existing Preview bypass; an HTTP redirect is not a successful delivery. The new branch Preview does not replace the stable staging cron target, so test its protected route explicitly before changing or merging the stable release.

The branch push triggered a successful automatic Vercel Preview build. No hosted migration, direct deployment, production access, real payment or external email send was performed from this checkout. Saved staging credentials and a connected staging dashboard were unavailable. The code is prepared for the deployment owner to run those checks.

## Verification

Completed locally:

- Full repository test command, TypeScript, and targeted ESLint (one pre-existing `billingPrices` hook warning in `app/book/page.tsx`).
- Next.js **16.4.2** production build with inert staging-shaped environment values.
- Offline PostgreSQL integration: apply both original consent migrations and the new migration; reject browser calls and altered documents; preserve built-in fallback without publishing a legal row; one-off and six-visit series linkage; immutable snapshots; other-customer and password-only staff rejection; TOTP staff access; claim/retry/token handling; old-checkout compatibility.
- Email transport tests with a stub provider: four valid PDF attachments, exact persisted payload reuse, stable idempotency key, configuration/allowlist failure, optional-email preference independence, customer and staff download gates.
- Generated current-policy copies and cancellation form rendered and inspected on first/middle/last pages. PDF creation is deterministic for retries and long-document tests cover pagination.

PR #47 also passed the GitHub security and isolated-database checks; its automatic Vercel Preview build passed. Those checks do not replace testing against the hosted staging database and email service.

To rerun the PostgreSQL test, install `@electric-sql/pglite@0.5.11` into a temporary directory (not the app) and pass its absolute `dist/index.js` path:

```sh
LEGAL_PGLITE_MODULE=/absolute/temp/node_modules/@electric-sql/pglite/dist/index.js node scripts/test-booking-legal-database.mjs
```

Hosted staging checks still required:

1. Required checkbox blocks one-off and regular checkout; all three links open in a new tab; saved-card and early-start checks still work.
2. Complete one Stripe test one-off checkout and one regular setup checkout. Verify three `account_legal_acceptances` rows per visit, all pointing to their original snapshot; a series produces one contract email.
3. Confirm delivery to the allowlisted test mailbox. Check all four attachments, reply-to, versions and dates; then turn off optional booking emails or select SMS and confirm the contract email still sends once.
4. Confirm downloads work on the customer website and the separate staff host. Another customer and staff without MFA must be denied. Check the expanded evidence in “Download my data”.
5. Change a policy only on staging after test acceptance, then verify the existing booking still downloads the original version. Old bookings must show their existing acceptance records without newly invented copies/emails.
6. Invoke the existing scheduler twice: a sent contract email stays sent. Inspect failed/needs-review records in the staff booking evidence page; check Resend delivery before any manual retry.

Automated contract-record retention and the wider professional/partner onboarding requirements are outside this small customer-checkout release; their status remains in the client launch checklist.
