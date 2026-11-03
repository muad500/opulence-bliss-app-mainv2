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

- Application suite: 562 passed (including 9 new launch-polish tests).
- Isolated database: 39 checks passed on in-memory PostgreSQL 17.5/PGlite, using the
  existing safety fixture and real release/transition/cancellation functions.
  No remote database, real identity, payment or compliance record is created.
- Typecheck: passed. Changed-file lint: no errors; two existing unused-variable
  warnings in the account export remain. Next.js 16.4.2 build: passed.
- `check:visit-worker`: passed, unchanged SHA-256
  `50076e5ffdb5fa90fa58360c9e3c99ddc1ee91bf909ef8ee2006eb4cb9526142`.
- Production-only dependency audit: zero vulnerabilities; existing development
  dependency advisories have not been silently upgraded in this feature task.
- Five staging migrations are installed with exact-source ledger matches. The
  independent operations scheduler is installed paused, before deployment.
  Browser and Sandbox checks and scheduled HTTP delivery are **pending**.
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
