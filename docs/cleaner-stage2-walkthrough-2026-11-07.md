# Cleaner Stage 2: staging walkthrough, 7 November 2026

Production is unchanged by this task. PR #63 remains draft into `codex/staging`.
The later provider-access restriction has not been started or applied.
Checkout, payment calculations, loyalty, Booking Credit, published legal copy
and the handyman marketplace have not been changed by this work.

## Approved wording and implementation

- The single editable catalog is `content/cleaner-onboarding-drafts.json`.
  E01–E10, D01 and C01–C12 are approved as written: **Version 1.0 – effective
  1 October 2026**, approved by Opulence Bliss. Receipt of the approval is
  recorded on 6 November, rather than backdated. The exact draft-1 history is
  preserved in `content/history/cleaner-onboarding-draft-1.json`.
- The generated client-review inventory contains all ten emails, one
  declaration and twelve checklist groups / 64 items. Runtime draft labels have
  been replaced with the approved status; historical review notes remain intact.
- D01 is required on the no-login form. Duplicate submissions return the same
  outward result without a duplicate application or acknowledgement.
- Staff checklist ticks record the authenticated staff member, UTC time, version
  and factual note. Named private access and existing MFA/staff permissions remain
  enforced. Manager case locks and independent second sign-off are preserved.
- E04 is enabled only on this staging branch, now that the secure decision view
  exists. Reasons stay in the private view; the email carries only personal
  time-limited access. Applicants can request a human review.
- No general Auth account is created until the assessment passes. An existing
  customer's identity and original acceptance history are preserved. Fresh
  professional acceptances have their own immutable evidence batch.
- Setup requires the cleaner's own verified Stripe test account, emergency
  contact and exact post-assessment policy declarations. Staff file the original
  checked evidence privately. Setup does not itself approve the cleaner.
- DBS renewal is three-yearly. RTW expiry rules are unchanged. Renewal, first/fifth
  visit and verification follow-ups use the minute worker. No annual DBS status
  was fabricated or restored.

## Observed staging results

Three clearly labelled fictional applications were exercised: one passed into
account setup, one was rejected before assessment, and one failed an assessment
and a Manager-reviewed writing attempt. No Auth account existed before a pass;
neither unsuccessful case received one.

Actual browser checks covered D01, duplicate submission, audited C01–C08 ticks,
private DBS decision publication, applicant human-review request, Manager
resolution, induction invitation, attendance, closed-host refusal, timers, page
leave, one audited reopening, writing paste refusal, human writing pass/fail and
the post-pass sign-in handoff. Successful Part A threshold fixtures used server
marking commands; no answer key left the database. A three-second connection
interruption recovered; a ten-second interruption failed with the recorded
connection-lost reason. Network emulation was restored afterwards.

The normal scheduled worker delivered E01/E02/E03/E04/E05/E06/E07/E10 and both
assessment failure decisions. Gmail receipt was verified at the approved test
inbox only. E06/E07 used temporary dates on the fictional case; both original
check dates were restored after delivery. E08/E09 first/fifth-visit triggers are
covered in database tests; actual delivery was not exercised by fabricating
completed jobs.

All four private uploads accepted the clearly labelled fictional PNG: ID, RTW,
proof of address and £1m insurance. The passed applicant completed their own
Stripe sandbox recipient account using Stripe's test bank details, then saved
five policy acceptances, an emergency contact and the weekly payout preference.
The actual recorded acceptances include their IP, exact boxes, versions and PDF
references. The cleaner remained pending, with no booking or live financial
operation. Weekly, fortnightly and monthly preference mappings also pass the
server route tests; only weekly was saved through the actual browser.

All five policy links open a new tab. The Cleaner Terms page shows Version 1.0 /
1 October 2026. Its downloaded PDF has SHA-256
`ca8941c30c9640c592bc2ad2ec12fa646ab31e5a42b1975e2dbe8944ec8a17b8`,
matching the pinned original. The actual E10 welcome email contained all five
accepted-version PDFs: Cleaner Terms, Cleaner Cancellation, Safeguarding, DBS
Data and Privacy. Every received attachment's SHA-256 matched its pinned original.

After C06–C08, the genuine MFA Manager recorded the first review. The staff screen
required another independent staff member and disabled final approval for the
onboarder. No persisted professional was activated.

The full staging database smoke tested eleven/twelve-answer thresholds,
ordered evidence, fresh acceptances for an existing customer, immutable evidence,
missing setup gates and independent activation. Same-person approval failed;
a complete independent fictional case could activate. That transaction rolled
back all records: zero persisted fixtures, emails or financial operations.

## Failures found and corrected

| Finding                                                                | Correction                                                                               | Evidence                                                                                             |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| PostgREST rejected unrestricted singleton heartbeat writes             | Explicit singleton predicates                                                            | Scheduled requests succeed                                                                           |
| Old customer acceptance prevented fresh professional consent           | Separate immutable post-assessment evidence, preserving the old record                   | Existing-customer database regression passes                                                         |
| Screening evidence and action reason shared the form field name        | Separate `actionNote` field                                                              | Actual screening walkthrough plus suite                                                              |
| Old page-leave marker blocked an authorised reopening                  | Await old cleanup, then exchange the fresh invitation under server rules                 | Async client regression passes; old attempt remains failed                                           |
| Staff screen reported all requirements complete before setup           | Stage 2 setup requirement included in staff review; clearer document-check wording       | Staging / Production-isolation tests pass; actual first-review screen blocked the same onboarder     |
| Follow-up worker queried nonexistent `bookings.completed_at`           | Use actual check-out time, falling back to retained invoice completion, once per booking | Real-schema offline regression and advancing scheduled follow-up heartbeat                           |
| Stripe recipient creation omitted its required email                   | Supply the authenticated account email, never a form-supplied address                    | Actual sandbox onboarding completed; ownership/idempotency regression passes                         |
| Consent fingerprint format disagreed with the existing shared contract | Use the shared fingerprint format, retaining exact HTML/version/PDF guards               | Actual five-document acceptance saved; real shared-helper regression passes                          |
| Manager-held writing failure displayed generic review text             | Add a bounded review-stage enum and show the exact approved writing-wait copy            | Browser hold showed no final decision/email; Manager confirmation then displayed and emailed failure |

## Verification and limits

- Full application suite: **702 passing**, zero failures. Typecheck and build pass.
  The local build used dummy keys with the public staging hostname, not saved
  Production credentials. The destructive-admin test loader was updated for the
  new dependency and still asserts that those tools cannot inspect applicants.
- Isolated database suites: application 13, assessment 59, onboarding 48, pack
  12, approved workflow 33, three-year DBS 7: **172 checks** passing.
- Scoped lint and formatting pass. The approved catalog generated output is
  current. Private source scanner: 25 questions / five prompts, 774 client files
  checked, no private bank text. Billing worker source/hash is unchanged.
- Phone-sized browser layouts at 375×667 and 320×568 had no horizontal overflow.
  Keyboard focus and skip link passed. These are emulation, not physical phones.
- The application page added no product cookies, local storage or third-party
  requests. Only Vercel's own toolbar session keys were present. Assessment and
  decision access use necessary HttpOnly/Secure/Strict cookies; the active-attempt
  session marker exists only to prevent resuming after page leave. Published
  Cookie Policy text was not rewritten.
- The minute scheduler uses the existing staging worker credential and bypass
  consumer; no secret was printed or copied into the repository. Both recovery
  and follow-up heartbeats advanced after the completion-field fix. The scheduler
  SQL is staging-only and must never be shipped to Production.

## Numbered test-sheet mapping

“DB pass” means the actual/isolated database function passed with fictional data;
it does not substitute for an uncompleted device or real-email walkthrough.

| Test  | Result                                                                                                                                                 |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | Browser pass: unticked D01 blocked submission.                                                                                                         |
| 2     | Browser/DB/email pass: one Applied record and E01 receipt.                                                                                             |
| 3     | Browser/DB pass: no sign-in or professional account before assessment pass.                                                                            |
| 4     | Browser/DB pass: ordered ticks include staff, time, version and note.                                                                                  |
| 5     | DB pass: missing RTW blocks activation; final screen confirmation pending.                                                                             |
| 6     | DB pass: missing DBS or unresolved conviction blocks activation.                                                                                       |
| 7     | DB pass: missing/same-person sign-off refused; independent fixture passed.                                                                             |
| 8     | Browser/API pass: missing consent rejected; all five required acceptances saved after own sandbox setup.                                               |
| 9     | Browser/DB pass: immutable evidence stores IP, exact boxes, versions and pinned PDFs; account handoff completed.                                       |
| 10    | Browser/email pass: five policy downloads and five received welcome attachments match the pinned original PDFs.                                        |
| 11    | Own Stripe sandbox setup and weekly preference saved in browser. All three schedule mappings pass API tests; other two not manually saved.             |
| 12    | Browser/DB pass: missing emergency contact blocks setup; fictional contact saved on the successful path.                                               |
| 13    | Browser/email pass: setup completed, E10 received with five exact PDFs. Independent activation passes only in rollback; persisted case stayed pending. |
| 14    | DB pass: pending/suspended/stale-payout accounts receive no offers; Active/fresh accounts do. Browser offer-matrix check pending.                      |
| 15    | Existing no-substitute flow preserved; no new reassignment implementation.                                                                             |
| 16–27 | Existing working-life/payment features, outside this onboarding change; not newly signed off here.                                                     |
| 28    | DB/email pass: RTW expiry unchanged; E06 and three-year DBS E07 received through the normal worker; fictional dates restored.                          |
| 29    | Stage 1 version workflow preserved; not republished or newly exercised here.                                                                           |
| 30    | DB pass: unlisted/Developer private access refused and logged.                                                                                         |
| 31    | Browser/DB pass: named MFA private opening and evidence upload logged.                                                                                 |
| 32    | Browser/DB/email pass: rejection recorded, six-month retention date set and actual E03 received.                                                       |
| 33    | Isolated retention/hold/idempotency checks pass; no unrelated remote records deleted.                                                                  |
| 34–35 | Existing data-rights/HMRC tools, unchanged; not newly walked through.                                                                                  |
| 36    | Staff/MFA gates pass automatically; actual named MFA session used for walkthrough.                                                                     |
| 37    | Public page/browser storage check passes; physical-phone assessment storage check pending.                                                             |
| 38    | Browser/DB pass: closed host exposes no questions.                                                                                                     |
| 39    | DB pass: second session replaces first; physical two-device check pending.                                                                             |
| 40    | Browser/DB pass: ten-second expiry moves forward; server clock authoritative.                                                                          |
| 41    | DB pass: previous/future answers refused; browser has no back-question control.                                                                        |
| 42    | Actual database threshold smoke passes; both final-failure emails reached the approved alias through the normal worker.                                |
| 43    | Server random/core/uniqueness checks pass; five full browser attempts not completed.                                                                   |
| 44    | Browser pass for page leave and logged reason; phone app-switch/lock matrix pending.                                                                   |
| 45    | **Pending physical Android/iPhone non-hiding notification test.**                                                                                      |
| 46    | Browser/DB pass: three-second interruption resumes, ten seconds fails. Physical phone network test remains outstanding.                                |
| 47    | Bank access/current-question payload/source scanner pass; full physical-device traffic inspection pending.                                             |
| 48    | DB/API pass: staff cannot alter automatic marks.                                                                                                       |
| 49    | Browser pass: paste refused; server chooses from the private five prompts.                                                                             |
| 50    | DB recovery auto-submission pass; five-minute browser timeout not waited out.                                                                          |
| 51    | Browser/DB/email pass: writing failure stays on hold with exact waiting copy; Manager confirmation releases the failure screen and email.              |
| 52    | Browser pass: human writing pass unlocks acceptance/account setup.                                                                                     |
| 53    | DB pass for individual timing multipliers and minimal audit; device adjustment walkthrough pending.                                                    |
| 54    | Failure/reason appears in host overview; no Meet integration or removal action.                                                                        |
| 55    | Browser/DB pass: one audited fresh attempt; second reopening refused automatically.                                                                    |
| 56    | Isolated DB pass: one month blocked / three months allowed.                                                                                            |
| 57    | Isolated DB pass: expired answers/writing removed, open cases retained.                                                                                |

## Migration ledger

The original six Stage 2 migrations remain applied:
`20261105020000`, `20261105021000`, `20261105022000`, `20261105102000`,
`20261105104243`, `20261105111015`.

The following eleven additions are applied **only to staging**, in order:

| Version        | Purpose                                                    |
| -------------- | ---------------------------------------------------------- |
| 20261105134126 | Approved wording, checklist and secure E04 workflow        |
| 20261105134128 | Three-year DBS renewal                                     |
| 20261106091246 | Induction invitation and passed-account handoff            |
| 20261106092348 | Setup, activation/new-work guards and follow-ups           |
| 20261106101839 | Checked private-evidence handoff                           |
| 20261106103502 | Private scheduler authentication using existing credential |
| 20261106132822 | PostgREST-safe singleton updates                           |
| 20261106134034 | Fresh immutable post-assessment acceptances                |
| 20261106202602 | Actual completed-visit follow-up lookup                    |
| 20261106205440 | Shared acceptance-fingerprint contract                     |
| 20261106211204 | Exact writing-review waiting status                        |

All **17 Stage 2 migrations** are present in staging's ledger. A final source
comparison passed for all 17 after normalising line endings and final whitespace.
Execution-time IDs were aligned only after checking their source; statements were
not rewritten. The final three raw source hashes match exactly:

- `20261106202602`: `8e9063de7153a1b4fc27bab54cce72d7`
- `20261106205440`: `ae8c4188c818b9683df998cc2c1c5d61`
- `20261106211204`: `98d7c42ccab50e9ca9c3f7d05b4597f6`

Earlier entries differ only in line endings or trailing whitespace, not SQL content.

The private bank import contains no real answer key in the migration ledger.
`20261104210001` remains held. Do not include `supabase/staging/` files or branch
dependency merges in a future Production package.

## Test access cleanup and remaining release gates

The passed fictional case is closed and its provider suspended. Its test Auth
user is banned, account APIs disabled, all sessions removed and refresh tokens
revoked. Both assessment invitations expired, their session hashes were cleared,
and the secure decision was revoked. There are **zero active assessment links,
decision links, Auth sessions or refresh tokens**, and zero bookings. The actual
validation functions reject the revoked decision and both expired invitations;
the browser now shows the sign-in prompt. Neither failed applicant has an Auth
account. Temporary RTW and DBS reminder dates were restored exactly.

Audit history, private fictional evidence and the test-only Stripe recipient
remain for inspection; no real professional was approved or financial operation
created. No secret or personal access link is included in this report.

Remaining work before asking for a Production go:

1. Test assessment visibility, app switching, screen lock, non-hiding
   notifications, connection behaviour and storage on physical Android and
   iPhone devices. Browser emulation cannot establish these results.
2. Complete the manual cases in the numbered matrix: two physical devices,
   five full browser attempts, the full five-minute writing timeout, adjusted
   timing on a device and the two remaining saved payout preferences. The
   corresponding server rules are tested, but that is not a device walkthrough.
3. Confirm the latest complete staff-screen copy on a freshly authenticated
   current Preview; the real staff walkthrough used an existing MFA session on
   an older immutable Preview with the current database rules.
4. E08/E09 are tested as database triggers, not claimed as actual email receipts.
5. Keep the PR draft until the outstanding gates pass. Production requires a
   separate go and an explicit adaptation of the Preview-only Stage 2 switch.

The later provider-access task has not been started. No Production deployment,
migration, secret read/edit, payment or approval was performed.
