# Automatic data retention

The owner-approved periods are implemented by migrations `20261026000100`,
`20261026000200`, `20261026000300` and `20261026000400`.
The migration creates the engine but performs no deletion and leaves it disabled.
Daily runs are visible at **Admin → More tools → Data retention**.

| Records                                                  | Expiry                                                                                                                             |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Emergency contact fields                                 | Six calendar months after the professional leaves                                                                                  |
| DBS outcome and review metadata                          | Six calendar months after account closure                                                                                          |
| DBS certificate uploads, including orphaned uploads      | Six calendar months from upload; verified copies still follow the existing immediate-deletion workflow                             |
| Check-ins, challenges and challenge events               | Two years from creation; unfinished jobs retained                                                                                  |
| Chat text and dependent delivery records                 | Two years from message creation; unfinished jobs retained                                                                          |
| Booking-chat and property-maintenance job photos         | Twelve months after job completion/cancellation                                                                                    |
| Unsuccessful application evidence                        | Six calendar months after rejection; an approved professional or shared customer account is never erased as a rejected application |
| Quote enquiries and their uploaded photos                | Twelve months after creation; accepted contracts are retained separately                                                           |
| Resolved safeguarding, incident and complaint records    | Six years after resolution                                                                                                         |
| Closed business aggregates and saved legal evidence      | Six years after the whole contract ends; all visits must be terminal; a related incident keeps its own longer period               |
| Structured access instructions and saved checkout copies | End of the whole series/contract; another active contract and newly edited saved addresses stay protected                          |

Open resolution cases, incident reports, property-maintenance disputes and manual
holds protect related people, jobs and series. Admin can add a manual hold for an
externally handled complaint or enquiry, then record its resolution. Unknown
expiry/closure dates retain records rather than guessing. Accepted classic quotes
start a business-contract timer when admin changes their status to Closed.
Historical closed quotes without a trustworthy end date stay retained for review.
Closed-account business evidence also expires once its six-year period and every
linked contract/case retention period have ended. Historical rejections
without a trustworthy timestamp start their six-month clock at migration time.

The site does not currently store a separate contact-message inbox: contact is by
email. This engine covers website/database enquiries, not the client's external
email inbox or Stripe's independent retention. No Stripe operations occur here.

## Files, retries and authorisation

Files are deleted through the Storage API, never by deleting Storage metadata
directly. A private leased queue rechecks the current record, expiry and holds
immediately before removal. Changed/replaced evidence invalidates the old task.
Failed removal retains metadata and is retried. A crash after physical removal
can resume without claiming an unsuccessful removal was completed. Completion
clears paths; operational logs contain counts and fixed errors, not document
contents, contact details, raw SQL errors or credentials.

Database mutation, physical file cleanup and hold changes share the same
transaction lock. The synchronous Storage API request runs inside the locked
cleanup function, followed by metadata completion. A pre-existing open hold
blocks deletion; a concurrent hold change waits for that transaction to finish.
Failed requests stay retryable. The existing service credential arrives through
PostgREST request headers, is forwarded only to this project�s fixed Storage
origin, and is never stored or returned. The cron worker has no separate,
unlocked file-deletion path. The http extension is configured during scheduler
installation, with a five-second request timeout.

The cron endpoint accepts only the existing Bearer cron credential: the isolated
WEB_PUSH_CRON_SECRET in Preview, and CRON_SECRET in Production. Neither
environment falls back to the other credential. No new credential is created. Admin pages
and hold changes require staff authenticator sign-in. Private helper functions
are not exposed to authenticated users or the service API. Immutable-history
deletion is allowed only inside the owner-executed retention transaction; normal
edit/delete restrictions remain unchanged. Business aggregates use their actual
foreign-key graph, with constraints and triggers enabled. A dependency that cannot
be safely removed rolls back that item and appears as a failure, never a false
success. No historical payment is captured, refunded, cancelled or transferred.

## Staging and release

1. Run isolated database tests and application tests, typecheck, lint and build.
2. Apply the exact migration on staging and verify its source in the ledger.
3. Deploy to `codex/staging`; install its daily schedule (`15 3 * * *`, UTC).
4. Verify a preview run and the admin log while deletion is disabled.
5. Review the counts and explicitly enable staging deletion; test file retries
   only using disposable staging fixtures. Never change real checks as fixtures.
6. Production remains unchanged until the owner grants a deployment slot and
   approves its release. Recheck the other bot and `main` immediately beforehand.

The first Production release is PREVIEW ONLY. Apply only the four retention
migrations, verify their exact ledger sources, and keep the deletion control
false. The Production scheduler installs inactive; after the web deployment,
enable automatic preview runs and verify HTTP 200 before restoring its daily
schedule. Its fixed URL includes `?dry=1` and its invocation function refuses
an enabled deletion control, so activating the schedule cannot activate deletion.
Show eligible and protected counts for all eleven categories, including zeroes.
Wait for a separate explicit approval before preparing real Production deletion.

The professional-operations migrations and pay tools remain on staging. This
retention release does not update the visit-payments worker or payment rules.

The held legal migration is unrelated and must not be included.
