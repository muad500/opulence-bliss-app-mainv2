# Cleaner Stage 2 staging implementation

Staging only. Production requires the owner's explicit go. Checkout, loyalty,
Booking Credit and tips belong to the other bot and are not modified here.

## Dependencies and rollout

Created `codex/cleaner-stage2` from staging `36aace6`, then brought the Stage 1
branch in as a dependency: PR #60 is still open against staging, although its
clean release is already live on main. This branch does not merge PR #60, change
main, or deploy production. Rebase after the Stage 1 staging merge.

Provider privacy uses expand/contract migrations:

1. `20261104210000` installs the safe projection and booking relationship.
2. Deploy updated customer readers; coordinate the other staging previews.
3. `20261104210001` restricts direct private-provider reads to the professional
   owner or authorised MFA staff. Service-role background work remains intact.

The second migration must not be applied while old customer queries still read
the private providers table. Only the additive first migration has been applied
to staging (see the rollout handoff below); the restriction is still pending.
The customer projection excludes stored full names, profile/contact/payment
identifiers and document references. Legacy biography/experience fields are
null compatibility placeholders; the UI no longer receives those stored fields.
Public approval metadata is retained for the existing eligibility controls.
The no-show notification recipient is resolved only server-side after ownership
checks, rather than disclosed through a customer-readable provider join.

Offline privacy checks: `PGLITE_MODULE=<local package> node
scripts/test-provider-customer-privacy-db.mjs`. Fixtures are clearly fictional;
the script cannot connect to a network database.

## Assessment source and secrecy

Sources are the supplied Cleaner Account Build Specification and Test Checklist
v1.0 and Cleaner Assessment Content Pack v1.0. The bank's correct options are
not copied into this document, browser code, fixtures or test output. The initial
policy module contains only rules and non-secret screen/email copy. The actual
question bank is not imported yet. A private-schema transactional marking engine
and bounded session endpoint now exist, tested using an invented bank only.

The separate Cleaner Onboarding Process and Cleaner Onboarding Checklist are
referenced by the specification but were not found in the supplied folders.
The owner has asked the client for them and authorised continuing all work that
does not depend on those documents. Central placeholders are held in
`lib/cleanerOnboardingPlaceholders.ts`, not scattered through UI or email code.
Unpublished/placeholder wording cannot be sent as final applicant email.

### Outstanding source references

| Reference | Missing source detail | Work that can proceed |
| --- | --- | --- |
| Process 9.1 | Exact application-received email | No-login application record and queued/held delivery |
| Process 9.3 | Exact rejection email | Stage/reason audit and six-month retention |
| Process invitation wording (section unspecified) | Exact induction invitation text | Limited-login and host-session mechanics |
| Process 3.1A | Exact application privacy/checks declaration | Required unticked consent and versioned evidence machinery |
| Onboarding Checklist | Full desk-screening checklist | Status sequence and known hard gates in build spec 5.3 |
| Process 3.3 | Interview checklist and scoring criteria | Audited interview record, without invented pass criteria |
| Process 3.7 | Detailed live identity/right-to-work checklist | Date/checker/type/outcome/expiry fields expressly specified |
| Process 3.9/3.14 | Detailed escalation and Manager decision procedure | Manager-only case locking and immutable decision audit |
| Process 4.1 | First-job follow-up checklist | 24-hour reminder after the first completed booking |
| Process 4.2 | Fifth-job review checklist | Fifth-booking reminder |

Process 3.21/3.21A/3.21B/3.21C and 9.6 are not missing wording dependencies:
the build spec and Content Pack already supply the assessment rules, timers,
failure/review/waiting/passed copy and manual host flag requirement. The build
spec also supplies the RTW reminder times (3.8) and three-year DBS renewal (4.4).

### Query rollout handoff — 5 November

Query-only PR #64 was merged into staging at
`92486e1d2824cead16fc869085bc2019fc7dc575`. Only additive migration
`20261104210000` was installed there; source MD5
`596c43722e342afd45e91b564fc54a62` matched its ledger. The restriction policy and
migration `20261104210001` remain absent. Wait for the owner's confirmation that
the rebased PR #62 preview works before installing the restriction. Production
remains untouched and will need the same ordered rollout and a separate go.

## Test sheet mapping

These are implementation checkpoints, NOT a signed acceptance sheet. A pure
policy test does not prove browser behaviour, persistent permissions or delivery.

| Test | Requirement | Current evidence and remaining work |
| --- | --- | --- |
| 38 | Host opens assessment before access | Offline DB host-open and manual-attendance gates pass; console/browser pending |
| 39 | Second device revokes first | Offline DB session replacement/old-device denial pass; browser pending |
| 40 | Server question deadline | Offline DB checks server deadline and marks expired question wrong |
| 41 | No backwards navigation | Offline DB rejects previous/future question; one-question UI built, browser acceptance pending |
| 42 | Twelve passes; eleven fails | Offline DB checks both thresholds and persisted grading; email/browser pending |
| 43 | Five core and ten random, no repeats | Offline DB checks 15 unique questions/core inclusion; frozen choices shuffled; real pack pending |
| 44 | Page leave ends attempt | Server failure tested; UI sends leave on hidden/pagehide/back and refuses reload resume; browser acceptance pending |
| 45 | Non-hiding notification continues | Pending browser/device test |
| 46 | Short network grace | Offline DB missing-heartbeat failure passes; browser reconnection pending |
| 47 | No answer key on device | Offline DB prevents browser/staff/service bulk bank reads; bounded payload test passes; real bank/bundle inspection pending |
| 48 | Staff cannot alter score | API-role direct writes denied; route ignores submitted marks; full role-matrix browser checks pending |
| 49 | Random writing prompt, no paste | Server prompt selection and client paste/drop prevention built; browser/device acceptance pending |
| 50 | Five-minute auto-submit | Offline DB deadline submits last saved writing and rejects late replacement; UI autosaves/polls, background scheduler pending |
| 51 | Writing fail needs Manager | Offline DB holds human fail for Manager and enforces staff MFA; review UI/email pending |
| 52 | Writing pass reaches acceptances | Offline DB sets Assessment passed, never Active; full account upgrade/acceptances pending |
| 53 | Double/triple individual adjustment | Offline policy/DB timing passes; staff adjustment UI/minimised audit pending |
| 54 | Host failure flag | Pending console and live progress |
| 55 | Manager reopens once | Offline DB rejects non-Manager, second reopening and stale attempt; creates fresh attempt without changing old marks |
| 56 | Three-month reapplication rule | Pending normalised identity matching and deadline tests |
| 57 | Assessment retention six months | Pending retention integration with legal holds |

Related onboarding tests 1–15, 28–36 must be rerun against the completed Stage 2
flow. Application-without-login storage and validation have 13 offline DB checks;
the public application form/endpoint are not built yet. Limited invitation login
has an HttpOnly, Secure, same-site session, hashes stored in the private schema,
and no Supabase account or job access. Invitation issuance/UI, activation gates,
manual induction attendance, expiry suspension/reminders, no-substitute action,
DBS explanation/written decision/review and 14-day suspension review are pending.
Existing Stage 1 staff roles and independent second sign-off must be reused, not
weakened or replaced.

The optional "Staff confirm each automatic fail before it is final" decision
policy defaults OFF. Its persisted setting and Manager/MFA/reason controls are
tested offline; the admin settings UI and pending-review UI remain to implement.

## Current checkpoint and verification

Unapplied migrations `20261105020000` and `20261105021000` hold no-login
applications and the private assessment engine. Neither was run on shared staging
or production. The assessment endpoint is off by default and explicitly refuses
Production and any database except the isolated staging project even if enabled.
It uses no general account session, and ignores device-supplied scores/times.

- Application tests: 619 passing, including ten real-route isolation tests.
- Offline application DB: 13 checks passing; no auth/provider account created.
- Offline assessment DB: 38 checks passing; all question/answer fixtures invented.
- Offline provider privacy DB: 20 checks; additive rollout DB: 9 checks.
- Typecheck and scoped new-code lint pass. Existing unrelated RatingGate lint
  issue remains documented in the PR; not changed here.

The staging-only browser page now has the exact supplied rules/failure/waiting/
passed copy, an unticked rules box, one-question UI, server-synchronised timer,
writing autosave, no-paste/drop handlers, wake-lock request and page-leave/reload
handling. It contains no bank or answer key. It is not enabled on staging yet.
Manual browser/device acceptance remains outstanding: these controls must not
be described as tested on real devices until the end-to-end flow is deployed.

The engine still needs invitation issue flow, host/review console,
secure real-pack import, background timeout/retention
processing and the rest of the onboarding workflow before end-to-end acceptance.
These checkpoint tests are not a claim that Stage 2 is ready for applicants.

Real Android/iPhone visibility and wake-lock tests remain required. No claim is
made that a browser can reliably report an event after it has been killed; the
server-side grace/heartbeat must cover missing final client events.
