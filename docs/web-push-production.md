# Web Push production release

PR #37's staging acceptance is recorded in `web-push-staging.md`. Production
activation intentionally changes its staging-only guards while preserving opt-in,
session, preference, service approval and private-subscription checks.

## Release configuration

- Production push is permitted only for the production Supabase project or its
  approved custom auth domain. Preview remains tied to its separate database.
- Production has a newly generated VAPID pair, distinct from staging. Both key
  variables are Sensitive in Vercel Production. Never rotate them casually:
  existing device subscriptions depend on the stable public key.
- The authenticated production outbox uses the existing `CRON_SECRET`, held by
  Supabase Vault as `opulence_cron_secret`. Preview keeps its separate credential.
- The staging-only recipient allowlist never limits legitimate production mail.
  Essential security, payment-problem and cancellation emails remain always on.
- SMS and the unrelated property maintenance marketplace remain off.

## Database and scheduler order

1. Compare the production ledger and apply only missing migrations, in order:
   `20261021000100_web_push`, then `20261022000100_notification_channels`.
2. Verify each ledger statement contains the complete, exact migration source.
3. Install `supabase/production/web_push_scheduler.sql`. Confirm the one named
   production job is active every minute before deploying the handlers.
4. Deploy the tested release, then confirm authenticated scheduler HTTP 200 and
   subsequent automatic runs. The old code has no handler before deployment.

Never execute the staging scheduler or isolated SQL fixtures on production.

## Android delivery acceptance

The signed production updates are customer 1.2.0 (version code 3) and Pro 1.1.0
(version code 2). Existing production signing and Digital Asset Links remain
unchanged. The staging debug association is still blocked in production.

On Android 13 or newer, install the appropriate production APK and sign in to
your own eligible account: a customer with a booking or an approved professional.
Open Profile, Notifications and choose Turn on, then allow the system permission.
Choose Send a test notification (limited to one per minute per device). Background
the app with Chrome running; verify delivery and that tapping opens your account.
Repeat for each installed app, denied permission, disabled categories and sign-out.

Physical Android delivery and app identity with both wrappers installed must be
observed on the phone. Signed builds and provider acceptance alone do not prove it.
