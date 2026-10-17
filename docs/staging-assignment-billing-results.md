# Assignment-aware visit billing — staging results

Tested 18 October 2026 (Asia/Kolkata). Production is unchanged; this work must not be merged without approval.

## Environment

- Supabase: `comwdjprdedmsnxtvuuk` only.
- Stripe sandbox: `acct_1UKQ4A2NzINBHbzj`, test secret key, automatic capture.
- Staging: https://opulence-bliss-app-mainv2-git-codex-staging-muad500s-projects.vercel.app/
- Permanent scheduler: `opulence-staging-visit-payments`, every five minutes. JWT verification and its existing private request secret remain required.
- Deployed worker source SHA-256: `8e6aae6f1bafbb403326b6591fef1f35cf17979c604b0052bb40dd2c36ba52b3`; its authenticated staging invocation returned HTTP 200.
- Email is not configured in the worker. SMS remains off. No Production credentials were pulled, printed or changed; no new Vercel CLI login was used.

## Passing real Stripe/database cases

Tests use disposable fictional customers and professionals. New synthetic professionals are hidden and suspended after testing; existing accounts and checks are unchanged. Private credentials and raw test reports are excluded from Git.

| Case | Verified result |
| --- | --- |
| Unassigned later visit within 24 hours | Remains offered and unpaid; no payment attempt or new PaymentIntent. Admin alert and exact customer warning appear once. Email copies are queued, not sent. |
| Products on a regular series | £5 is a separate line on every visit. |
| Stale offer expiry on a visit weeks away | Visit stays open; no premature cancellation or refund. |
| Assigned later visit within 48 hours | £37.98 captured once; repeated charging, scheduler work and delayed operation reconciliation do not duplicate it. Example: `ba9a7487-9e41-46eb-9912-96677c1706c7`, `pi_3URd932NzINBHbzj1bz4TL1V`. |
| Visits 1 and 2 unmatched | Both cancelled. First visit's £37.98 refunded in full; second had no charge/refund. Visits 3–6 remain uncharged and the series pauses once. Customer pause notice deduplicated. Series: `c9a199cf-dfce-40a6-977b-2a302b33a822`. |
| Explicit customer resume | Stale generation rejected; owner can explicitly resume. Cancelled visits stay cancelled. |
| Delayed captured payment after pause | Recorded once and refunded once; series remains paused. `ca0e7ec4-8597-4eff-a20e-1839469aca11`, `pi_3URd9g2NzINBHbzj1gvOTGFY`. This deliberately defers application reconciliation of a real sandbox capture; it does not claim a separate Stripe dashboard resend. |
| Late acceptance, failed card, then updated card | Short window starts on failure; another failed attempt does not extend it. A newly saved valid card succeeds within the window. `0459a91a-2aeb-4b47-b8e3-5442f6ed6ed6`. |
| Card-update window expires | After advancing only the disposable fixture's deadline, visit cancels with no additional PaymentIntent. `e42fa61c-44de-4949-936b-789d5f804f61`. |
| One-off unmatched deadline | Original £45.98 capture refunded in full once; cancellation appears in-app and email is queued. `7996395d-4aec-43bb-bb2b-33e193bfa032`, `pi_3URdAV2NzINBHbzj0IVtgpgM`. |
| Delayed captured add-on after pause | £20 add-on refunded, existing £37.98 base payment retained. Visit enters review so it cannot recharge the base. `7ab03640-6bdd-4649-80b3-d42239fd51f6`. |
| Rescheduled warning | Old warning fails the fresh database check and is cancelled without contacting the email provider. `8e216357-133e-460f-92aa-0e00f4044b6d`. |

Additional rollback-only database assertions passed: another customer cannot resume a foreign series; an administrator can explicitly resume; and the shared deadline function returns the earlier of failure + 2 hours or visit − 3 hours, with immediate expiry when acceptance is under 3 hours before the visit. The under-three-hours boundary was tested against the database function, rather than creating an out-of-hours booking.

The full local test suite, TypeScript/build, generated-worker freshness check and lint on the changed billing modules/new integration tests pass. Recovery tests cover a pause between intent creation and confirmation, unassigned/paused prepared operations, lost responses and duplicate retries. Email transport tests cover stable idempotency keys, stale notices, failure redaction and invalid links.

## Staging migrations

Exact source checksums are recorded in `supabase_migrations.schema_migrations`:

1. `20261017000100_assignment_aware_visit_billing`
2. `20261018000100_late_acceptance_card_window`
3. `20261018000200_matching_notice_freshness`
4. `20261018000300_blocked_extras_reconciliation`

These add assignment/pause checks to preparation, claiming, creation, confirmation, completion, retries and scheduler batches. In-flight captures are reconciled and refunded when their current state no longer permits payment. A paused series cannot start work. A delayed add-on with an existing paid balance is held for review rather than automatically charging that balance again.

## Remaining release gate

Resend's `opulencebliss.com` domain currently shows **Not Started**, with its Wix DNS verification incomplete. Real branded email delivery has not passed. Verify that sender domain, then configure a separate restricted staging key, approved sender and staging site URL in the **Supabase Edge Function secrets**. Vercel Preview variables are not automatically inherited by that scheduler. Do not mark queued messages as delivered.

Before any future Production merge, apply the matching migrations and install/verify the permanent Production scheduler first, configure its own approved email sender, and verify the LIVE webhook subscriptions (`payment_intent.succeeded`, `payment_intent.payment_failed`, `refund.updated`, `customer.updated`). Production remains untouched in this task. The legal patch remains held and the marketplace must stay off.

## Re-running

`scripts/test-staging-matching-billing.mjs --run-real-staging` uses only the ACL-restricted local staging credential file and refuses other database refs or Stripe accounts. It creates real sandbox charges/refunds and retains their audit records. Use `--case NAME` to run one case. The expired-window case additionally requires `--advance-owned-clock` and its generated, fixture-guarded SQL step; it never changes shared server time or existing customer records. It is intentionally excluded from normal unit tests.
