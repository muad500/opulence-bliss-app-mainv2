# Web Push: staging handoff

Branch: `codex/push-and-store-assets`. PR target: `codex/staging` only.
Production is explicitly blocked by `webPushEnabled`, even if someone sets the
flag there. No Apple/iPhone push is implemented. Billing is unchanged; existing
notification producers remain in place, with channel-preference checks added
to delivery and a supplementary email outbox for previously uncovered events.

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
per-device on/off control. A friendly card precedes the system prompt; only
"Turn on" asks for permission. "Not now" records a server-side 14-day snooze.
Blocked permission shows settings instructions, not another permission request.
Account profile settings contain the customer/professional type-by-channel matrix,
device list/removal and a rate-limited own-device test. Push choices are scoped to
this device; email and SMS choices are account-wide. Legacy opt-outs are preserved
until explicitly changed. **Updates always stay on**; the old suppressing trigger
is removed. Essential security, payment-problem, booking-change/cancellation and
verification-expiry emails bypass optional choices. Marketing stays separate,
off by default, with the existing consent audit. SMS remains off on staging.
All active email/SMS senders recheck preferences before sending; the new small
email outbox covers job-taken, checks, payout and payment notices not already
handled by the existing booking/matching/chat/direct mail producers. New staging
outbox emails are restricted to `STAGING_EMAIL_RECIPIENTS`.

Migration `20261022000100_notification_channels.sql` follows staging's newest
`20261021000300`. It is applied only on `comwdjprdedmsnxtvuuk`, with exact source
stored/checked in the migration ledger. It adds per-device preferences and retains
the existing auth-session, account, approval, offer freshness and delivery leases.
Insurance expiry notices extend the existing daily verification scheduler, without
changing insurance approval or job eligibility. Device removal is serialized with
enrolment; background refresh cannot silently restore a removed subscription.
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

## Web acceptance passed — ready for release-owner review

Current automated checks: **410 passing tests**, TypeScript, Next.js 16.4.2 build,
changed-file lint (no errors), isolated PostgreSQL 17 CI, and both Android debug
build/lint tasks. Hosted Preview checks pass for both synthetic accounts: type/
channel saves, 14-day snooze, device isolation/removal, refusal to silently enrol a
removed device, Updates retention, preference export and read-before-dispatch
suppression. Hosted SQL confirms optional emails off while security, cancellations
and payment-problem emails remain allowed. The deployed feature Preview outbox
also sent a clearly labelled essential cancellation-notice test while the
authorised recipient's optional booking/payment emails were off. Receipt was
verified in that user's Gmail inbox on 22 October 2026; original preferences were
restored. No booking, charge or cancellation was changed by that test. The
feature branch's Preview-only recipient allowlist contains only that authorised
test mailbox; Production configuration was not read or changed.

The only live deployment used is the feature branch **Preview**, not Production
and not a merge into `codex/staging`. PR #37 is ready for the other developer's
production-release review under the user's web-only acceptance plan; it remains
open and unmerged. Android runtime testing is explicitly deferred below.

For physical Android testing, build separate debug-only `.staging` apps with:

```
cd mobile/android
JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME="$ANDROID_SDK_ROOT" bash ./gradlew \
  :app:assembleCustomerDebug :app:assembleWorkerDebug \
  -PstagingHost=opulence-bliss-app-mainv2-git-codex-pu-969797-muad500s-projects.vercel.app
```

Packages: `com.opulencebliss.app.staging` and `com.opulencebliss.worker.staging`.
These do not replace Production apps. The matching public debug certificate is
served only on the guarded staging Preview; Production's association stays
unchanged. No release task/signing is allowed with `stagingHost`.

Real desktop Chrome confirms that the friendly customer card appears without a
native permission prompt. Clicking **Not now** removes it and saves a timestamp
14 days ahead in staging. Clicking **Turn on** in settings opens Chrome's native
**Show notifications** permission prompt. After permission was allowed, the UI
reported **Push is on**, the real browser subscription was saved, and the
**Send a test notification** action reached the push service: the staging outbox
records `sent` after one attempt. On 22 October 2026, the user confirmed that
the Chrome notification **"Notifications work on this device"** appeared. This
is user-confirmed visible delivery, not merely provider acceptance. The later
closed-tab test is documented below. No Android device was connected.

The desktop Chrome **Messages: push on this device** switch was tested through
the actual settings page. With it off, the new message's push delivery was
cancelled before external sending and the in-app update remained unread/available.
With it back on, the next message push was sent after one attempt. These checks
used only the existing synthetic test customer and its real Chrome subscription.

**Closed-tab delivery passed:** the initial failure was traced to Google Chrome
notifications being switched off in macOS. The background worker still recognised
the correct account and reached `showNotification` without logged errors. With
the user's explicit approval, Chrome's macOS notifications were enabled. The
worker debugger was closed, the registered staging worker was stopped, and the
diagnostic tab was closed; no staging site tab remained open and Chrome stayed
running. A fresh test reached the push service after one attempt. On 22 October
2026 the user confirmed that it arrived with the staging tabs closed ("yes arrived
all messages"). This is a user-confirmed cold-worker, closed-tab delivery pass,
not an inference from provider acceptance. Browser and OS notification permissions
must both be allowed. No website code or sign-in safeguards were bypassed to
obtain this result.

## Production handoff — actions for the release owner, not performed here

- Review the staging-only `webPushEnabled` guard in `lib/webPushPolicy.ts` and
  deliberately implement production activation. Merely setting the flag cannot
  enable Production in this branch. Keep the explicit opt-in, auth-session,
  approval, preference and sign-out safeguards.
- Adapt `lib/notificationExtraEmail.ts` so the staging recipient allowlist stays
  staging-only; do not copy the feature Preview's single test recipient into
  Production or silently cancel legitimate production email. Verify the real
  sender and essential-email delivery after activation.
- Check the production migration ledger before applying
  `20261021000100_web_push.sql` and
  `20261022000100_notification_channels.sql` in order. Compare already-applied
  sources instead of overwriting them. SQL fixtures are for isolated CI only.
- Configure separate, stable production VAPID keys and cron secret securely;
  never copy staging credentials or print private keys. Install and verify one
  authenticated production outbox scheduler; do not duplicate staging jobs or
  reuse a Preview deployment-protection bypass.
- Update from the current release branch, rerun tests/typecheck/build, deploy and
  run production web smoke checks. Confirm settings/card, push opt-out, essential
  email, scheduler health and existing payment/webhook readiness. Keep the
  unrelated handyman marketplace switched off.
- Android runtime acceptance remains **to do on production**, by the user on the
  live apps. The build and artwork checks are not Android delivery evidence.

No Production environment, key, database, scheduler or deployment was accessed
or changed by this task. No merge into `codex/staging` or `main` was performed.

**Android — to do on production:** on 22 October 2026 the user explicitly changed
the release plan to web-only staging acceptance, with physical Android testing
deferred to the live apps after the other developer's production release. This
deferral is not a claim that Android tests passed. Check Chrome Android and both
installed TWAs on an actual Android 13+ phone, including background delivery,
allow/deny, system settings and app identity with both apps installed. The staging
app association file returns **302 to Vercel sign-in without a bypass**, versus
200 with authorised automation. Android verification cannot send the private
bypass header. If staging Android tests are resumed, the owner must provide a
staging origin whose `/.well-known/assetlinks.json` is publicly accessible.
Do not embed a bypass credential in an APK or disable protection without approval.

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
