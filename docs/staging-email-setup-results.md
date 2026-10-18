# Staging email setup — 19 October 2026

Resend's `opulencebliss` team has verified `opulencebliss.com`. The replacement
`Opulence Bliss Staging` API key has sending-only permission restricted to that
domain. Its value is not in this report, Git or shared artifacts. The first,
unused staging key was revoked with user approval before replacement; it was
never installed or used. The existing Production key was untouched.

## Configuration

- Vercel Preview: `EMAIL_FROM`, `BOOKING_EMAIL_FROM` and `ACCOUNT_EMAIL_FROM`
  are `Opulence Bliss Staging <staging@opulencebliss.com>`, with its own
  `RESEND_API_KEY`. Existing branch-specific settings outside `codex/staging`
  were not changed.
- Supabase staging worker: same booking sender, staging site URL, separate
  staging Resend key, and `STAGING_EMAIL_RECIPIENTS` set only to the mailbox
  approved by the user. Mode remains staging; SMS remains off.
- Production: sender strings are prepared as `Opulence Bliss
<hello@opulencebliss.com>` for the next approved deployment. No Production
  credential was read or reused; no Production redeploy, migration, scheduler,
  webhook, booking or payment operation was performed.

## Verification

- Account-mail transport: Resend ID `01a15087-5c15-7a64-8482-12b5c0d1dca1`,
  shown **Delivered** in the dashboard.
- Real queued customer matching warning: Resend ID
  `01a15087-dbbb-7ce8-adaf-73a44bf67326`, shown **Delivered**. Its outbox row
  records that provider ID and `sent` exactly once. Replay sent no duplicate.
- Both messages went only to the exact mailbox the user approved. No recipients
  were redirected and no email content was logged.
- Existing old QA notices for other recipients were blocked before contacting
  Resend. They retain their audit records and ordinary retry bookkeeping; their
  accounts, bookings, checks and payments were not edited.
- Unit cases cover a missing staging list failing closed, exact mailbox matching,
  excluding other recipients, and unchanged Production behavior.
- Automated tests, TypeScript and the optimized build passed using staging
  credentials. The initial build without the required local Supabase key failed;
  rerunning with the correct staging environment passed.

The production release still requires the user's explicit **merge**. The held
legal migration and marketplace switch remain unchanged.
