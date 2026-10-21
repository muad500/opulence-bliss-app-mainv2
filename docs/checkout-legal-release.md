# Checkout policy acceptance

Feature branch: `codex/checkout-legal-consent`, based on staging after the
Next.js 16.4.2 / Sharp security release. Card-saving and 14-day early-start
consents are unchanged and remain separate.

The final booking step requires one explicit checkbox accepting Terms and
Cancellation & Refund Policy and acknowledging reading Privacy Policy. The
metadata endpoint returns current published versions without caching. It uses
the same built-in document/version as the public legal page if a published row
is absent. Database/network errors fail checkout closed, rather than guessing.
Version changes, source changes and updated policy timestamps require a fresh
tick. Preparing the snapshot happens on the server before Stripe checkout.

The snapshot contains document title/slug, version, update time and content hash,
plus a server acceptance timestamp and account ID. No client-supplied clock or
identity is trusted. An AFTER INSERT booking trigger copies three evidence rows
into `account_legal_acceptances` atomically with the booking. All regular visits
resolve the original checkout through their series. Existing/pre-release
checkout sessions remain valid and do not receive invented/backfilled consent.
Retries do not duplicate the evidence. Account export includes booking-specific
evidence and prepared checkout snapshots. Admin booking cards expose the three
documents, versions, account and accepted time behind the existing staff/MFA gate.

## Two-phase migration/deploy sequence

1. Pin current staging/main and inspect deployment states; coordinate an exclusive
   Production release window with the other developer. Compare ledger source for
   each migration: skip only exact matches, stop on mismatches, never broad db push.
2. Apply `20261021000200_checkout_legal_acceptance.sql` (Phase A). The old signup
   uniqueness key stays present, while the new four-column key is added. Both
   old and new professional-signup writers remain compatible. The new checkout
   metadata endpoint stays unavailable until activation.
3. Deploy the reviewed web code, including the four-column signup writer. Preserve
   security upgrades and all Production-specific settings; do not merge unrelated
   staging-only features, schedules, keys, fixtures or Web Push PR #37.
4. Once that exact deployment is Ready and has the Production aliases, apply
   `20261021000300_activate_checkout_legal_acceptance.sql` (Phase B). This removes
   only the obsolete three-column uniqueness constraint. New checkout becomes
   available; no existing booking or acceptance is rewritten.
5. Verify both migration source hashes, policy metadata and linked pages, booking
   page flow, checkout readiness, signed no-op webhook HTTP 200 and marketplace
   config still false. Do not create or pay any live test booking.

These are schema/acceptance changes only: **neither migration publishes or edits
policy rows**. The user approved copying the exact built-in Terms 2.0 into the
staging legal table for testing only. On 21 October, a read-only Production check
found published Terms 2.0, Privacy 1.0 and Cancellation & Refund 1.0. Their rows
must remain unchanged. The fallback covers missing rows without publishing one.

The user subsequently confirmed the other developer had paused Production and
authorised release after staging tests pass. Recheck main/deployments immediately
before the release; if another release has started, stop and coordinate again.

## Verification

`npm test`, TypeScript, build, the new-code lint checks and the isolated PostgreSQL
fixture `supabase/tests/checkout_legal.sql` must pass. The SQL fixture bootstraps
an empty local/CI database and must never be run on hosted data. It verifies both
signup writers during Phase A, one-off and six-visit evidence, idempotency,
stale versions, unpublished/missing documents, cross-user rejection, exact
built-in fallback metadata and legacy checkout preservation.

Hosted staging must also verify the real checkbox/links, blocked checkout when
unticked, one-off and regular test checkout finalisation, per-booking records,
customer export and staff evidence. Record actual Stripe test results separately
from isolated fixtures. No claim of paid end-to-end success before it is observed.

## Hosted staging results — 21 October 2026

Preview commit `57d3455` passed the required desktop and mobile form checks.
The checkbox was unchecked and required, with Terms 2.0, Cancellation & Refund
1.0 and Privacy 1.0; each link targets its legal page in a separate tab. An
unchecked checkout request returned 400 before creating a Stripe session.

Using only the existing synthetic staging customer and Stripe sandbox 4242 card:

- One-off checkout authorised £45.98 and created one booking with three policy
  evidence rows, all with the server acceptance time and that booking ID.
- The six-visit regular plan paid £227.88 upfront and created six bookings with
  18 evidence rows. Re-running its normal finalisation did not duplicate rows.
- Download my data returned all 21 evidence rows and both checkout snapshots.
- The admin bookings page showed document/version/time/account evidence after
  TOTP. Before TOTP it redirected to MFA without returning acceptance evidence.
  Existing bookings explicitly showed that no booking-specific evidence exists.
- All seven synthetic bookings were cancelled through the existing customer
  cancellation flow after testing; the 21 evidence records were retained.

No live payment was made. Production policy rows were inspected read-only and
already contain published Terms 2.0, Cancellation & Refund 1.0 and Privacy 1.0.
Production release is a narrow cherry-pick from staging, excluding unrelated
staging helpers and PR #37. The database CI also runs for its main-target PR.
