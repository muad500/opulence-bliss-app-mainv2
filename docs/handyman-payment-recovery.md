# Handyman payment recovery - items 105 to 109

## Scope and release status

This change is prepared on codex/handyman-payment-recovery. It must first be
migrated and tested on codex/staging, using its separate database and Stripe test
account. Do not merge into main or apply this migration on Production without
the user's confirmation. HANDYMAN_MARKETPLACE_ENABLED must stay false in
Production. The legal documents patch remains held.

The command/browser runners currently fail before starting with
helper_unknown_error: apply deny-read ACLs. The 111 existing tests, 13 new payment-recovery regressions, TypeScript, lint,
build and isolated PostgreSQL migration/RPC tests passed in GitHub Actions.
Vercel's preparation-branch Preview build also passed. These are not staging
Stripe integration tests; no staging payment test or migration is claimed here.

The access-check branch was created, empty commit cb2f9b8 was pushed, and the
branch was deleted after verifying its head and unchanged file tree. The one-time
cleanup workflow was removed afterward.

## Changes

- 105: Store immutable Checkout request parameters and per-attempt idempotency
  keys before Stripe creation. Reuse a recorded open session. Reconcile a lost
  create response by finding its attempt metadata before creating again.
- 106: If the approved handyman payment's hold has expired, return the job to
  awaiting_authorization without losing its approved bill. The customer uses
  Checkout to authorise that bill again. Handle expiry during capture by
  retrieving Stripe's actual outcome rather than blindly creating a payment.
- 107: The locked database finaliser commits either attachment or release work.
  Reservation rejection is different from an unknown database outcome. Rejected
  holds are recorded and safely released, with retryable recovery.
- 108: Replayed finalisation resumes previous-hold cleanup. An already-cancelled
  hold is a successful release. Failed database acknowledgement remains retryable.
- 109: Validate customer, session, intent and attempt history before acknowledging
  a known delayed event after capture or replacement. Unrecognised or mismatched
  events still fail validation.
- Transfers reconcile existing transfer-group history before creation. Payments
  always use the immutable assigned professional's account, never the fallback.

## Migration and scheduling

Migration: 20261003002000_handyman_payment_recovery.sql.

Keep the staging marketplace off while applying the migration and deploying the
matching code. Then restore only staging's existing enablement and test it.
No Production configuration change is part of this patch.

The authenticated GET /api/cron/handyman-payments endpoint retries recorded hold
releases and missed checkout finalisation. It never captures or transfers.
Connect it to the existing staging scheduler with its CRON_SECRET and Vercel
deployment-protection access. Verify an actual scheduled run before declaring
background recovery complete. Do not expose or print either credential.

Read-only preflight must establish the staging Supabase project and Stripe
account/mode, distinct from Production. Capture and transfer testing must reject
any live-mode key.

## Staging failure cases still required

1. Retry Checkout after one minute: same open session, no second hold. Also test
   a lost session-create/save response and an expired Checkout session.
2. Expired authorised hold: approved bill returns to awaiting_authorization;
   customer authorises it again; capture once and transfer once to their assigned
   professional. Test expiry between retrieval and capture. Distinguish actual
   expiry from a test cancellation used to simulate the cancelled status.
3. Reject finalisation after reservation expiry/unavailability: record the intent,
   release it, and recover a failed release. A lost successful RPC response must
   not release the attached intent.
4. Replace authorisation, fail old-hold release, retry. Also fail the database
   acknowledgement after Stripe cancellation and retry without cancelling the new
   payment.
5. Replay completed Checkout after capture, and an older event after replacement.
   Both return success without new captures/transfers. Wrong ownership/history
   must remain rejected.
6. Verify recovery scheduler, migration privileges and erasure guard. No changes
   to test-account records or anyone's verification checks.

## Shared proposal for cleaning item 104 and handyman item 106

Use one authorisation-attempt ledger and actual Stripe capture_before deadlines.
For visits beyond a safe hold window, save a payment method with consent through
Stripe and authorise nearer the visit. Before work starts, require a valid hold
covering the expected completion window. If authorisation fails or requires
authentication, request customer action and alert support/professional. Capture
after completion/approval and reconcile each assigned-professional transfer.

Question 23 must settle the authorisation timing, consent and failed-payment
rescheduling policy. The cleaning implementation, scheduled off-session
authorisation and any automatic rebooking/cancellation policy are not built by
this patch. The handyman fix is customer-driven recovery of an already approved
bill, which is explicitly authorised in this task.

References:
- https://docs.stripe.com/payments/place-a-hold-on-a-payment-method
- https://docs.stripe.com/api/idempotent_requests
- https://docs.stripe.com/webhooks
