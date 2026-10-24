# Customer website launch essentials — 23–24 October 2026

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

The 19 October staging configuration report records `Opulence Bliss Staging <staging@opulencebliss.com>`, whereas both the existing booking-email route and this contract queue deliberately require a no-reply sender. On 23 October, four non-secret Vercel Config overrides were saved **only for Preview branch `codex/website-launch-essentials`**: `BOOKING_EMAIL_FROM=Opulence Bliss Staging <no-reply@opulencebliss.com>`, `CLEANING_PAY_PER_VISIT_ENABLED=true`, `STAGING_EMAIL_RECIPIENTS=syedmouad@gmail.com` (the previously approved test mailbox), and `NEXT_PUBLIC_SITE_URL` pointing to this branch's protected Preview. The following push built successfully with these overrides. No key was revealed or changed; common Preview, `codex/staging` and Production settings were left unchanged.

The deployed `/api/visit-billing-config` reports `perVisitBilling: true` and `smsAvailable: false`. Check the actual booking-email scheduler includes the existing Preview bypass; an HTTP redirect is not a successful delivery. The new branch Preview does not replace the stable staging cron target, so test its protected route explicitly before changing or merging the stable release. Vercel has a staging-branch-specific `CRON_SECRET`; do not reveal or reuse the separate Production/shared value to test this branch.

The branch push triggered a successful automatic Vercel Preview build. On 23 October, after the owner signed in, migration `20261023000200` was applied only to staging project `comwdjprdedmsnxtvuuk`. The transaction checked prerequisite ledger sources, locked migration application, rejected conflicting/newer sources, and recorded the exact original source. Its ledger MD5 is `59a258ac8fa170f024b9064c42956948`; `checkout_legal_evidence_ready()` returned true. Existing migration `20261023000100` differs only in CRLF line endings (recorded MD5 `c9554577aa203f0e04cb6ca5422a185b`); comparison after CRLF-to-LF normalization matched the repository. Its ledger entry was not rewritten.

The real staging database then passed `supabase/staging/booking-legal-smoke.sql`: three published snapshots, database-authoritative account identity, immutable evidence, stale-version rejection and anonymous writer/reader denial. The transaction rolled back all QA writes; no booking or permanent acceptance was created. Published legal records remain unchanged: Terms 2.0, Privacy 1.0 and Cancellation & Refund 1.0.

The initial preflight found no `opulence-booking-notifications` cron job and no `opulence_app_origin` or `opulence_cron_secret` Vault settings. The existing staging Preview bypass and recovery credential were present. A first manual request to this branch's protected `?legal_only=1` route returned HTTP 401 before claiming a queue (pg_net request `25069`). The owner subsequently configured the matching branch-only credential; the successful retest is recorded below. No recurring scheduler was enabled and no ordinary reminder/SMS backlog was processed. The separate shared/Production setting was not read or changed.

In the protected hosted one-off checkout, the owner signed into a customer test account and completed the phone field and existing saved-card/early-start consents. With only the new legal box unticked, **Book and pay remained disabled**. The displayed versions were Terms 2.0, Cancellation & Refund 1.0 and Privacy 1.0; all three links have `target="_blank"` and `rel="noopener noreferrer"` and point to their correct legal pages. The existing saved-card consent also covers confirmed add-on adjustments on one-off bookings; its display and server requirement were deliberately preserved, not mistaken for a new regular-only requirement.

The owner then ticked the policies and completed the **£45.98 Stripe Sandbox** payment using a test card. Staging booking `9d3d00d1-7c04-4b17-92c4-cd6e58de5812` is paid and awaiting a professional. Database checks found exactly three booking-linked acceptances, matching account identity, all three checked consent texts, intact source/display hashes and exactly one pending contract email with zero attempts. The accepted time is `2026-10-23T12:30:14.324305Z`. Both customer downloads succeeded: the combined accepted-policy PDF has 32 A4 pages and the model cancellation form has one. Text extraction verified the accepted versions/time; first, middle, final and form pages were rendered and visually checked without clipping. No document wording was changed.

The owner approved the signed-in test account's email for this policy-mail test. After the owner completed Vercel's authenticator check, that mailbox was added alongside the original approved mailbox **only to this branch's Preview allowlist**. No account email has been changed or redirected.

The owner also completed the **Stripe Sandbox card setup, £0 charged today**, for six fictional fortnightly visits starting 9 November. The saved acceptance `8c190b84-0df5-4494-ab8a-4685c41d2b45` links all six visits to the same three document snapshots (18 acceptance rows) and queues exactly one contract email. It records the policy and saved-card boxes; no early-start box is recorded because the visits start outside that period. The account's downloaded JSON export includes all seven QA bookings, 21 booking-linked policy records, both full acceptance snapshots, exact checked wording, request evidence and original/displayed document HTML with matching hashes. No exported personal data is committed to Git. Both contract emails were initially pending until the 24 October credential retest.

### 24 October configuration follow-up

The owner saved a new Secret `CRON_SECRET` with **Preview → `codex/website-launch-essentials` only**. The dashboard confirms that branch-specific entry separately from the unchanged 3 October `codex/staging` entry and the unchanged 5 September Production/shared entry. The secret value is not included in source or reports. Commit `ac97b78` triggered a successful automatic Preview rebuild after that save; its GitHub security and isolated-database checks passed.

The authenticated policy-only request then returned **HTTP 200**, with `sent: 2`, `failed: 0`, `configured: true` (pg_net request `27889`). The provider accepted the one-off email at `2026-10-24T07:02:20.302309Z` and the six-visit email at `2026-10-24T07:02:21.672210Z`. Each delivery has one attempt, its destination matches the unchanged account email, and the persisted payload contains Terms 2.0, Cancellation & Refund 1.0, Privacy 1.0 and the model cancellation form as four PDF attachments. Reply-to is `hello@opulencebliss.com`. The regular checkout's SMS preference did not suppress this essential contract email.

A second authenticated policy-only request returned **HTTP 200**, `sent: 0`, `failed: 0` (request `27895`). The two saved payload hashes, attempt counts and sent timestamps were unchanged: no duplicate send. The mailbox owner then confirmed receipt of **both emails with four PDF attachments each**. This confirms inbox arrival, not an independent report that every attachment was opened. No recurring job, common Preview setting, production setting or ordinary reminder/SMS queue was changed.

The real staging database also passed `supabase/staging/booking-legal-access-smoke.sql`: the customer owner can read the exact saved contract; another customer cannot; password-only staff and AAL2 without TOTP are denied; existing verified-TOTP staff can read both the original contract and sent status. A temporary, uncommitted Terms update demonstrated that historic evidence stays byte-identical and new checkout rejects the stale version. An older booking without evidence still returns no invented policy copy. All edits rolled back and acceptance/mail counts stayed unchanged. The first draft of the smoke query used an invalid version suffix and was rejected by the existing version constraint; rollback was confirmed, then the query passed using a valid temporary numeric version. These are hosted **database/RPC** checks, not a claim that a staff browser sign-in and download have been exercised.

## Verification

Completed locally:

- Full repository test command, TypeScript, and targeted ESLint (one pre-existing `billingPrices` hook warning in `app/book/page.tsx`).
- Next.js **16.4.2** production build with inert staging-shaped environment values.
- Offline PostgreSQL integration: apply both original consent migrations and the new migration; reject browser calls and altered documents; preserve built-in fallback without publishing a legal row; one-off and six-visit series linkage; immutable snapshots; other-customer and password-only staff rejection; TOTP staff access; claim/retry/token handling; old-checkout compatibility.
- Email transport tests with a stub provider: four valid PDF attachments, exact persisted payload reuse, stable idempotency key, configuration/allowlist failure, optional-email preference independence, customer and staff download gates.
- Booking cron transport tests reject non-allowlisted staging recipients, preserve production behavior, require the cron credential, and keep essential contract mail independent of optional notices. The same allowlist now guards the older booking-email path too, before any network submission; do not enable a broad staging sender without this protection and a reviewed test queue.
- The authenticated `?legal_only=1` smoke mode processes only the contract queue, never the old reminder or SMS queues. It is rejected before processing unless both Vercel Preview and the exact staging database are selected; Production rejects it. This enables a narrow hosted email check without waking the copied staging notification backlog. Normal scheduler behavior is unchanged.
- Generated current-policy copies and cancellation form rendered and inspected on first/middle/last pages. PDF creation is deterministic for retries and long-document tests cover pagination.

PR #47 also passed the GitHub security and isolated-database checks; its automatic Vercel Preview build passed. Those checks do not replace testing against the hosted staging database and email service.

To rerun the PostgreSQL test, install `@electric-sql/pglite@0.5.11` into a temporary directory (not the app) and pass its absolute `dist/index.js` path:

```sh
LEGAL_PGLITE_MODULE=/absolute/temp/node_modules/@electric-sql/pglite/dist/index.js node scripts/test-booking-legal-database.mjs
```

Hosted staging status:

1. **Done:** the new box alone blocked the hosted one-off checkout; displayed versions and new-tab legal links were correct. The existing saved-card/early-start requirements were preserved. One-off payment and six-visit card setup both completed in Stripe Sandbox, with the correct three acceptance links per visit and one contract email per checkout.
2. **Done:** customer policy/cancellation downloads and account JSON export, including the exact versions, checked wording and full original/displayed HTML. PDFs were rendered and checked for clipping.
3. **Done at database/RPC level:** owner/other-customer and staff TOTP access, immutable historic copies after a rolled-back policy change, stale checkout rejection and unchanged old bookings. **Still required:** the separate staff host's actual MFA browser sign-in, evidence page and download.
4. **Done at transport/queue and inbox level:** two provider-accepted essential emails with four persisted attachments; the owner confirmed both emails arrived with four attachments each. Regular SMS preference did not suppress the email, and a repeat authenticated policy-only scheduler invocation sent zero duplicates. The generated PDFs and customer downloads have been checked; opening every attachment in the mailbox itself has not been independently verified.
5. **Not enabled:** a recurring booking-notifications scheduler for this branch. The hosted checks manually invoked the authenticated `legal_only=1` handler twice. The production operator must verify the normal scheduler and its target/credential after a separately approved release; do not enable copied staging notification backlogs.
6. **Still required:** inspect delivery status in the staff booking page, including failed/needs-review presentation. Always check provider logs before manually retrying an uncertain delivery.

Automated contract-record retention and the wider professional/partner onboarding requirements are outside this small customer-checkout release; their status remains in the client launch checklist.
