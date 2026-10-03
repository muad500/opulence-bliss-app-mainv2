# Handyman marketplace release gate

Keep `HANDYMAN_MARKETPLACE_ENABLED=false` in Production. Enable only on the isolated `codex/staging` Preview for testing. The existing `/services/handyman` quote page remains available. `/handyman` and its APIs return 404 while disabled; its navigation item is hidden.

Do not enable Production until the client and solicitor approve Terms naming the handyman as the service provider. This release does not amend or obtain acceptance of those Terms. Privacy, Review Policy, statutory cancellation and Partner Agreement wording remain on hold.

Apply migrations 20261003001700, 20261003001800 and 20261003001900 before deploying the account-export changes. Only server routes can access the private job tables and storage bucket. Each route checks authenticated job ownership and mutation origin.

Applicants choose supported unregulated tasks and their net hourly rates, areas and working hours. Adding the trade requires a fresh admin approval, current DBS and right-to-work checks, photo ID and verified public liability insurance. Trade certificates remain available in the existing verification flow; regulated work is excluded from this marketplace. Real checks must be made by the administrator, never inferred from a synthetic test fixture.

Booking reserves the chosen professional, time, rate, VAT and own Stripe payout account. The booking rate and payout destination cannot be changed later. Only appointments in the next six days, with two hours notice, are offered; overlaps, holidays, daily capacity, self-booking and expired documents block availability. Completed work counts recorded minutes against the daily limit.

Checkout uses a manual card authorisation without `transfer_data.destination`. Check-in starts the server clock; check-out records worked minutes and presents a bill. The minimum is one hour. Materials need private receipts and explicit customer approval; rejected receipts are not billed. Customer approval seals the final bill. A bill above the hold requires a fresh full authorisation before the previous hold is released. The bill is then captured once, and a separate Connect transfer pays the assigned professional. The platform share is 20% of net labour; labour VAT and approved materials pass through in full. Rates are displayed as excluding VAT, with VAT added only for declared VAT-registered professionals.

Stripe capture and transfer operations have stable idempotency keys. A payment claim has a two-minute lease. If a payment fails or an authorisation expires, the customer sees a retry/support state; do not manually replace the payout account or charge again without reconciliation. Unstarted cancellation releases its hold. Account erasure is blocked until jobs and holds are resolved, then private attachments are removed through the existing erasure queue while transaction ledgers remain.

Staging verification uses Stripe test keys and the separate `comwdjprdedmsnxtvuuk` database. Synthetic verification evidence is explicitly labelled and is not a real DBS, identity or government check. Test connected-account credits are not evidence of real bank payout delivery.
