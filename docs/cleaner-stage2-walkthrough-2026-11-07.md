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

One clearly labelled fictional application was exercised through the actual
public form and MFA staff console. Before passing, it had zero Auth accounts.
The actual checks included required D01, duplicate submission, C01–C05, private
DBS decision publication, applicant human-review request, Manager resolution,
induction invitation, attendance, closed-host refusal, assessment timers, page
leave, one audited reopening, writing paste refusal, human writing pass and the
post-pass sign-in handoff. The remainder of the successful Part A was submitted
through the server marking commands; no marking key left the database.

The normal scheduled worker delivered E01 to the initially approved inbox and
E02/E04/E05 to `syedmouad+stage2@gmail.com`. Gmail receipt was verified. No other
person was emailed. This does not claim live delivery of every reminder or E10.

All four private upload paths accepted the deliberately labelled fictional PNG:
ID, RTW, proof of address and £1m insurance. This is test evidence, not a real
verification. The professional stayed pending and received no booking.

All five linked policy links specify a new tab. The Cleaner Terms page shows
Version 1.0 / 1 October 2026. Its actual downloaded PDF has SHA-256
`ca8941c30c9640c592bc2ad2ec12fa646ab31e5a42b1975e2dbe8944ec8a17b8`,
matching the pinned original. The normal accepted-version attachment builder is
covered automatically; actual E10 attachment delivery remains behind Stripe setup.

The full staging database smoke tested eleven/twelve-answer thresholds,
ordered evidence, fresh acceptances for an existing customer, immutable evidence,
missing setup gates and independent activation. Same-person approval failed;
a complete independent fictional case could activate. That transaction rolled
back all records: zero persisted fixtures, emails or financial operations.

## Failures found and corrected

| Finding                                                         | Correction                                                                               | Evidence                                                                                      |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| PostgREST rejected unrestricted singleton heartbeat writes      | Explicit singleton predicates                                                            | Scheduled requests succeed                                                                    |
| Old customer acceptance prevented fresh professional consent    | Separate immutable post-assessment evidence, preserving the old record                   | Existing-customer database regression passes                                                  |
| Screening evidence and action reason shared the form field name | Separate `actionNote` field                                                              | Actual screening walkthrough plus suite                                                       |
| Old page-leave marker blocked an authorised reopening           | Await old cleanup, then exchange the fresh invitation under server rules                 | Async client regression passes; old attempt remains failed                                    |
| Staff screen reported all requirements complete before setup    | Stage 2 setup requirement included in staff review; clearer document-check wording       | Dedicated staging / Production-isolation tests pass; latest signed-in UI confirmation pending |
| Follow-up worker queried nonexistent `bookings.completed_at`    | Use actual check-out time, falling back to retained invoice completion, once per booking | Real-schema offline regression and advancing scheduled follow-up heartbeat                    |

## Verification and limits

- Full application suite: **697 passing**, zero failures. Typecheck and build pass.
  The local build used dummy keys with the public staging hostname, not saved
  Production credentials. The destructive-admin test loader was updated for the
  new dependency and still asserts that those tools cannot inspect applicants.
- Isolated database suites: application 13, assessment 59, onboarding 48, pack
  12, approved workflow 31, three-year DBS 7: **170 checks** passing.
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

| Test  | Result                                                                                                                                                      |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Browser pass: unticked D01 blocked submission.                                                                                                              |
| 2     | Browser/DB/email pass: one Applied record and E01 receipt.                                                                                                  |
| 3     | Browser/DB pass: no sign-in or professional account before assessment pass.                                                                                 |
| 4     | Browser/DB pass: ordered ticks include staff, time, version and note.                                                                                       |
| 5     | DB pass: missing RTW blocks activation; final screen confirmation pending.                                                                                  |
| 6     | DB pass: missing DBS or unresolved conviction blocks activation.                                                                                            |
| 7     | DB pass: missing/same-person sign-off refused; independent fixture passed.                                                                                  |
| 8     | Automated pass: missing required acceptance rejected before writes; complete browser flow awaits Stripe.                                                    |
| 9     | DB pass: immutable fresh evidence includes the required fields; browser handoff awaits Stripe.                                                              |
| 10    | Browser pass for new-tab links and Cleaner Terms version/PDF fingerprint; all attachment generation covered automatically.                                  |
| 11    | **Incomplete:** own Stripe sandbox setup failed; dashboard requires authenticator. All three schedule choices exist; actual saved choices need walkthrough. |
| 12    | DB pass: missing emergency contact blocks setup/activation.                                                                                                 |
| 13    | DB pass in rollback; **actual setup/welcome delivery incomplete** behind Stripe.                                                                            |
| 14    | New-work guards are built; full offer-matrix walkthrough still required.                                                                                    |
| 15    | Existing no-substitute flow preserved; no new reassignment implementation.                                                                                  |
| 16–27 | Existing working-life/payment features, outside this onboarding change; not newly signed off here.                                                          |
| 28    | RTW expiry/reminder database rules retained; actual E06 delivery not exercised.                                                                             |
| 29    | Stage 1 version workflow preserved; not republished or newly exercised here.                                                                                |
| 30    | DB pass: unlisted/Developer private access refused and logged.                                                                                              |
| 31    | Browser/DB pass: named MFA private opening and evidence upload logged.                                                                                      |
| 32    | DB pass for rejection/outbox/retention date; actual E03 receipt not exercised.                                                                              |
| 33    | Isolated retention/hold/idempotency checks pass; no unrelated remote records deleted.                                                                       |
| 34–35 | Existing data-rights/HMRC tools, unchanged; not newly walked through.                                                                                       |
| 36    | Staff/MFA gates pass automatically; actual named MFA session used for walkthrough.                                                                          |
| 37    | Public page/browser storage check passes; physical-phone assessment storage check pending.                                                                  |
| 38    | Browser/DB pass: closed host exposes no questions.                                                                                                          |
| 39    | DB pass: second session replaces first; physical two-device check pending.                                                                                  |
| 40    | Browser/DB pass: ten-second expiry moves forward; server clock authoritative.                                                                               |
| 41    | DB pass: previous/future answers refused; browser has no back-question control.                                                                             |
| 42    | Actual database threshold smoke passes; actual final-failure email to an allowed alias remains pending.                                                     |
| 43    | Server random/core/uniqueness checks pass; five full browser attempts not completed.                                                                        |
| 44    | Browser pass for page leave and logged reason; phone app-switch/lock matrix pending.                                                                        |
| 45    | **Pending physical Android/iPhone non-hiding notification test.**                                                                                           |
| 46    | Server heartbeat grace checks pass; actual network interruption/device test pending.                                                                        |
| 47    | Bank access/current-question payload/source scanner pass; full physical-device traffic inspection pending.                                                  |
| 48    | DB/API pass: staff cannot alter automatic marks.                                                                                                            |
| 49    | Browser pass: paste refused; server chooses from the private five prompts.                                                                                  |
| 50    | DB recovery auto-submission pass; five-minute browser timeout not waited out.                                                                               |
| 51    | DB pass: human writing failure awaits Manager; live fail-email path pending.                                                                                |
| 52    | Browser pass: human writing pass unlocks acceptance/account setup.                                                                                          |
| 53    | DB pass for individual timing multipliers and minimal audit; device adjustment walkthrough pending.                                                         |
| 54    | Failure/reason appears in host overview; no Meet integration or removal action.                                                                             |
| 55    | Browser/DB pass: one audited fresh attempt; second reopening refused automatically.                                                                         |
| 56    | Isolated DB pass: one month blocked / three months allowed.                                                                                                 |
| 57    | Isolated DB pass: expired answers/writing removed, open cases retained.                                                                                     |

## Migration ledger

The original six Stage 2 migrations remain applied:
`20261105020000`, `20261105021000`, `20261105022000`, `20261105102000`,
`20261105104243`, `20261105111015`.

The following nine additions are applied **only to staging**, in order:

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

Each was checked against the ledger before execution-time IDs were aligned to
the checked-in version; statements were not rewritten. The first eight additions
match local sources after normalising line endings and the final newline. The
latest migration's complete raw source matched exactly (MD5
`8e9063de7153a1b4fc27bab54cce72d7`). Earlier scheduler/runtime entries differ only
in trailing newline formatting, not SQL content.

The private bank import contains no real answer key in the migration ledger.
`20261104210001` remains held. Do not include `supabase/staging/` files or branch
dependency merges in a future Production package.

## Test access cleanup and remaining release gates

The persisted fictional case has been closed and its provider suspended. Its
test Auth user is banned, account APIs disabled, all sessions removed and refresh
tokens revoked. There are **zero active assessment links, decision links, sessions
or refresh tokens**, and zero bookings. The real validation functions reject the
revoked decision and expired invitation. Audit records and the clearly labelled
private fictional evidence remain for inspection; no real person was approved.

Remaining work before asking for a Production go:

1. Complete the owner's Stripe dashboard authenticator, diagnose and fix the
   actual sandbox setup error, then test the three saved payout schedules.
2. With a fresh authorised fictional case, finish actual acceptance/setup,
   welcome email/PDF delivery and the latest staff review screens.
3. Complete the outstanding failure/reminder email and browser matrix above.
4. Test visibility, lock, notification and connection behaviour on real Android
   and iPhone devices. Emulation cannot establish these results.
5. Keep the PR draft until these gates pass. Production needs a separate go;
   its rollout must also adapt the deliberately Preview-only Stage 2 switch.

The other/new provider-access task has not been started. No Production deployment,
migration, secret read/edit, payment or approval was performed.
