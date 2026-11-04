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
the private providers table. Neither migration has been applied remotely yet.
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
question bank and server marking endpoint are not imported/implemented yet.

The separate Cleaner Onboarding Process and Cleaner Onboarding Checklist are
referenced by the specification but were not found in the supplied folders.
Exact application/invitation/rejection email text and the referenced DBS process
must be checked against those sources; do not invent wording or publish it as
the client's exact copy. The owner has been asked to supply these documents.

## Test sheet mapping

These are implementation checkpoints, NOT a signed acceptance sheet. A pure
policy test does not prove browser behaviour, persistent permissions or delivery.

| Test | Requirement | Current evidence and remaining work |
| --- | --- | --- |
| 38 | Host opens assessment before access | Pending session/login gates and browser test |
| 39 | Second device revokes first | Pending persisted session generation and audit |
| 40 | Server question deadline | Offline boundary policy tested; transactional marking pending |
| 41 | No backwards navigation | Pending server question sequence and UI |
| 42 | Twelve passes; eleven fails | Offline threshold policy tested; immutable server grading/email pending |
| 43 | Five core and ten random, no repeats | Offline selection policy tested; private bank and choice shuffle pending |
| 44 | Page leave ends attempt | Pending page visibility, reload/back handling and server audit |
| 45 | Non-hiding notification continues | Pending browser/device test |
| 46 | Short network grace | Offline five-second boundary tested; heartbeat/reconnection pending |
| 47 | No answer key on device | Real bank not yet imported; payload/bundle inspection still required |
| 48 | Staff cannot alter score | Pending persisted score permission/immutability tests |
| 49 | Random writing prompt, no paste | Pending prompt selection, paste/drop handlers and browser test |
| 50 | Five-minute auto-submit | Offline writing deadline tested; UI and persisted auto-submit pending |
| 51 | Writing fail needs Manager | Offline decision phase tested; scoped review/API/email pending |
| 52 | Writing pass reaches acceptances | Offline phase tested; account upgrade and acceptances pending |
| 53 | Double/triple individual adjustment | Offline timer multipliers tested; staff setting and minimised audit pending |
| 54 | Host failure flag | Pending console and live progress |
| 55 | Manager reopens once | Offline eligibility tested; persisted single-reopen guard pending |
| 56 | Three-month reapplication rule | Pending normalised identity matching and deadline tests |
| 57 | Assessment retention six months | Pending retention integration with legal holds |

Related onboarding tests 1–15, 28–36 must be rerun against the completed Stage 2
flow. Application-without-login, limited invitation login, activation gates,
manual induction attendance, expiry suspension/reminders, no-substitute action,
DBS explanation/written decision/review and 14-day suspension review are pending.
Existing Stage 1 staff roles and independent second sign-off must be reused, not
weakened or replaced.

The optional "Staff confirm each automatic fail before it is final" decision
policy defaults OFF. Persisted admin setting, pending-review UI and permission
tests are still to implement; the constant alone is not an admin setting.

Real Android/iPhone visibility and wake-lock tests remain required. No claim is
made that a browser can reliably report an event after it has been killed; the
server-side grace/heartbeat must cover missing final client events.
