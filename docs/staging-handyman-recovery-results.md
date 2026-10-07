# Staging payment recovery results — 4 October 2026

PR #23's payment recovery code was exercised on `codex/staging`, using Supabase `comwdjprdedmsnxtvuuk` and Stripe sandbox `acct_1UKQ4A2NzINBHbzj`. Production remains on `1a5b908dc8002736054c87600e7eabeca4ccc77b`, with the marketplace disabled. PR #23 remains draft, open and unmerged.

## Results

| Case | Result | Actual evidence |
| --- | --- | --- |
| Checkout retry | Passed | A second deployed checkout request after 144 seconds reused the same open Stripe session and one payment attempt. Job `1759fda5-2857-461e-8435-986389eebe46`. |
| Expired-hold replacement | Passed with controlled expiry simulation | Initial intent `pi_3UMbnf2NzINBHbzj0ciP4IWx` held £42 without capture. It was deliberately cancelled in Stripe test mode; the approved bill was preserved and the job requested authorisation. Replacement intent `pi_3UMc6h2NzINBHbzj0cvlAaCf` was authorised through real customer-submitted Checkout, captured once for £42, and transferred £35 to the assigned professional. |
| Rejected booking releases its hold | Passed | Job `1c0e612d-4b33-405a-aabc-43dceae3ad24` was cancelled. Intent `pi_3UMc832NzINBHbzj1LelN2CA` is cancelled with £0 capturable and £0 captured. |
| Failed old-hold cleanup | Passed | For job `eb73d94c-1882-4817-a033-c93ab1df3efa`, injected Stripe cancellation and database acknowledgement failures remained retryable. Old intent `pi_3UMcDD2NzINBHbzj1yq3BwTZ` was eventually cancelled; current intent `pi_3UMc8l2NzINBHbzj0ZABhmcM` stayed authorised during cleanup and subsequently settled once. |
| Delayed checkout event | Passed | Actual event `evt_1UMc6i2NzINBHbzjPYZqINmK` was replayed through the authenticated staging Stripe webhook after capture and transfer. HTTP 200. A subsequent read-only inspection confirmed £42 captured, the job completed and exactly one £35 transfer, unchanged by the event. |

The expiry case uses deliberate cancellation of a real Stripe test authorisation. It does **not** establish that a card authorisation naturally expired after seven days. Work timestamps and bill approval were simulated through the existing staging job RPCs. Cancellation and acknowledgement failures were deliberately injected; their recovery used real Stripe test API calls and the staging database.

## Payout evidence

The professional's own Stripe test account is `acct_1UMAl3RuvVT7baK3`; the fallback is `acct_1UKhHpRyEMgrxRKy`.

- Replacement booking: `tr_3UMc6h2NzINBHbzj0Dnl34vY`, £35, destination `acct_1UMAl3RuvVT7baK3`; one transfer.
- Cleanup booking: `tr_3UMc8l2NzINBHbzj0NRJi6Wo`, £35, same assigned destination; one transfer.

Each approved bill was £35 labour plus £7 VAT, £42 gross, £35 professional share and £7 platform share. Payments had no `transfer_data.destination`. These are sandbox transactions, not live money.

## Database and recovery schedule

Migration `20261003002000_handyman_payment_recovery.sql` was applied only to staging and verified in its migration ledger. Staging's recovery job is `opulence-staging-handyman-recovery` (job 3), every two minutes. Its last recorded schedule verification returned HTTP 200 with no failures; credentials are held in staging Supabase Vault. The endpoint recovers recorded checkout/release decisions and does not capture or transfer funds.

Staging's deployed server and public keys were confirmed to be test keys. The webhook is test mode, points to the staging host, and has a signing secret configured. No keys, signing secrets or deployment bypass tokens are included here.

## Code and account safeguards

- Recovery source: `f8cd557be7fb216eb32e557a1747c53a7d3f5c37`.
- Initial authenticated staging audit runner: `b6fa7ea2663b3a41c8a322664efee4306367ac03`.
- Fresh synthetic test run support: `8f04b4ef413f2815589405a6e05a4fadf92904c5`.
- Read-only post-event payment inspection: `adc6a1a00a8fd3031a70bd0bb706bf4531b5ab6b`.
- The temporary audit endpoint is removed after these tests. Its helper commits must not be released to Production.
- All 124 automated recovery/regression checks passed before the integration run; type checking, relevant lint and staging builds passed. Real Stripe outcomes are listed separately above.
- Existing accounts and professional verification records were not modified. The tested fixture's profile and verification fingerprint stayed identical before and after testing.
- No Production migrations, settings, payments or deployment were changed. Do not merge PR #23 to main until the user confirms.
- The replacement legal patch, migration `20261003002100`, remains held for client wording approval. The older legal patch is superseded and must not be applied.
