# Permanent visit payment scheduler

The scheduler runs in Supabase independently of a laptop, Vercel Preview
protection and web deployments. Postgres cron invokes the authenticated
`visit-payments` Edge Function every five minutes. It uses the shared
`lib/visitBillingServer.ts` engine, including its durable claims and recovery.
It updates `visit_billing_runtime.last_scheduler_at` only after a successful
tick. Checkout continues to require a heartbeat from the last 20 minutes.

## Source and deployment

Run `npm run build:visit-worker` after changing the engine or handler. Commit
the generated `supabase/functions/visit-payments/index.ts` and source manifest
together with their source. `npm run check:visit-worker` rejects a stale bundle.
The function response reports the manifest's source hash so a deployed function
can be matched to Git. SDK versions are pinned in the generated imports.

The machine endpoint requires `x-visit-payments-secret`, at least 32 bytes,
checked with constant-time comparison. Gateway JWT verification stays enabled;
the cron also sends the project's existing legacy anonymous JWT from Vault.
Public/anonymous JWTs alone do not authorise billing. No browser can obtain the
cron credential. Neither credentials nor provider error details are logged.

Configure these secrets in the target Supabase project only:

- `VISIT_PAYMENTS_CRON_SECRET`: the same private value held in that project's Vault.
- `VISIT_PAYMENTS_STRIPE_SECRET_KEY`: the target account's server-side Stripe key.
- `VISIT_PAYMENTS_MODE`: `staging` or `production`.
- `VISIT_PAYMENTS_ENABLED`: `true` after configuration is complete.

The worker checks the exact database project, Stripe key mode and account ID
before running. Supabase supplies its own service-role key to the function.
Staging is `comwdjprdedmsnxtvuuk` / `acct_1UKQ4A2NzINBHbzj` / test mode.
Production is `uiqcsihgqaktpjumyeap` / `acct_1UL6n3ILnegr7Mwu` / live mode;
re-verify that production account before configuring it.

Deploy only this function with the dashboard's editor or:

```sh
supabase functions deploy visit-payments --project-ref PROJECT_REF --use-api
```

The dashboard's deployment must keep gateway JWT verification and the private
header guard enabled. Secrets are configured separately
and must never be committed, pasted into SQL history, or included in shared logs.

## Staging

Apply `supabase/staging/visit-payments-schedule.sql` only to staging. It replaces
the old Vercel-targeting invoker, reuses the existing Vault cron credential, and
updates/reactivates the existing named job at `*/5 * * * *`.

Stop using the old local temporary worker. It is not a permanent scheduler and
its shutdown clears the heartbeat. Do not run it after installing this schedule.

Observe at least two ordinary scheduled HTTP 200 responses, each with the
expected source hash, and two advancing heartbeat timestamps. Confirm
`per_visit_checkout_ready()` is true with no local worker running. Cron SQL
success alone only means its asynchronous HTTP request was queued.

## Production release gate — BEFORE any merge

Production stays unchanged until a separately authorised release. Before merging
the per-visit application into `main`:

1. Apply the nine exact-source migrations in `docs/production-visit-release.md`
   (20261014000100–20261014000500, 20261017000100, and
   20261018000100–20261018000300) and verify the ledger. The additional scope-notes
   migration must not be omitted from the release manifest. An already-applied
   exact ledger entry is skipped. Keep legal migration 20261003002100 held.
2. Deploy this exact generated worker to Production from the reviewed feature
   source; configure its own live account and private cron credential.
3. Store the credential in Production Vault as
   `opulence_production_visit_payments_secret`, and its existing legacy anonymous
   JWT as `opulence_production_function_anon`. Apply
   `supabase/production/visit-payments-schedule.sql` to Production only.
4. Verify two real five-minute scheduled runs, advancing Production heartbeat,
   matching source hash and `per_visit_checkout_ready()=true`. Do not charge a
   live card as a deployment health check.
5. Before merging, verify the LIVE Stripe webhook for the verified Production
   account subscribes to `payment_intent.succeeded`,
   `payment_intent.payment_failed`, `refund.updated` and `customer.updated`,
   in addition to its existing checkout/subscription events. Record the live
   endpoint ID, live mode and enabled event names without exposing its signing
   secret or any automation-access token. Verify Stripe can reach the endpoint;
   an outstanding or failed delivery blocks the release. Test-mode subscriptions
   do not satisfy this gate. Make live configuration changes only as part of the
   separately authorised Production release; do not charge a live card as a
   webhook health check.
6. Only then merge and deploy the per-visit web application. Keep the handyman
   marketplace off and preserve the cleaner pay-rate hold.

Do not include staging audit helpers, staged test records, or the old handyman
recovery schedule in the Production change. Record the scheduler verification
alongside the approved release. A stale heartbeat blocks the merge.
