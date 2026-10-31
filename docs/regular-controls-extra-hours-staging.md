# Regular booking controls and approved extra hours: staging only

Based on 697c335. Production remains at d429777. This branch must not be merged wholesale into Production: its baseline includes staging-only history. A later release needs an explicit owner go and a clean cherry-pick.

## Behaviour

Customers can preview and confirm pause or end from a regular visit. Accepted or paid future visits cancel under their own agreed policy, with each refund and retained amount displayed first. Unassigned unpaid visits can remain paused. Work already started is unaffected. Ending is permanent; resuming never revives cancelled visits. Resume requires recovered money operations, restarts ranked offers for eligible remaining visits, and preserves approval, checks, areas, calendars, deadlines and notification preferences. Duplicate resumes do not rebroadcast.

An assigned approved cleaner can offer extra time in 30-minute steps. The customer must approve the displayed amount before any charge. The original gross booked hourly price and cleaner-pay snapshot are preserved. Whole-visit duration including add-ons cannot exceed eight hours. The shared calendar is reserved before payment. Failed payment restores the original duration and paid base visit. The existing recoverable payment engine handles retries and delayed results; no second Stripe engine is introduced. A captured result after closure enters refund review without adding hours or pay.

Own records are included in the account data export. Extra-hour rows use participant-only read access; customers and workers cannot directly edit prices.

## Database

Staging comwdjprdedmsnxtvuuk only. Apply 20261031000200 through 20261031000700 in order. The preparation script generates one guarded transaction, aborts on a ledger/source mismatch, and skips exact matches. All six are installed on staging with matching source MD5s. They are NOT installed on Production.

The later adapters preserve the F1 offer-freshness and notification-channel wrappers and restart exhausted matching waves on resume. Derived queues can be rebuilt; offer delivery history is retained.

No additional scheduler or billing-worker deployment is needed. The existing five-minute billing recovery and minute offer-wave schedulers are reused. Worker source remains 50076e5ffdb5fa90fa58360c9e3c99ddc1ee91bf909ef8ee2006eb4cb9526142.

## Validation

- Full npm tests (553), typecheck and production-mode staging-config build passed.
- Six API/control regression tests are included in npm test.
- Sixteen offline PostgreSQL checks cover ownership, immutable amounts, atomic pause, recovery, calendar clashes, eight-hour limit, original rate/discount behaviour, privacy, notification preferences and delayed captures.
- Real Stripe sandbox acct_1UKQ4A2NzINBHbzj: one extra hour charged 2299p once; total 6897p. Repeating the operation created no additional charge. Booked cleaner-pay calculation was 4500p; no Connect transfer was performed.
- Declined extra payment preserved the original 120-minute 4598p paid visit.
- An already-captured delayed result recovered the same PaymentIntent once with one database charge.
- Six unpaid unassigned regular visits paused, blocked charging, resumed and ended without payments. Ended series could not resume.
- Real hosted resume changed a declined visit to offered, renewed the deadline and started the first ranked wave immediately. Repeat resume retained the same run. A fictional out-of-area postcode prevented unrelated cleaner notifications.

All hosted tests used new explicitly fictional accounts and Stripe test credentials. Production financial operations, existing test accounts and existing professional checks were untouched.

Booking Credit remains stage 3. Cleaner Terms v1.0 remain awaited.
