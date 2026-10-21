# Web Push: staging handoff

Branch: `codex/push-and-store-assets`. PR target: `codex/staging` only.
Production is explicitly blocked by `webPushEnabled`, even if someone sets the
flag there. No Apple/iPhone push is implemented. Emails, SMS, billing and
existing notification producers are unchanged.

## Configuration (server environment only)

- `WEB_PUSH_ENABLED=true`
- `WEB_PUSH_VAPID_PUBLIC_KEY` (public subscription key; returned to the browser)
- `WEB_PUSH_VAPID_PRIVATE_KEY` (**secret**, never `NEXT_PUBLIC_*`)
- `WEB_PUSH_VAPID_SUBJECT=mailto:hello@opulencebliss.com`
- `WEB_PUSH_CRON_SECRET` (**secret**, independent of existing payment cron keys)

Generate one VAPID pair per environment using `web-push.generateVAPIDKeys()`.
Keep the pair stable: rotating it requires devices to subscribe again. Store
the private key in the hosting secret manager, never in source or app packages.
In this change, configuration is scoped to the new branch's Vercel **Preview**
environment, not Production and not other developers' previews.

Apply `20261021000100_web_push.sql` only to the isolated staging Supabase
project `comwdjprdedmsnxtvuuk`. The SQL fixture `supabase/tests/web_push.sql`
bootstraps an empty local/CI database: **never run that fixture on hosted data**.

Schedule an HTTPS GET to `/api/cron/web-push` every minute with
`Authorization: Bearer <WEB_PUSH_CRON_SECRET>`. On a protected Preview, also
pass the staging deployment-protection bypass as a request header. Keep both
in Vault/hosting secrets, not in the scheduler URL, logs or screenshots.
`supabase/staging/web_push_scheduler.sql` provides the guarded, named staging
job, using `opulence_staging_web_push_origin`, `opulence_staging_web_push_cron`
and `opulence_staging_vercel_bypass` from staging Vault. It is deliberately an
operations script, not a production migration.
The handoff report/PR records whether hosted configuration and scheduling
were completed. Move the Preview-specific configuration to `codex/staging`
only when this PR is approved and merged; do not activate a second concurrent
scheduler against the same outbox.

## Behaviour and privacy

The database queues push from the existing in-app notification stream. It
recognises cleaning offers/taken, booking received/confirmed (the latter is
the existing cleaner-assignment notice), arrival changes, 24h/90m reminders,
30m remaining, unread booking chat, still-finding notices and failed payments.
Unrelated/admin notifications are not sent. Old inbox entries are not replayed
when a device opts in. Subscriptions are per browser/device and tied to a live
Supabase auth session; sign-out revokes eligibility. A new login rebinds the
device only after authentication and eligibility checks.

Push is opt-in after a customer's first real booking or a professional's
approval. Permission is requested only by the Enable button, not on page load
or Android launch. The account/profile screen exposes the same control and a
global push opt-out. Existing booking/message/app-alert preferences are checked
both when queuing and immediately before delivery. Email/SMS consent is separate.
Existing access-control/DBS/service checks remain the authority for working.

Endpoints and encryption keys have RLS with no client table access. Only narrow
authenticated RPCs can enrol/disable; leased delivery RPCs require service role.
Only exact supported browser push-provider domains are accepted, not arbitrary
URLs. Messages contain generic copy and a relative account link, never a name,
address, message body, payment value or access credential. The service worker
checks the currently signed-in account again before display, validates click
targets and never caches private data. Notification tags collapse retries.

The outbox uses SKIP LOCKED leases, bounded retries, short expiry and 404/410
subscription cleanup. Web Push does not offer an exactly-once guarantee: a
worker crash after a provider accepts the message can cause a repeated send;
the stable notification tag/topic helps collapse it. Delivery does not mean
the user saw the notification.

## Android

Both Gradle audience variants share enabled delegation, `POST_NOTIFICATIONS`
and Android Browser Helper's permission-request activity. The permission flow
is delegated by the browser after the user requests it on the website.
Regeneration preserves notifications being enabled. Digital Asset Links, the
installed signing certificate, Chrome/browser support and origin verification
must all match for notifications to be presented as the installed app.
Two TWAs share the site's browser push origin: Android/Chrome controls which
installed app receives delegation. Verify this with **both apps installed**;
do not claim two independent native FCM channels or guaranteed dual delivery.

## Tests before approving

1. `npm test`, `npx tsc --noEmit`, website build and isolated SQL fixture.
2. Build/lint customer and worker Android debug variants (no release signing).
3. On an actual Android 13+ phone: install a staging-associated test wrapper;
   confirm the app origin/certificate is verified, book with a demo customer,
   enable notifications, background it and generate a test booking notification.
4. Repeat for an approved demo professional and each requested event category.
   Check the correct installed app label/icon with both apps installed.
5. Deny permission, opt out, turn off category preferences, read a chat before
   dispatch, sign out, switch accounts, accept an offered job, expire a browser
   subscription and rerun/retry the scheduler. No private or obsolete alerts
   should be displayed. Test websites in Chrome/Firefox separately.
6. No real customers, production keys, payments or production access are needed.

An automated build/transport test is not proof of OS-level notification delivery.
Keep the physical-device acceptance checks outstanding until actually observed.
