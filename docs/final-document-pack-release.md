# Final document pack, 29 October 2026

Staging first. The owner authorised this release on 31 October 2026, with the
decisions recorded below. This approval covers this release only. The older held legal
patch, migration 20261003002100, is superseded and must not be applied.

## Sources and publication

The twelve originals in `legal-packs/2026-10-01/` are byte-for-byte client PDFs,
version 1.0, effective 1 October 2026. The generated catalogue records each PDF's
SHA-256. Their web text preserves the wording, including tables. Legal wording
is exempt from marketing terminology replacements. Approved PDF-backed rows
cannot be edited in the ordinary admin editor. Previous published rows remain
in the immutable revision archive, with public earlier-version links for the
public documents. Existing booking/account acceptance snapshots are untouched.

Eight public documents have footer links. Four professional documents are linked
only from professional registration and the portal. Applicants can read them
before creating an account; they are not confidential personal evidence.
Cleaner Terms have not been supplied: their page remains a placeholder, not a
contract. New cleaners accept the existing Professional Partner Agreement and
all the new declarations instead; registration is not blocked. Publish the new
Cleaner Terms and request acceptance at the next login when they arrive.
Existing approved cleaners remain able to work. The Data Sharing and Processing Pack is internal,
and the Checkout and Sign-up Wording document is an implementation reference;
neither is published as a public legal page.

## Migration order and deployment

1. 20261029000100: publish final documents, archive earlier versions and preserve
   PDF hashes, professional visibility, and the exact approved wording.
2. 20261029000200: separate dated marketing evidence and suppression; confirmed
   email summary facts from the database.
3. 20261029000300: new-booking cancellation snapshots, 48-hour free rescheduling,
   15-minute no-access wait, safeguarding registration, Signature Deep £25.99.
4. 20261029000400: Privacy section 13 retention adapters and accounting-year gate.
5. 20261029000500: align public rescheduling FAQ and the assistant's existing
   cancellation guidance with the new rules; historical contracts stay intact.
6. 20261031000100: durable email/in-app pre-charge notices and recorded two-party
   agreements for free rescheduling at any notice. The extra migration is required
   by the owner's new release decisions; the first five sources are unchanged.

`scripts/prepare-final-document-pack-release.mjs` prepares these six
migrations, mismatch-stop ledger checks and separate staging/Production SQL.
It never executes them. Upgrade the existing visit-payments worker before
accepting new final-policy bookings; keep its five-minute schedule and gateway
authentication. Verify its source fingerprint, advancing heartbeat and checkout
readiness. No new credential or scheduler is needed. The normal booking email
minute schedule remains responsible for confirmations and policy attachments.

Only new bookings receive the new rate/policy snapshot. Earlier bookings retain
their old prices, cancellation basis, statutory evidence, and email snapshots.
Existing published/retry email payloads are not rewritten. Final confirmations
use the exact accepted Customer Terms and Cancellations PDFs plus the model
form; legacy confirmations retain their four attachments.

## Explicit instructions and remaining gaps

| Item | Finding |
| --- | --- |
| Latest cancellation band | The user's explicit instruction is up to 70%, default 70%, on the booking price excluding tips. The PDFs' Customer Terms 8.1/8.4 and Cancellation Policy 5.1/5.5 still say no refund. Exact PDFs are preserved; the staging engine uses the instructed 70% ceiling. |
| Rescheduling | A customer and assigned cleaner may agree a free change at any notice. Both participants' decisions are recorded; neither can approve their own request. Calendar and billing checks remain. A customer-only change below 48 hours requires cancellation under the original band and rebooking. |
| Regular payment timing | The payment engine stays unchanged. One-off review says payment is taken when booked. Regular review uses Cancellation Policy 3.2 verbatim. The worker creates an in-app notice and obtains email-provider acceptance with date and amount before a new regular charge can be claimed or confirmed. Retries reuse the notice; legacy in-flight operations keep their existing evidence. |
| Cleaner Terms | Missing, but new cleaners may use the existing agreement with all new required declarations. The placeholder is never accepted as a contract. |
| Customer pause/end | Next staging-only phase, after this Production release; not included in this release. |
| Warning before each regular charge | Included. Delivery failures block the charge, and existing assignment/pause/recovery guards still apply. |
| Cleaner offers extra hours | Next staging-only phase, after this Production release; not included in this release. |
| Booking Credit | Deferred to stage 3 by the owner. |
| Financial year end | Unknown until the owner supplies it. Booking/payment deletion is fail-closed while it is unset. |
| Other unlaunched terms | Loyalty, referral/reward and massage engines remain unlaunched. The massage opt-in remains hidden. Handyman commission wording must be reconciled before the marketplace is enabled; it remains OFF in Production. |

The retention changes keep open-case protection, active/upcoming work protection,
storage/metadata serialisation, audited runs and retry-safe file cleanup.
Marketing suppression is minimal and survives ordinary account anonymisation.
Future Partner/reward writers must use the defined retention-linked business
records; this release does not build or launch the reward engine.

Production, live payment operations, keys and schedulers remain untouched until
the owner approves the release separately.
