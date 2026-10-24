# Launch safety and cleaner pay

Branch: `codex/launch-safety-and-cleaner-pay`, from `codex/staging`.

**Production is not authorised.** Obtain the user's explicit “go” after staging results, and confirm the other release bot has stopped deploying. Do not use a production database, key or deployment for testing.

## Implementation

1. New cleaning bookings snapshot the revised cancellation bands and apply charges only to paid cleaning hours. Add-ons/products are refunded to their original source payments; tips cannot be purchased before a completed visit and are not included in any cancellation-charge basis. Existing bookings retain their immutable agreed terms. Qualifying customer cancellations in the statutory 14-day period before work starts take precedence over the bands.
2. A durable cancellation settlement records proportional cleaner compensation. Staff can reduce the charge from the resolution desk; cleaners can waive compensation from Earnings. A waiver after payout reverses the original cleaner transfer before refunding the additional amount. Revisions, active-operation locks, Stripe metadata, idempotency and recovery prevent double transfers/refunds.
3. New-booking pay defaults: standard £15/hour; Signature Deep Clean and End of Tenancy £17.50/hour. Add-on reserved time is not silently treated as cleaning hours. Cleaner receives £4 where the £5 products line is paid and not refunded.
4. Multi-charge payouts pay each component from the payment that actually funded it. The existing money-operation/payout ledgers remain in use. Missing connected account, self-booking, legacy destination charges, disputes and open blocking cases do not release money. Reconciliation understands the component transfers and their recorded reversals.
5. Final payment buttons show the obligation and amount; regular card setup states £0 today, without claiming the series is paid. No VAT is charged. Payment timing is unchanged.
6. Professional registration requires an unticked safeguarding checkbox with the displayed live version. The server rejects missing/stale acceptance and records version/time. New applicants cannot bypass the requirement before either cleaning or handyman approval. Existing professionals are not given fabricated retrospective acceptances.
7. DBS evidence is available to named, MFA-signed-in onboarding staff only. Every staff record/certificate view and permission-list change is logged. Direct staff table/Storage reads cannot bypass logging. Certificate responses are streamed without a reusable signed URL and with `no-store`. Applicant self-access and automated approval/renewal checks remain intact.
8. Check-in and no-access location verification use coordinates in memory only. Database triggers discard coordinates from old writers too. Existing precise values are deleted from check-ins, OTP challenges and booking-event metadata, while time/distance/result remain. Public postcode centroids used for matching are not device GPS and are not deleted. No-access reports are server-blocked until 15 minutes after the scheduled start.

## Migrations (staging first, source/ledger checks required)

- `20261024000100_checkin_location_minimisation.sql`
- `20261024000200_named_dbs_onboarding_access.sql`
- `20261024000300_professional_safeguarding.sql`
- `20261024000400_launch_cleaning_pay_terms.sql`
- `20261024000500_cleaning_cancellation_settlements.sql`
- `20261024000600_cleaning_payout_parts.sql`

Apply in order and record the exact source in the migration ledger. Do not overwrite an existing version whose source differs. The first migration includes an irreversible privacy deletion: do not back up the precise coordinates into a report or another table. The supplied safeguarding policy is published as Version 1.0; other new PDF policies are not silently substituted for existing live terms.

Deploy the matching Preview application and **staging** visit-payment worker together. Rebuild/check the worker with `npm run build:visit-worker` / `npm run check:visit-worker`; the worker now also recovers cancellation settlements and known component-payout plans. Never deploy the worker to the production project as part of staging tests.

## Verification

- `npm test` — full existing suite plus new pay, cancellation, statutory-period, safeguarding and multi-source payout tests.
- `npx tsc --noEmit`.
- Lint changed source files (pre-existing navigation/dependency warnings are not silently refactored).
- Next.js build, preserving Next.js/eslint-config-next 16.4.2.
- `supabase/tests/launch_safety.sql` on isolated PostgreSQL 17 only; it refuses any database not named `launch_safety_test`. It loads the actual existing billing prepare/finalise functions and the six new migrations. Its identity/transition stubs deliberately do not replace live staging tests.
- Live staging still required: migrations/ledger, browser registration + named-staff DBS checks, one-off and regular test bookings, cancellation/no access, a paid products addition, completion payout, waiver before/after payout, staff reduction, repeated/recovered requests and scheduler/reconciliation checks. Use fictional accounts/data and the staging Stripe Sandbox only.

Read-only staging preflight on 24 October: newest recorded migration `20261023000200`; both stored check-in coordinate-column counts were zero. No production checks or mutations were performed.

### Staging progress — 24 October 2026

- All six migrations are installed on `comwdjprdedmsnxtvuuk`, with exact source hashes matched in `supabase_migrations.schema_migrations`.
- The first batch stopped safely on a CRLF/LF difference in an existing function and rolled back entirely (zero migrations committed). The unapplied migration was corrected to normalise line endings only, a regression assertion was added, and the corrected atomic batch succeeded. Applied migration sources are now immutable.
- Postflight: zero precise coordinates in check-ins, check-in challenges or booking-event metadata; safeguarding Version 1.0 published; onboarding access list empty as intended.
- Matching staging `visit-payments` worker deployed with source SHA `306fa34f90d025b30ed7ec43585d93eb096963759ff2f8fb6905d2fa52e06941`. The existing five-minute scheduler returned HTTP 200 with that exact source at `2026-10-24T18:55:00Z`.
- The branch Preview and safeguarding page load. Staff password plus authenticator sign-in was completed, and authenticated settings display the agreed £15 / £17.50 pay, £4 of £5 products payment and 100/75/50/30 refund percentages.
- Four real staging public-key probes pass: anonymous access to DBS evidence, onboarding staff, access audit and the audited viewing RPC is denied. Run `node --env-file=.env.staging.local scripts/test-staging-launch-anonymous.mjs`; this tool refuses a non-staging URL and never uses or logs a service-role key.
- Before any named grant, the signed-in admin sees the restricted DBS notice and cannot open the synthetic professional's certificate endpoint. After explicit user approval, exactly the requester's signed-in staging account was saved to the onboarding list; other staff remain unselected. The selection persisted after refresh.
- Named-staff success checks pass: the synthetic DBS record is visible; the existing verified fixture correctly reports its certificate copy as deleted; a separate fictional, unverified fixture's protected download exactly matches the original 1,997-byte PDF (SHA-256 `c48115789e09d6b6a36884fa2cc9e3bdaedfa31e00d7a57326d79a5be9951c73`). The admin audit UI shows `staff_list_changed`, `record_view` and both `certificate_view` requests with the correct actor/time. The four anonymous denial probes still pass after the grant.
- File-view fixture: the pre-existing `[TEST ONLY] Invited professional` (`d0028af3-6e1a-4a66-bba0-e2b8b773b90b`) now has a pending record and a private `STAGING-TEST-ONLY-NOT-A-DBS-CERTIFICATE.pdf`. The PDF prominently says it is not evidence; no professional was verified or approved. This is staging test data, not a production migration or a genuine DBS certificate.
- Inline PDF display is **not** marked passed: the in-app browser showed a blank preview without a console error. The authenticated download was byte-verified and the downloaded file parses/renders correctly. A regular-browser inline-view check remains on the release checklist.
- Two further automatic worker runs at `2026-10-24T19:40:00Z` and `19:45:00Z` returned HTTP 200 with the exact new source SHA, no timeouts and mode `staging`.
- Live registration acceptance and Stripe Sandbox scenarios remain pending; do not mark them passed from isolated tests. A temporary staging-only, scheduler-secret-protected test runner has been proposed for the Sandbox tests, but has not been deployed without the user's approval. Production remains untouched.
- Automated checks: 428 application tests and 36 isolated PostgreSQL assertions pass; typecheck, Next.js 16.4.2 build and all GitHub checks pass.
- Stable branch Preview: <https://opulence-bliss-app-mainv2-git-codex-la-bd07f8-muad500s-projects.vercel.app>.

## Release gates

Live staging results must pass; publish/approve consistent customer-policy wording from `launch-policy-wording-checklist.md`; explicitly name onboarding staff in Settings; obtain the user's production “go”; coordinate the release slot with the other bot. Keep the handyman marketplace off in production. The other bot's PR #47 is separate and must not be released concurrently.

The user specifically requires confirmation of the Production DBS onboarding list immediately before release. It must include the requester's admin account and the client's verifying admin account once that account exists. An empty list is acceptable for the present restricted staging test, **not** for Production launch. Do not infer or silently grant other staff access.
