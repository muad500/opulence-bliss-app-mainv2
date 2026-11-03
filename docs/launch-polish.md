# Launch polish — 3 November 2026

Branch `codex/launch-polish`, from staging `a36acd3`. Production baseline supplied
by the owner and independently checked: `1298526`. **No production release is
authorised until the owner says go after the staging report.** Task 2 waits until
this task is live.

## Source check

The existing `codex/cleaning-package-breakdown` work (`755eece`) supplies Essential
Clean and shared rules. The other five breakdowns were missing in current staging
and main. Current code contained prose about a checklist/photos, but no working
cleaning checklist/photo collection step. The five missing descriptions now use
the client's 12 October Part 2 email, including the unusual Express bullet and
the differing move-in emphasis. Prices, duration limits and old bookings are not
changed by the scope migration.

The exact final policy PDFs remain unchanged. Checkout Wording section 10 was
read from the supplied PDF. Complaints templates come from Procedure section 10.
Welcome emails attach actual immutable accepted versions, not today's documents.
Missing Cleaner Terms are never invented or claimed accepted; cleaners currently
receive the existing Professional Partner Agreement they actually accepted.

## Implementation and release boundaries

- Five allowlisted migrations, in timestamp order. Run the preparation script's
  `ledger` mode before writes; exact stored source must match or stop. A matching
  version is skipped. The retired `20261003002100` is excluded.
- Work checklist/photo records are new-booking snapshots. Existing visits are
  exempt. The enforcement control starts OFF so applying a migration before the
  new UI is deployed cannot trap a booking. Enable it after staging/production
  UI smoke checks; only later new bookings become mandatory.
- Work photos are private, re-encoded JPEGs without EXIF; only participants or
  MFA staff can open them. The existing hold-aware 12-month photo cleanup includes
  them. Checklist and outcome records are included in account data exports.
- Ordinary cancellation bands remain unchanged. A separate MFA staff action,
  required reason and immutable booking event enable the unsafe-home/disrespect
  exception under final accepted terms. It never creates another charge or
  reverses a prior refund. Customer-stopped visits retain only verified worked
  cleaning time; unworked extras/products are refunded. The same durable money
  operation and funded-source payout recovery is reused, without changing its
  worker code, idempotency, self-booking or own-account payout protections.
- A withdrawn/re-offered visit gets an in-app notice and email plus a real
  customer-only free cancellation action, including when staff/system re-offer it.
- Complaints receive unique references, 3-working-day acknowledgements, 14/28/30
  day response deadlines, exact reply templates and staff reminders. England and
  Wales holidays through 2028 come from the GOV.UK bank-holidays.json feed; refresh
  before 2029. Complex cases require an update by day 14. Staff still investigate
  and decide the reply; the system never invents findings.
- Welfare steps are human actions: phone/message cleaner, wait 15 minutes without
  an answer, phone emergency contact, then request a police welfare check if still
  concerned. Immediate danger instructions are not delayed by the workflow. Each
  actual action records staff, time and note; automatic refreshes do not log calls.
- Receipts are queued from succeeded payment records, including regular and
  additional-time payments, not a return-page visit. Welcome/receipt/complaint
  emails have durable snapshots, bounded leases and retry idempotency. Unknown old
  provider outcomes go to review rather than being blindly resent.
- New operations cron is separate from `visit-payments`. Install its environment-
  specific scheduler **before deployment**, without copying staging secrets,
  bypasses or scheduling functions into production. The billing worker stays
  byte-for-byte unchanged and must keep its advancing HTTP-200 heartbeat.
- `vercel.json` selects `fra1` for the application functions. Next.js and eslint
  stay at 16.4.2; application dependencies and lockfile are unchanged.
- No real approvals, compliance evidence or live payments are used in tests.
  `worker@test.com` and `cleaner2@test.com` are absent from the staging provider
  list; do not suspend unrelated accounts. Check the exact production identities
  at release time and suspend only these two after the owner's go.

## Current test record

- Application suite: 564 passed (including 11 new launch-polish tests).
- Isolated database: 46 checks passed on in-memory PostgreSQL 17.5/PGlite, using the
  existing safety fixture and real release/transition/cancellation functions.
  No remote database, real identity, payment or compliance record is created.
- Typecheck: passed. Changed-file lint: no errors; two existing unused-variable
  warnings in the account export remain. Next.js 16.4.2 build: passed.
- `check:visit-worker`: passed, unchanged SHA-256
  `50076e5ffdb5fa90fa58360c9e3c99ddc1ee91bf909ef8ee2006eb4cb9526142`.
- Production-only dependency audit: zero vulnerabilities; existing development
  dependency advisories have not been silently upgraded in this feature task.
- Five staging migrations are installed with exact-source ledger matches. The
  independent operations scheduler was installed paused before deployment, then
  activated after Preview was Ready. It returned HTTP 200 at 12:54:43 and 12:55:00
  UTC, with email configuration ready and no queued mail or failures. This is not
  yet a delivery/inbox test.
- Preview `6upsg9js6` is Ready at `f9a5528`, with functions in `fra1`. Stable link:
  https://opulence-bliss-app-mainv2-git-codex-la-205105-muad500s-projects.vercel.app
  Branch-only Preview overrides point to this Preview, use the existing staging
  scheduler secret, restrict email to `syedmouad@gmail.com`, enable per-visit
  checkout and keep the handyman marketplace OFF. No Production env was changed.
- Homepage, booking and customer login returned 200; unauthenticated operations,
  work-evidence and staff-outcome APIs returned 401; disabled marketplace returned
  404. Both checkout and legal-evidence readiness are true. The unchanged billing
  worker returned HTTP 200 with its exact fingerprint at 12:50 and 12:55 UTC and
  its heartbeat advanced. New-booking checklist enforcement was enabled only
  after the new UI was Ready; old-booking snapshots remain exempt.
- All five package sheets were opened and their matching headings and full job
  breakdowns verified in the actual mobile-width staging browser. Close the sheet
  before testing another card; clicking through a modal is not a valid test.
- Signed-in staff complaint UI passed: saved the explicitly fictional complaint
  `fb087042-4063-4a84-a2f4-f2ab10c19bf0`, generated its unique reference, showed
  acknowledgement due 6 November at 17:00 and reply due 17 November, rejected a
  blank full reply, and accepted the staff's labelled test response. Both exact
  acknowledgement and reply emails arrived in `syedmouad@gmail.com` Inbox, from
  `Opulence Bliss Staging`, at 14:07 and 14:11 UTC. No real complaint or allegation.
- After the browser reset, the owner signed in again and staff access was
  verified. Welfare guidance loaded correctly with no existing alerts; no phone
  calls, police requests or welfare facts were invented to populate its audit.
  The staff decision form displayed the total/No VAT, time-worked/full-price
  modes and disabled submission without a reason. No financial action was
  submitted. The clearly labelled fictional complaint was then resolved through
  the staff UI, after both messages showed Sent, and verified in the database.
- Browser checks exposed a usability issue for old visits: the server correctly
  refuses unsupported payout terms, but the page still offered the new decision
  form. The API/UI now flag those visits for manual review instead. Full-price
  modes are also disabled unless that booking has the final booking-total terms.
  New route tests cover legacy/final terms, failed terms lookup and signed-out
  access. The independent server-side migration guards remain unchanged.
- Full Stripe outcome/refund/payout end-to-end test is **BLOCKED**, not passed:
  the existing synthetic `SANDBOX payout audit` professional lacks verified proof
  of address. The unchanged assignment guard rejected the fixture booking. No
  approval, compliance record, suspension setting or guard was changed to bypass
  this. The test created no booking, terms acceptance or work record.
- The one isolated Sandbox charge `pi_3UXijG2NzINBHbzj00kfwdkm` (£70.98, test card)
  was refunded in full: `re_3UXijG2NzINBHbzj0oA06yYK`, succeeded. This cleanup refund
  is NOT evidence that the application's partial-visit refund flow passed.
- Temporary `launch-polish-sandbox` ran only in `comwdjprdedmsnxtvuuk`, with gateway
  JWT verification, the existing scheduler-secret header, a fixed fictional run
  identifier, a hard expiry and exact sandbox account/key checks. Its source and
  generated bundle were entirely outside the repository in a temporary directory:
  **there are no helper commits to exclude**. After refund, the endpoint was
  deleted and the remote function inventory verified to contain only the unchanged
  `visit-payments` v19. The existing billing worker was never redeployed.
- At 14:35 UTC, billing still returned HTTP 200 with the exact worker fingerprint,
  the heartbeat advanced, and both readiness checks were true. Operations cron
  continued HTTP 200. Production remained `1298526` / deployment `2giblz3io`.
- Staging security advisors were reviewed. New scoped authenticated RPC warnings
  are intentional: staff functions enforce MFA/admin, customer replacement checks
  booking ownership, and work evidence checks the assigned cleaner. Anonymous
  execution is revoked. Unrelated existing advisor findings were not silently
  changed as part of launch polish.
- Still pending: welfare actions on a genuine active alert, actual cleaner checklist
  and photo upload, welcome-email registration, payment receipt delivery for the
  supported flows, and full Sandbox staff-outcome/refund/payout/retry tests. A
  legitimately verified staging professional is needed for the latter; do not
  create fake compliance records. Production accounts are unchanged; PR remains
  draft and this is not a production approval request.
  Do not describe local/mocked tests as Stripe or live browser tests.

## Tool incident and recovery

The new Vercel CLI's `env run` invocation unexpectedly fell through to deployment
and created an empty `launch-polish` project. It failed before deployment; the
project had zero deployments. Its exact ID was checked and the empty project was
deleted. The local link was corrected to the existing mainv2 project. Production
remained on deployment `2giblz3io` and main `1298526`; no environment or production
site was changed. Do not use that CLI command again.

## One remaining client document list

1. **Cleaner Terms and Conditions:** still missing. The existing Professional
   Partner Agreement is used and named honestly until the final document arrives.
2. **Ordinary late-cancellation wording:** Customer Terms 8.1/8.4 and Cancellation
   Policy 5.1/5.5 say no refund, while Checkout Wording says up to 70%. Align the
   wording with the approved live ordinary bands; distinguish the exceptional
   unsafe-home/disrespect full-price power (8.7/5.8), not a new ordinary 100% band.
3. **Part-way stop:** Cancellation Policy 5.6 also mentions agreed time the cleaner
   cannot refill. The owner's launch instruction is narrower: time worked only.
   The implementation follows that instruction; the PDF needs alignment.
4. **Payment/rescheduling clauses:** one-off is paid when booked; regular visits
   are charged after acceptance, with the pre-charge notice. Mutual agreed moves
   are free at any notice; unilateral moves keep the snapshotted cutoff/bands.
   Remove contradictory blanket booking-time/under-48-hour claims in the pack.
5. **Before later features launch:** reconcile the disabled handyman marketplace's
   20% quote commission with 25% of labour/materials at cost in professional Terms;
   publish the appropriate regulated-work scope/certificate requirements. Loyalty,
   rewards, Booking Credit and massage remain deferred; the referenced Wellness
   agreement/Schedule 1 is missing. Do not present deferred benefits as available.
6. **Part 2's own table:** its walls/vents row says No, while Deep and End of Tenancy
   task lists include them; Deep/End of Tenancy also say quoted per property while
   booking is hourly. The requested detailed task lists are preserved verbatim,
   not silently rewritten to resolve these conflicts.

## Independent activation brought forward (staging only)

At the user's request, this PR now adds a first review and an independent
second sign-off before activating a pending cleaning/property-maintenance
application. Both staff sessions must satisfy the existing authenticator MFA
checks. The final reviewer cannot be the professional, first reviewer or a
checker of that applicant's documents. Changed evidence invalidates the first
review. Direct table activation and the old RPC entry point cannot bypass the
gate. Existing approved accounts are not retrospectively deactivated.

Migration: `20261103153510_professional_second_signoff.sql`. Offline checks:
`PGLITE_MODULE=<local package> node scripts/test-professional-signoff-db.mjs`
(20 checks). The wider Stage 2 multi-role account/staff-role project remains
deferred. No production permission, migration or account has changed.

The user explicitly authorised a temporary **staging-only** TEST Second
Reviewer at `syedmouad+staging-reviewer@gmail.com`, real Supabase authenticator
enrolment, and disabling it immediately after the tests. Credentials must stay
inside the protected test setup, never in reports, logs or this repository.
