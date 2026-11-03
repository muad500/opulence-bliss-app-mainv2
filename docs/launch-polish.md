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

- Seven allowlisted migrations, in timestamp order. Run the preparation script's
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
- No production approvals, real compliance evidence or live payments are used in
  tests. The owner explicitly authorised fictional staging documents, a normally
  approved TEST professional and a temporary independent MFA reviewer.
  `worker@test.com` and `cleaner2@test.com` are absent from the staging provider
  list; do not suspend unrelated accounts. Check the exact production identities
  at release time and suspend only these two after the owner's go.

## Earlier staging audit trail (completion record below supersedes pending items)

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
- The initial five staging migrations were installed with exact-source ledger matches. The
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
  work-evidence and staff-outcome APIs returned 401; disabled marketplace returned 404. Both checkout and legal-evidence readiness are true. The unchanged billing
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
- The initial Stripe outcome/refund/payout end-to-end attempt was **BLOCKED**, not passed:
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
- Subsequent owner authorisation allows explicitly fictional compliance documents
  and a TEST professional on staging only, approved through the normal flow with
  independent sign-off. It does not authorise fake production approvals.
- The normal signup and authenticated document-upload routes created
  `b47c634a-2eb0-4f9e-af3a-4a7ad197b80e` (**TEST Cleaner - staging launch polish**)
  and uploaded five PDFs marked **TEST DOCUMENT - NOT REAL**. Its only linked
  service area is **TEST ONLY launch-polish ZZ99**. It remains pending; no guard
  was bypassed. The registration welcome arrived in the owner's plus-alias Inbox
  at 15:50:04 UTC, with the exact next steps and all five accepted-version PDFs:
  cancellation 1.0, DBS-data 1.0, privacy 1.0, safeguarding 1.0 and the existing
  Professional Partner Agreement 2026-09-20. Missing Cleaner Terms were not
  invented or mislabelled.
- Temporary **TEST Second Reviewer** was created at the expressly authorised
  staging address, and enrolled/challenged/verified through real Supabase TOTP
  APIs. Authenticated live RPC tests rejected both password-only review and
  approval with unchecked DBS. It was then disabled: sign-in banned, staff role
  removed, authenticator deleted, and its test credentials removed from the
  encrypted fixture state. No production account or permission changed.
- The temporary `launch-polish-fixtures` endpoint was deleted after these tests;
  remote inventory again contains only unchanged `visit-payments` v19. Like the
  earlier helper, its source was outside Git: **zero helper commits**. The small
  staging fixture state is encrypted using a staging-held key, RLS-protected,
  and inaccessible to anonymous/authenticated clients; remove it when the
  remaining tests finish.
- All seven staging migration sources match their ledger entries. The 22 new
  isolated approval checks, 46 prior database checks and 564 application tests
  pass; typecheck passes and the worker fingerprint is unchanged. At 15:55 UTC
  billing still returned HTTP 200 and both readiness functions were true.
- Still pending: actual two-person activation, cleaner checklist/photo upload,
  receipt delivery and full Sandbox outcome/refund/payout/retry tests; plus
  welfare actions on a genuine active alert. A native confirmation on the first
  fictional right-to-work review currently blocks browser control; the owner was
  asked to click OK. No real GOV.UK check or compliant identity is being claimed.
  Production accounts are unchanged; PR remains draft, not release-ready.
  Do not describe local/mocked tests as Stripe or live browser tests.

## Payment-test completion and final browser gate — 3 November

- Feature source `ff6ac02` is deployed to Ready Preview `a0n2xji5p`, functions in
  `fra1`. The branch remains based on the latest `codex/staging` (`a36acd3`); no
  staging commits are missing. All GitHub checks are green, the complete local
  application suite reports **567 passed, zero failed**, typecheck and changed
  file lint pass. The isolated database suites pass 46 launch checks plus 22
  independent-sign-off checks. Next.js remains 16.4.2.
- The owner's MFA staff session recorded the first review through the real staff UI at 19:05:33;
  the application stayed pending. A different real-TOTP-authenticated temporary
  reviewer completed the normal second-sign-off RPC at 19:05:47. The cleaner was
  activated only then. The reviewer was immediately disabled: banned sign-in,
  staff role removed, authenticator removed (zero remaining factors). No
  approval guard or document requirement was bypassed.
- Two fictional visits passed the deployed authenticated checklist/photo routes:
  start blocked without the scope/hazard review; completion blocked without all
  tasks; completion blocked without a finished photo or sufficient explanation;
  before/after synthetic JPEGs uploaded; all tasks saved; completion accepted;
  finished evidence locked; the booking customer could read its completed work
  record. Stored JPEG inspection independently confirmed EXIF removal. The
  supplied images say TEST PHOTO, contain no people/property, and use no real
  addresses. This does **not** claim that the complete real-phone OTP/geolocation
  check-in experience was retested; those guards remain unchanged.
- Final signed-in checks exposed separate staff/public host routing on photo
  links. `ff6ac02` gives admin photos their own `/api/admin/work-evidence/...`
  route, enforces the existing authenticator staff gate, then reuses the same
  RLS-protected private photo reader. Customer links keep their original account
  route. Two regression tests pass; both deployed photo routes return 401 signed
  out. The updated resolution desk also loaded successfully in the real staff
  session. **Remaining gate:** the owner must sign in to the new immutable staff
  Preview so the corrected photo can be opened in the browser. No credentials
  or MFA checks will be bypassed. PR stays draft until this final check passes.
- Actual Sandbox outcomes, original charges and own-account transfers:

  | Test                                                  | Customer result                                                                | Cleaner payout                              |
  | ----------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------- |
  | Unsafe home, fictional £70.98 booking                 | Retained £70.98 under the exceptional final accepted terms                     | £30.00                                      |
  | Customer stopped after 60 verified test minutes       | Retained £22.99; one succeeded £47.99 refund, including unused extras/products | £15.00                                      |
  | Completed two-hour Signature Deep plus products       | Paid £56.98                                                                    | £39.00 (£35 + £4 products)                  |
  | Completed Essential plus customer-approved extra hour | Paid £42.98 + £18.99; repeated approval did not charge twice                   | £49.00 (£30 + £4 products + £15 extra time) |

  All transfers were retrieved/listed from Sandbox and verified to reach only
  this fictional cleaner's own connected account. Repeated settlement/operation
  calls produced no duplicate transfers or refunds. The extra-hour payment has
  its own captured source and one corresponding £15 transfer. The provider's
  first missing-account attempt correctly held payment and opened a case; after
  test onboarding and normal staff case closure, scheduled recovery paid once.
  The desk now keeps closed cases with held/pending/failed payouts visible so
  its explicit lift-hold/retry controls do not disappear. This has a regression
  test; no readiness or money-operation guard was weakened.

- Sandbox evidence: unsafe booking `50aff7b5-2822-4c9c-b6fa-06cecbba8124`,
  transfer `tr_3UXn6n2NzINBHbzj02Q8H7OF`; part-way booking
  `3f398922-28b3-4b42-8d9f-fa77d233e2d0`, refund
  `re_3UXn6p2NzINBHbzj1xLlb28A`, transfer
  `tr_3UXn6p2NzINBHbzj1tixJGTP`; deep booking
  `d54a21c0-71c9-4da1-a22a-fe7023818d63`, transfer
  `tr_3UXn6q2NzINBHbzj0ZJilgD1`; extra-time booking
  `72344b14-9d93-43ce-91e8-e9ab71573108`, transfers
  `tr_3UXn6s2NzINBHbzj0cJfhs7O` and `tr_3UXnAp2NzINBHbzj0Kgqmpq1`.
- A separate **genuine six-visit regular series**
  `f38f2b1f-7e32-48f1-8ed1-cbf13dbfb949` used the real service finaliser and
  a succeeded Sandbox SetupIntent. Setup charged £0. The test professional
  accepted through the normal authenticated offer RPC; the first visit then
  charged £37.98 once (`pi_3UXnIK2NzINBHbzj0UdN5Jvh`). Retry did not duplicate it;
  the other five unaccepted visits were uncharged. This is separate from the
  earlier direct Essential fixture whose internal label was `regular_receipt`.
- That accepted regular visit was withdrawn using the normal provider transition.
  The customer received the durable replacement/free-cancellation choice and
  used the real authenticated cancellation HTTP endpoint. Its £37.98 was refunded
  in full. All six future synthetic visits were cancelled; none remains open.
  The replacement email arrived in the owner's plus-alias Inbox at 19:29:02,
  message `1a1a2e2eb53fffb0`, with the free-cancellation wording.
- Actual receipt emails arrived for all initial test payments, the extra hour
  (£18.99, Inbox 19:16:01, `1a1a2d7004381453`) and the genuine regular visit
  (£37.98, Inbox 19:23:02, `1a1a2dd6f03cfc99`). Read bodies confirmed total,
  payment/booking references and **No VAT is charged**. The earlier cleaner
  welcome with five actual accepted-version PDFs, and complaint acknowledgement
  and reply, remain confirmed Inbox deliveries. The handyman welcome is covered
  by automated wording/attachment tests, not a claimed live handyman approval;
  the marketplace remains off.
- At 19:31 the normally approved **TEST Cleaner - staging launch polish** was
  suspended through the staff UI, with an explicit fictional-test completion
  reason. Its public directory remains hidden; its isolated ZZ99 test area was
  disabled. The temporary second reviewer remains disabled with no MFA factors.
  All existing real accounts and production permissions are unchanged.
- The temporary `launch-polish-fixtures` endpoint was deleted immediately after
  the final Stripe audit. The encrypted, single-run disposable credential-state
  table was also removed after explicit staging/name/row-count guards. Audit,
  booking and payment history is retained. Remote function inventory again shows
  **only unchanged `visit-payments` v19**, gateway JWT verification on. All helper
  source and generated bundles were outside Git: **zero helper commits**.
- All seven migration ledger entries were rechecked against exact source and
  match. The unchanged billing worker returned HTTP 200 at 19:25 and 19:30 with
  fingerprint `50076e5ffdb5fa90fa58360c9e3c99ddc1ee91bf909ef8ee2006eb4cb9526142`;
  heartbeat is advancing. Both readiness functions are true. Operations cron
  returned 200 at 19:32/19:33 with email configured and zero failures. Latest
  Preview homepage/booking/login return 200, private operations/evidence endpoints
  return 401 signed out, and disabled marketplace returns 404.
- Welfare guidance and isolated timing/access/audit checks pass. No actual phone
  call, emergency-contact call or police request was fabricated to complete a
  browser test. Production main remains `1298526726d512e0ef094ba88e583ae625b5da27`
  and Production deployment remains `2giblz3io`. Production release and suspension
  of the two exact production test cleaners still require the owner's **go**.

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
checks. The final reviewer cannot be the professional, first reviewer, the
onboarding inviter or a checker of that applicant's documents. Changed evidence or identity details invalidate the first
review. Direct table activation and the old RPC entry point cannot bypass the
gate. Existing approved accounts are not retrospectively deactivated.

Migrations: `20261103153510_professional_second_signoff.sql` and
`20261103155510_independent_onboarding_identity_guard.sql`. Offline checks:
`PGLITE_MODULE=<local package> node scripts/test-professional-signoff-db.mjs`
(22 checks). The wider Stage 2 multi-role account/staff-role project remains
deferred. No production permission, migration or account has changed.

The user explicitly authorised a temporary **staging-only** TEST Second
Reviewer at `syedmouad+staging-reviewer@gmail.com`, real Supabase authenticator
enrolment, and disabling it immediately after the tests. Credentials must stay
inside the protected test setup, never in reports, logs or this repository.
