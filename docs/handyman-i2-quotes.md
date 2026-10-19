# I2 — quote-only property maintenance (staging PR)

Branch: `codex/i2-quote-marketplace`. Merge target: `codex/staging` only.
Do not merge/deploy this feature to Production. The server now refuses
marketplace enablement in `VERCEL_ENV=production` or `APP_ENV=production`.
The handyman Stripe factory accepts test keys only, and quote finalisation
rejects live-mode sessions/payments. No hosted environment variables, keys,
databases or deployments are changed by this PR.

## Customer and professional flow

1. An authenticated customer posts a category, description, private photos,
   postcode and preferred dates. Posting has no price/budget/provider field.
   A retry-safe draft is saved before photos are uploaded; publishing sends
   invitations only after the customer has finished uploading.
2. Currently approved professionals for that category and postcode area are
   ranked by customer loyalty, district distance, genuine job/review history,
   response history and reliability. The cleaning wave size/delay settings are
   reused. In-app notices and their wave times are transactionally deduplicated.
   Rankings and competitors' quotes are never disclosed to professionals.
3. A professional proposes a fixed total **including materials**, included work,
   estimated on-site time and earliest appointment, or a **free** site visit.
   Scheduling minutes are never used to calculate a price.
4. The customer supplies the address and accepts the published Handyman Terms,
   then chooses a quote. The job/professional calendar locks select one winner;
   competing quotes close. Stripe Checkout collects the full agreed total on
   the platform. There is no destination charge, hourly billing or added VAT.
   An agreed free visit creates no payment. Its address is private to that
   customer/professional and staff. Unpaid abandoned checkouts expire safely.
5. Only the assigned professional can propose a revision during work. The
   customer explicitly approves its complete revised scope/total. Only the
   increase is charged; a decrease is refunded against the actual original
   funding payments. The revised scope is not applied until settlement, and
   the professional cannot finish while a scope difference is pending.
6. The professional marks work finished. The customer confirms completion, or
   the recovery worker confirms it after the server-recorded 48-hour deadline.
   Open disputes block automatic confirmation and new payouts.
7. Separate transfers pay the assigned professional's snapshotted **own** Stripe
   account. The default commission is 20% of the entire quote, including
   materials; staff can edit it in Settings for newly accepted jobs only.
   Source charges, operation IDs, immutable Checkout parameters, claim tokens
   and Stripe-history reconciliation prevent duplicate charges/refunds/payouts.
8. Cancellation percentages are snapshotted from the editable cleaning refund
   bands at acceptance. Professional cancellations and cancelled unpaid
   checkouts receive full refunds, including a payment racing cancellation.
   Customer cancellation after work starts goes to the resolution desk.

## Safeguards and administration

- Recheck category/area, separate handyman approval, DBS, active account,
  photo ID, current insurance and verified trade certification at submission,
  acceptance and start. Checks must last through the appointment date.
- Self-booking is blocked in matching, locked acceptance and payout validation.
- Cleaning, quote jobs and free visits share calendar locks/conflict and
  capacity checks. Accepting a job posted days ago still reserves its time.
- Missing/changed payout accounts hold the operation with
  `Provider payout account is not configured`. There is no test-account fallback.
- The existing MFA-protected admin resolution desk has a five-case preview,
  full handyman case view, photos, original/revised scopes, actions and payment
  history. Staff resolutions record the actor and reason. Already-paid transfers
  are reversed before customer refunds; remaining funds are reconciled afterward.
  Unknown payout outcomes must be reconciled before resolving/refunding them.
- Verified Stripe card-dispute events also open a handyman resolution case.
  Before new refunds/transfers, the funding charge is checked for card disputes
  and refunds made outside the application. Mismatches stop settlement for review.
- JPEG/PNG uploads are bounded, decoded/resized and stripped of EXIF/GPS. The
  bucket is private; URLs expire. Receipts cannot add charges to a fixed quote.
- Historical hourly columns, migrations and the old payment-recovery module
  remain for audit/recovery of pre-existing authorisations. They are not used
  for new jobs. The old reservation RPC is revoked and new legacy inserts fail.
  Hourly calculators, rate-setting writes and rate-based listing/approval gates
  have been removed from the active application.

## Hidden categories and legal release

The six existing categories remain. Plumbing, Bathroom installations, Kitchen
installations and Emergency repairs exist in `handyman_categories`, but have
`required_terms_version='UNPUBLISHED'` and are absent from the public config/UI.
The server and database reject posting or quoting them directly as well.

Do not unlock a trade merely because an unrelated legal edit is published.
A subsequent approved release must bind each category's `required_terms_version`
to the **new published** `handyman-terms` version that actually covers it, and
extend professional category selection/certification requirements accordingly.
Unpublishing/mismatching that version fails closed. This PR changes no legal wording.

## Migration and staging verification

Apply `20261020000200_handyman_quote_marketplace.sql` to the isolated staging
database only, with the marketplace switch off. It is after staging's latest
`20261020000100` migration. The approval prerequisite patch deliberately fails
if the upstream function has drifted, preserving its MFA/evidence guards.

The existing authenticated `GET /api/cron/handyman-payments` now runs both
legacy authorisation recovery and the quote worker. The **staging scheduler**
must call it regularly (recommended every minute) for invitation waves,
48-hour confirmation, abandoned-checkout cancellation and financial retries.
Confirm an actual scheduled run before declaring background operation ready.
No scheduler, credential, webhook registration or hosted migration was changed.
The existing signed Stripe webhook recognises `kind=handyman_quote`.

Automated checks:

- `npm test`: full existing suite plus quote money/security regression fixtures.
- `npx tsc --noEmit`, changed-file ESLint and an offline application build.
- `psql -v ON_ERROR_STOP=1 -f supabase/tests/0024_handyman_quote_marketplace.sql`
  **only in an empty isolated test database**. The fixture creates its own roles,
  schema and synthetic evidence; never execute it on staging or Production.
- `.github/workflows/handyman-quotes-staging.yml` runs isolated PostgreSQL 17
  and Stripe-fixture checks for the staging PR without hosted credentials.

Hosted Stripe test-mode acceptance still required after review/migration:
post/photos → ranked notices → competing quote/free visit → acceptance/full
payment → on-site revision up/down → completion/customer/48h → own-account
payout. Include simultaneous acceptance, cancellation/payment races, missing
payout accounts, lost acknowledgements, repeated callbacks, disputes before
payout and partial refunds after payout. Verify transfers in Stripe test mode;
fixtures are not evidence of live/test-account delivery or real verification.

References: [Stripe separate charges and transfers](https://docs.stripe.com/connect/separate-charges-and-transfers),
[Checkout fulfilment](https://docs.stripe.com/checkout/fulfillment).
