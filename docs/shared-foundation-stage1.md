# Stage 1: shared account foundation

Prepared 4 November 2026. Branch: `codex/shared-foundation-stage1`.
Base: `codex/launch-polish` at `73118cbd8ff8fd99e444f94dbc5ffb188e14e893`.
PR target: `codex/staging`. PR #59 is still open; rebase onto staging after it merges.

This is a **local implementation and test report**, not a staging-deployment pass.
The user's deployment-slot approval is still required before a push that creates a Preview,
remote migrations, or a staging deployment. Production has not been touched.

## Sources

- [Cleaner specification, including its 57-test sheet and staff matrix](https://docs.google.com/document/d/1n6TcmfxfFwhO5izeqW1HSWufQ9XyHFhdV09h0n8NwAM/edit)
- [Handyman specification and test sheet](https://docs.google.com/document/d/18vY-PydepVu0pDYRhkgGakMTHU7lrBy3Ou1JboswG_8/edit)
- [Partner specification and test sheet](https://docs.google.com/document/d/1rEo9cbG199Gf18UrrAO2Oc4WGQo8cKzpHnDNvnLSBQA/edit)

The assessment answer pack was not fetched. No assessment answers were added to the
repository, browser, tests or fixtures. Assessments belong to Stage 2.

## Implemented

### One identity with role-specific access

The existing Supabase identity, customer profile, professional record and service
approvals remain their sources of truth. An owned-role API and account menu expose
customer, cleaner, property maintenance and Partner roles. Selecting a role only
navigates; it cannot apply, approve, activate or grant a role. Existing cleaners
retain their current approvals, booked pay and working hours.

Each role has a status, document group and pay destination. Cleaner earnings show
cleaning records; property maintenance earnings show accepted quote records.
Pending applications cannot read earnings through the new role page. Shared ID,
right-to-work and account details are not duplicated.

The Partner membership is a foundation for the later Partner engine, not a live
application/referral/reward system. A handyman membership excludes Partner in both
directions, including when marketplace options are hidden. A cleaner must be Active
before adding Partner. The reward route for cleaner plus Partner remains explicitly
undecided, as the Partner spec requires a client decision. No reward is paid.

The existing separate customer/worker Android audience restrictions remain. The
role switch is for the website; it adds no cookie or browser-storage preference.

### Scoped staff access

| Staff role        | Access                                                                                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Onboarding member | Checklist/first review, named private-record opening, service suspension with a reason. Cannot provide final activation, reject/reopen an application, decide appeals or use Manager tools. |
| Manager           | Onboarding and management, application decisions/appeals, permission changes and second sign-off subject to independence.                                                                   |
| Second sign-off   | Review summary and independent final activation. Cannot perform first review, open private ID/DBS evidence, suspend or manage accounts.                                                     |
| Developer         | Access information only. No live private evidence or operational tools.                                                                                                                     |

Every role requires a fresh staff identity and a verified authenticator session.
Existing active administrators are preserved as Managers; no new named DBS access
is granted. A Manager must classify any existing technical account as Developer
explicitly, rather than guessing a person's job from their email.

Private ID and DBS records require the separate existing named onboarding list.
Deliberate openings and refusals are logged; a refusal returns no record, and its
audit survives. ID records are no longer preloaded into the professional detail
page. Private files stream through a fresh permission check instead of a reusable
Storage link. Existing RLS and approval-function identities are preserved.

PR #59's independent activation guard is reused: the inviter, document checker or
first reviewer cannot activate the person they onboarded. No parallel approval
engine or fictional approval has been created remotely.

### Document changes and evidence

A Manager can prepare an approved document snapshot, PDF fingerprint, summary and
future effective date. This tool **does not publish it**. Customer notices use the
existing protected account-email scheduler, production/staging sender rules,
recipient allowlist, leased batches, retries and stable email idempotency keys.

Publication requires the approved snapshot/PDF and completed customer notices.
The thirty days run from actual successful sending, rather than queue insertion.
The existing booking consent records satisfy customer acceptance at the next
booking. Checkout/payment code was not changed.

When an approved professional document version is separately published, the next
portal visit shows its version, approved text/PDF and change summary. The required
box starts unticked. New work is blocked until acceptance; already accepted work
remains usable. The role document list keeps the correct approved-version link
after acceptance.

Acceptance saves user, role, UTC time, observed IP, user agent, exact box wording,
checked state, version, full approved wording and fingerprints. It is immutable
and idempotent. Its parent is the existing account acceptance record, so the
existing six-year/last-contract/open-case retention gate also owns deletion of
the role evidence. Published legal text, current declarations, archives and PDFs
were not replaced.

## Numbered acceptance-sheet mapping

“Local pass” below is the matching Stage 1 portion, tested with fictional data.
It is not a signed-off full-spec or deployed-staging result.

| Sheet test  | Stage 1 evidence/result                                                                                                                          | Still needed                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Cleaner 7   | Local pass: no activation after first review; first reviewer cannot activate; independent second reviewer can. PR #59 guards retained.           | Signed-in staging walkthrough.                                                       |
| Cleaner 9   | Local pass: required unticked box, trusted identity/IP, exact wording/version/fingerprint/time, one immutable acceptance on retry.               | Signed-in staging acceptance with fictional documents.                               |
| Cleaner 10  | Local pass: versioned legal routes and current approved-version links in a new tab. Current Version 1.0 publication remains unchanged.           | Browser/PDF walkthrough.                                                             |
| Cleaner 29  | Local pass: fictional Version 1.1 prompts, blocks new offers/assignments, leaves accepted work usable and restores eligibility after acceptance. | Isolated staging transaction/UI check; do not publish fictional legal text.          |
| Cleaner 30  | Local pass: unnamed/developer private access refused, no record returned, refusal logged.                                                        | Staging staff session check.                                                         |
| Cleaner 31  | Local pass: named, authenticator-verified onboarding opening allowed and logged.                                                                 | Staging staff session check.                                                         |
| Cleaner 36  | Local pass: password-only, phone-only, missing/revoked/unverified authenticator sessions refused; scope checked at page/API/database layers.     | Actual staging authenticator sign-in.                                                |
| Cleaner 37  | No new storage/cookie code; existing necessary session/audience handling retained.                                                               | Browser cookie/storage inspection; not a full pass yet.                              |
| Handyman 34 | Local pass for role ownership/status isolation, no pay-source merging, separate pay/document pages, pending pay lock and flag visibility.        | Dual-role staging browser walkthrough.                                               |
| Handyman 37 | Current Version 1.0 declaration regression passes; current-version legal links and saved evidence covered locally.                               | Signed-in staging declaration/PDF walkthrough.                                       |
| Partner 9   | Local pass: no Partner choice for a handyman; backend rejects adding either incompatible membership, even with marketplace hidden.               | Staging role-switch walkthrough.                                                     |
| Partner 10  | Partial: cleaner/customer/Partner memberships coexist and switch without overwriting pay sources.                                                | Combined-role reward route decision and Stage 3 reward engine; not a full test pass. |

Cleaner 5/6/8/12/13 and handyman 8 have broader onboarding, convictions,
assessment and welcome-email expectations. Only the reused approval/MFA/evidence
parts are covered here. They are not claimed as full passes. Cleaner 38–57
assessment cases belong to Stage 2. Partner reward/referral/payment cases belong
to Stage 3. Existing regression results do not imply these new flows are built.

## Validation

- `npm test`: **593 passed, 0 failed, 0 skipped**, including 15 new route/UI tests.
- Disposable PostgreSQL: **76 checks passed**, executing the actual two PR #59
  activation migrations plus the three Stage 1 migrations against a minimal
  fictional schema. This is not a copy of the full staging database.
- TypeScript: passed. Optimised Next build: passed, using dummy CI credentials.
- Prettier: applied to new/touched code. SQL formatted for readability.
- Changed-file ESLint: zero errors; three pre-existing warnings (full-page sign-out
  navigation in two components and the dashboard harness's unused prefetch prop).
- Read-only staging checks: all seven PR #59 ledger entries match their source;
  all three new Stage 1 versions are absent, as expected. Existing schema/guards
  inspected without reading private professional records.
- No real email, remote fixture, migration, permission assignment, payment,
  deployment, push or PR has been made for Stage 1 yet.

## Staging release preparation

Run `node scripts/prepare-shared-foundation-staging.mjs` locally to prepare
`artifacts/shared-foundation-stage1/` (ignored): read-only ledger check, transactional
dry run, apply batch and manifest. This preparation makes no network call.
The apply package checks the staging Vault marker and exact source of all seven
PR #59 prerequisite migrations, refuses a source mismatch, skips exact matches,
and records complete migration source in the ledger.

Apply only these new migrations, in order, **after the user grants the staging slot**:

1. `20261104004744_shared_account_role_foundation.sql`
2. `20261104004746_scoped_staff_roles.sql`
3. `20261104004748_document_change_acceptance_workflow.sql`

Before a Preview deploy: check PR #59 status, fetch and rebase onto updated
`codex/staging` after merge; verify the target still uses staging Supabase and test
Stripe, and keep marketplace off. Re-run checks if the rebase changes dependencies.
No payment worker change or new scheduler credential is needed by this branch.
Verify that staging's normal protected account-security email schedule reaches
the deployed notice handler before testing a clearly marked email to an approved
test inbox. Never queue fictional legal notices to real customers.

Then run the outstanding signed-in/phone/keyboard/MFA/PDF/storage checks, record
actual email delivery and open the PR into `codex/staging`. Production requires
separate explicit approval. Keep payments, checkout, prices, loyalty, Booking
Credit, marketplace implementation and published legal documents outside this PR.
