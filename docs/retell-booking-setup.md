# Opulence Bliss voice booking

The receptionist collects cleaning booking details, checks live prices and permitted London times, saves a private request and emails a review/payment link. The customer signs in with the verified email they gave the receptionist, reviews the prepared details and continues to the existing Stripe checkout. They do not refill the cleaning booking form. New customers must create/verify their account, then reopen the booking email. The existing payment policy and cleaner matching still apply. Handyman work remains a quote request handled by the team.

An emailed request is **awaiting payment**, not a confirmed booking. Confirmation requires the existing Stripe finalisation to persist every booking. One-off cards are authorised at checkout and charged after the visit; regular visits are paid upfront.

## Activate on a staging deployment first

1. Apply `supabase/migrations/20261008000200_retell_voice_booking_requests.sql` to the matching Supabase environment. This adds a private request table; it does not change existing booking tables or grant public access. Apply through your normal Supabase migration process or the SQL editor.
2. Configure these server environment variables in the matching Vercel deployment:
   - `RETELL_API_KEY`: the API key belonging to the Retell workspace containing the receptionist. Enter it privately in Vercel; never paste it into a prompt, knowledge base, repository or this chat.
   - `RETELL_BOOKING_AGENT_ID`: the receptionist's agent ID (the ID button in the agent editor).
   - `NEXT_PUBLIC_SITE_URL`: the **HTTPS origin of that deployment**, without a path. For production this is `https://opulence-bliss-app-mainv2.vercel.app` unless you use a configured custom domain. Do not send staging booking links to a production origin.
   - Existing Supabase public/service-role variables, Stripe secret key and `RESEND_API_KEY` must belong to that environment. Configure a verified `BOOKING_EMAIL_FROM` or `EMAIL_FROM` sender. The new flow reports email failure; it never silently claims delivery.
3. Deploy the branch. Retell needs a reachable API. For a protected Vercel preview, privately place an explicitly authorised automation-bypass secret in the `x-vercel-protection-bypass` header of each of the four Retell functions. This secret grants access to protected deployments in this Vercel project, so sharing it with Retell requires the owner's explicit approval. Keep it out of chat, prompts, knowledge bases and Git. Keep Vercel authentication enabled. The API still requires the Retell signature and matching agent. Do not point the agent at localhost.
4. Install the four Retell functions and **replace** the old questions-only prompt with `docs/retell-receptionist-prompt.txt`. The old prompt's instruction to send people to fill out the website conflicts with the booking flow.

## Install the Retell draft automatically

Run the script locally with the same three Retell/site variables in a private `.env.local` file. Keep all keys out of chat and Git. The script never prints credentials. It saves a private ignored `.retell-booking-backup.json` before changing the draft and preserves unrelated tools. It supports single-prompt Retell LLM agents, including the receptionist shown in the screenshots.

```powershell
# Preview names and destinations without contacting Retell:
node --env-file=.env.local scripts/configure-retell-booking.mjs

# Update the draft after the endpoint and database are deployed:
node --env-file=.env.local scripts/configure-retell-booking.mjs --apply
```

The script refuses to overwrite an existing rollback snapshot. Preserve that snapshot privately, then deliberately rename it if installing again. A Retell API key must be scoped to the intended workspace. If other agents share the same Retell LLM, the prompt/tool update affects that shared LLM too; give the receptionist its own LLM configuration before applying.

For an authorised protected-preview connection, the installer accepts `VERCEL_AUTOMATION_BYPASS_SECRET` from the private local environment and places it in the four function headers. Its dry run prints no header values. Never export a JSON tool configuration containing that secret into Git. Omit it when installing against the public production origin. A preview also needs its own working `RESEND_API_KEY`; a Production-only email variable is not inherited by Preview.

After a browser test call succeeds, publish the agent in Retell and ensure the number uses the intended published version. The script also supports `--apply --publish` for an explicitly chosen installation/publish run; do not publish before testing.

## Configure functions manually instead

`scripts/retell-booking-tools.mjs` contains all four schemas and descriptions. To export them without using any credentials:

```powershell
node --input-type=module -e "import {bookingTools} from './scripts/retell-booking-tools.mjs'; import {writeFileSync} from 'node:fs'; writeFileSync('retell-booking-tools.json', JSON.stringify(bookingTools('https://YOUR-DEPLOYED-ORIGIN'), null, 2));"
```

For each custom function, copy its `name`, `description` and `parameters` from the exported file. All four use **POST** to `/api/retell/booking`, timeout **30 seconds**, max retries **1**. The endpoint authenticates Retell's automatic `X-Retell-Signature` against the raw request body and verifies the configured agent.

| Setting | Value |
| --- | --- |
| Payload: args only | **OFF**: the endpoint needs Retell's `name`, `call`, `args` wrapper |
| Headers / query parameters | Retell signs automatically. For an authorised protected preview only, add the private `x-vercel-protection-bypass` header; no query parameters. |
| Talk while waiting / typing sound | OFF |
| Talk after action completed | ON |
| `create_voice_booking` response variables | `voice_booking_request_id` → `request_id` |

Replace the old GET-only `get_cleaning_services` function with the new signed POST function. Add `check_booking_options`, `create_voice_booking`, and `get_voice_booking_status`. Use the exact timestamps and service IDs returned by the API. Option results are limited to six times on the requested date and are **permitted times, not guaranteed worker availability**.

## Test before production

Use staging Stripe test mode and an email inbox you control. No real card data should be spoken to the agent. A UK contact number is required by the existing cleaning checkout even when you test the conversation from an Indian phone/browser.

1. Ask for a one-off cleaning booking; give an actual covered UK postcode. Confirm the service, date, duration, home details, full address, UK contact number and your email. Agree to the read-back and quoted total. The agent should save one request and say it awaits checkout.
2. Verify the email is received, sign in with that **same verified email**, and open the link. All booking details should be present; no repeated cleaning form is needed. Review the details and the service-start acknowledgement, then use a Stripe test payment method.
3. Verify the existing success page and account show the saved booking. Ask the agent to check status; it should say confirmed only after the booking is saved, and not promise a cleaner is already assigned.
4. Repeat the create request with the same confirmed details: it should reuse the same request and email delivery key. Reopening/retrying payment should reuse the same Stripe checkout session.
5. Try an uncovered postcode, malformed email, invalid duration, mismatched signed-in email and expired request. None should produce a confirmed booking. Test regular visits separately: the full 6–10-visit upfront total must be read back and all visits saved before status is confirmed.
6. Simulate email failure in staging. The agent must say the link could not be sent and offer a retry/support, never claim success.

Automated checks: `npm test`, `npx tsc --noEmit`, and ESLint on the changed files. They use local mocks and never send emails, charge cards, or create production bookings. They do not replace the staging call/payment test above.

## Operational notes

- Requests expire after 24 hours. Checkout rechecks prices, coverage, notice, scheduling, contact details, and account identity. If prices change, get a fresh confirmed quote instead of silently charging the new amount.
- Requests and email content are private. Row-level security denies direct anonymous/customer database access; the server checks email ownership. Request status is restricted to the same signed agent and call.
- Keep request records under the site's normal privacy/retention policy. Only service-role maintenance may purge stale requests; never expose the table as a public client query.
- If a caller changes an unpaid request, the agent creates a new confirmed request. They must use the latest email and not pay the earlier one. Already-paid changes/cancellations go through the existing account/support flow.
- Rollback: restore the old Retell prompt/tools from the private backup and stop calling the new endpoint. The database table can stay private; paid bookings remain governed by the existing checkout/finalisation.

Official references: [Retell custom functions and signature verification](https://docs.retellai.com/build/single-multi-prompt/custom-function), [Retell SDK](https://github.com/RetellAI/retell-typescript-sdk), [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests).
