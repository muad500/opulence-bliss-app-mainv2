# Regular booking controls and extra hours: Production release plan

Status: prepared only. A fresh owner go and clear Production slot are required before database changes, merging or deployment. Production base is b532955.

## Source and scope

- Bring the feature changes from staging bf6fabad onto the clean Production base.
- The assigned-cleaner correction a36acd36 is already live as b532955. Preserve it without applying a duplicate fix.
- Include migrations 20261031000200 through 20261031000700, unchanged from the staging-tested sources.
- Exclude the staging baseline, staging-only SQL/schedules, inspector, staging preparation script and staging report. Do not change marketplace code, its Production switch, SMS, legal documents, credentials or webhook configuration.
- No Booking Credit, new cleaner contract, or new payment engine is included.

## User behaviour

A customer can review and confirm pause/end for a regular booking. Accepted or paid future visits cancel under each visit's accepted cancellation policy. The review lists refunds and retained charges before confirmation. Unassigned unpaid visits can stay paused. Started work is unchanged. Resume only restarts eligible remaining visits; cancelled visits do not revive. End is permanent. Charges and recovery respect pause/end state. Resuming renews ranked offer waves once, preserving qualification, calendars, deadlines and notification preferences.

An assigned, approved cleaner can offer extra cleaning time in 30-minute steps. The customer approves the exact price and pays before extra work starts. The original booked hourly price and cleaner-pay snapshot are preserved. Add-ons plus cleaning cannot exceed eight hours. Calendar time is reserved before payment. A decline restores the original paid visit. Retries and delayed captures use the existing recoverable operations, without double charging. A captured result after closure enters refund recovery and does not add time or pay.

## Reviewed staging evidence

553 tests, typecheck and build passed. Sixteen offline PostgreSQL checks passed. The isolated Stripe sandbox confirmed a successful extra hour, a declined card, duplicate retries and an already-captured delayed result. Extra time was 2299p at the original hourly price; cleaner pay calculation remained 1500p/hour for the test snapshot. No Connect transfer was performed. All five successful test charges were fully refunded; Stripe matched the database. Six unassigned visits paused, blocked charging, resumed and ended without payments. Hosted resume restarted matching without rebroadcasting. Customer/worker phone and keyboard checks passed at widths 375 and 320. These were fictional staging fixtures; existing test accounts and checks were unchanged.

## Release order after go

1. Confirm the Production slot is clear and main is still the prepared base. If another release changed main, update/review and retest the candidate before continuing.
2. Run 00-baseline-ledger.sql and 01-new-ledger-preflight.sql. A missing baseline or source mismatch stops the release. Existing exact matches are skipped, not reapplied.
3. Run 02-health-readonly.sql. Confirm current checkout/acceptance readiness, advancing five-minute billing heartbeat, expected worker fingerprint and minute ranked-offer schedule.
4. Run 03-apply-only-after-go.sql on Production uiqcsihgqaktpjumyeap only. It guards the project marker, checks baseline and target sources before writes, applies all six migrations in one transaction, and records each exact source. No intermediate notification wrapper is exposed between migrations.
5. Run 04-ledger-after.sql. Every version and MD5 must match. Run 02-health-readonly.sql again, observing another normal scheduler heartbeat.
6. The billing worker source is unchanged: 50076e5ffdb5fa90fa58360c9e3c99ddc1ee91bf909ef8ee2006eb4cb9526142. Reuse the existing billing recovery and offer-wave schedules; do not replace secrets, reinstall schedules, replay live events or trigger financial jobs as a smoke test.
7. Only after the gates pass, merge the reviewed clean candidate into main and verify the Vercel Production deployment is Ready on the public domains.
8. Repeat health and signed-in smoke checks. Release the slot and report the exact Production commit.

## Smoke checks and limits

- Homepage, booking, customer/professional login, worker portal, admin host and authenticator requirements remain correct.
- Admin and participant booking lists/details and assistant lookup load with explicit assigned-cleaner relationships.
- An eligible regular visit shows pause/end. Preview lists each visit, refund and retained charge before confirmation. Closing the preview changes nothing.
- Paused-series resume confirmation shows eligible remaining visits; cancelled visits stay cancelled. Ending is clearly permanent.
- Assigned cleaner sees extra-time controls; customer sees the exact price and approval button. Workers cannot approve their own offer. No live card charge, cancellation, refund, payout, booking or email is created for smoke testing.
- Account exports include owned series controls, agreed time changes and extra-hour offers, without another person's records.
- Marketplace config remains disabled; services/quotes, existing published legal versions and normal email remain unchanged.
- Positive signed-in Production cleaner job-page verification needs an approved account with an existing booking. The account currently supplied is rejected; its locked Jobs screen is expected. Do not change approval or verification merely to test.

## Rollback

If a new website failure appears, roll the website back to b532955. Keep additive migrations, immutable evidence and operation records. Do not remove ledger entries or reverse money operations. The unchanged worker must keep recovering already prepared operations safely. Stop further rollout and report any payment/recovery anomaly; never automatically replay a live charge or payout. Database down migrations would discard audit/payment state and are not part of this package.

05-offline-rollback-rehearsal.sql is for the isolated offline PostgreSQL rehearsal only, not a Production down migration.
