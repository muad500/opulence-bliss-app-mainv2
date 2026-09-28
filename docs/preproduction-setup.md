# Production and pre-production setup

## Release flow

- `main` is the production branch.
- `codex/staging` is the persistent pre-production branch and receives a Vercel Preview URL.
- Test changes on `codex/staging`, then merge the approved commit into `main`.
- Preview pages display a testing banner and tell search engines not to index them.

## Environment isolation

Vercel Preview and Production must use separate service credentials before testers create bookings, payments or accounts:

- Preview: a staging Supabase project, Stripe test keys and staging webhook.
- Production: the production Supabase project and the intended production Stripe mode.
- Use separate cron secrets and email sender settings where possible.

Do not run destructive test resets against Preview while it shares the Production Supabase project.

### Isolation gate for the mainv2 rollout

The Supabase organization already has two distinct projects:

- Production: `uiqcsihgqaktpjumyeap`
- Staging: `comwdjprdedmsnxtvuuk`

The Vercel owner must first confirm the deployment belongs to `pyonpyonn/opulence-bliss-app-mainv2`; the Vercel session available on this computer shows an older `opulence-bliss-app` project instead. Scope the `codex/staging` Preview deployment to the staging project. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (and `NEXT_PUBLIC_SUPABASE_ANON_KEY` if used), and `SUPABASE_SERVICE_ROLE_KEY` from the **staging** project for Preview only. Set `STRIPE_SECRET_KEY` (`sk_test_`), `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (`pk_test_`), `STRIPE_WEBHOOK_SECRET` for a staging-only webhook, and a test connected account for `PROVIDER_TEST_ACCOUNT` for Preview only. Keep Production values scoped to Production. Set the staging site URL and cron secret separately too. Redeploy Preview after changing `NEXT_PUBLIC_` values; they are baked into the client build. Never put service-role or Stripe secret keys into `NEXT_PUBLIC_` variables.

Before testing, compare only the project references and key **modes**, not secret values. Preview must resolve to `comwdjprdedmsnxtvuuk` and test-mode Stripe; Production must resolve to `uiqcsihgqaktpjumyeap` and the *intended* Stripe mode. The account owner should check the Production `STRIPE_SECRET_KEY` in Vercel's protected settings against the intended Stripe account and report only the account ID and whether it is test or live. Do not paste the credential into chat or logs. The observed Production checkout generated a `cs_test_` session; treat Production payment mode as unresolved until the owner verifies it. Do not switch to live mode as part of staging setup.

The staging database migration list was last observed at `20260926000500`. Apply and verify the later migrations on **staging only**, in order, before exercising checkout and reviews. Do not copy production customer or payment data into staging; create synthetic test accounts and bookings.

Test matrix, all with Stripe test credentials and an isolated staging database:

1. New one-off booking: Checkout authorises the card with manual capture and no transfer at checkout.
2. Cleaner completion: capture succeeds once; one transfer reaches the assigned test connected account; payout is recorded as paid.
3. Automatic completion: same capture and transfer result.
4. Cleaner without a connected account: payout is held for admin, never sent to a fallback account.
5. Cancellation in each policy window: release, partial capture, or refund matches the policy and ledger; no unintended transfer.
6. Repeated completion and admin retry: no second capture or transfer.
7. Synthetic old destination-charge PaymentIntent: worker checkout, automatic completion, admin retry, and cancellation capture all stop **before** Stripe capture, open a blocking admin review case, and do not pay the old destination.
8. Tip and prepaid regular booking: destination and idempotent payouts still work.

Record the booking ID, PaymentIntent ID, capture status, transfer ID or held reason, and review-case ID for each test. Review those results with the owner, then obtain explicit deployment approval. Do not merge or deploy the payout branch to Production before this gate passes.

## Google customer authentication

1. Create separate Google OAuth clients for staging and production.
2. Enable Google under Supabase Authentication → Sign In / Providers.
3. In Google, use the Supabase Auth callback URL shown by the Google provider setup.
4. In Supabase URL Configuration, keep the exact production callback and add:
   - `http://localhost:3000/**`
   - `https://*-muad500s-projects.vercel.app/**`
5. Test a new Google customer, an existing Google customer, and rejection of a professional account on the customer login.

## Release checks

- Customer email and Google sign-in.
- Cleaning booking, reschedule and cancellation.
- Handyman quote requires a signed-in customer.
- Cleaner offer acceptance, OTP check-in, checkout and review.
- Stripe test payment, cancellation adjustment, payout and invoice.
- Admin bookings, quotes, customers, cleaners, FAQs and reports.
