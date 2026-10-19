# Staging account security

Production is not part of this release. Target database: `comwdjprdedmsnxtvuuk`.

## Account-change alerts

Committed changes to name, phone, password, confirmed email, photo, saved
addresses, connected payout account and payout schedule queue private mail.
Email changes notify the current and old address separately. A pending email
confirmation, failed update, unchanged value or opening the Stripe portal does
not count as a change. Verified Stripe external-account/schedule events also
enqueue alerts; the staging Connect webhook must subscribe to these events.
Use `/api/stripe/connect-webhook` with its own
`STRIPE_CONNECT_WEBHOOK_SECRET` for `account.updated` and
`account.external_account.created`, `.updated`, `.deleted` on connected accounts.
Do not replace the existing payment webhook or its signing secret. Protected
staging also requires the existing private automation bypass on webhook delivery.

The message is always:

> Your Opulence Bliss account details were changed. If this wasn't you, contact hello@opulencebliss.com.

It contains no changed values. Marketing/contact opt-outs do not disable security
mail. The private outbox uses leases and stable email idempotency keys; delivery
failures retry and exhausted rows remain marked failed for operator review.
Staging sends only to exact addresses in `STAGING_EMAIL_RECIPIENTS`; all other
recipients are held, never rerouted to another person.

Apply `20261019000200_account_security_alerts.sql`, then
`20261019000300_require_staff_totp.sql` and
`20261019000400_account_security_phone_and_first_address.sql` on staging only. Deploy the staging branch,
then install `supabase/staging/account-security-alert-schedule.sql`. It reuses
existing private cron credentials and deployment protection remains enabled.
`/api/cron/account-security-alerts` requires the cron bearer credential.
The transport audit confirmed that Supabase's `net` schema is not exposed through
the browser database API (`PGRST106`), and browser roles cannot read Vault secrets
or the account-security outbox. The pg_net tables are provider-owned; no provider
permissions or existing transport credentials were changed.

## Mandatory staff authenticator

All current staff have the `admin` role. Password sign-in sends them to
`/staff/mfa`. First-time users scan the private QR code, then confirm a six-digit
code. Returning staff enter their current authenticator code. Pages, APIs,
server actions, RLS policies and older privileged RPCs require signed AAL2 + TOTP
and a currently verified factor. Email/SMS MFA or a removed factor do not qualify.
Customer/professional sign-in is unchanged.

No recovery bypass exists in the website. If an authenticator is lost, the
Supabase project owner must independently verify the staff member's identity,
remove only that user's lost factor in Auth, revoke their existing sessions and
have them sign in and enroll again. Never send QR seeds or recovery credentials
by email, chat or logs. Do not temporarily weaken `is_admin()` for recovery.

## Verification

`npm test`, TypeScript and the build check run offline without credentials.
`scripts/test-staging-account-security.mjs --run-real-staging` explicitly targets
staging, creates its own disposable accounts and tests actual TOTP and alert
triggers. It requires staging-only Supabase URL/anon/service credentials in memory;
an existing `STAGING_VERCEL_BYPASS` enables deployed page/API checks without making
the deployment public. Never point this test at Production.

Inspect private outbox counts/statuses rather than logging recipients or message
contents. A `sent` record confirms email-provider acceptance, not inbox delivery.
Before any future Production rollout, separately approve migrations, install a
Production scheduler, verify the email sender and confirm Connect subscriptions.

## Staging release results — 19 October 2026

- PR #33 merged into `codex/staging` only; deployed commit
  `c1db49899ac220e7839fcf829dc959fe800e8555` is Ready.
- Automated security tests, full application tests, TypeScript, changed-file lint
  and the build passed. The initial placeholder-host build failed because the
  app deliberately rejects unrecognised auth hosts; the staging-host build passed.
- Real isolated-staging tests passed for saved-change alerts, address changes,
  password changes, private outbox permissions, incorrect/valid TOTP, required
  enrollment, password-only page/API denial, verified page/API access and factor
  removal invalidating stale AAL2 privileges. Test-owned users were removed.
- A pending email-change request queued no false alert. A confirmed change queued
  separate alerts for the old/new Gmail test aliases; the email provider accepted
  both, and a worker retry did not resend them. One initial invocation timed out;
  the repeated end-to-end delivery check passed. Inbox arrival was not asserted.
- The private background delivery schedule is enabled on staging. Other staging
  recipients are held unless explicitly allowlisted; no customer mail test ran.
- Still required: the Stripe owner must activate the staging Connect event
  subscription and store its separate signing secret. Signed-event tests pass,
  but live sandbox webhook delivery cannot be claimed until that setup is done.
- Production branch and deployed application were not changed by this release.
