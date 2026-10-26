# Professional operations, staging release

Production stays held until a fresh deployment approval and coordination with
the other developer. This release does not change marketplace code, approval,
checks, published documents, payment collection, or existing settled payouts.

## Reliability

Accepted cleaning visits withdrawn by the professional count against two grace
cancellations per Europe/London calendar month. The third creates one admin
alert; later cancellations do not duplicate it. Customer cancellations,
automatic cancellations and declined offers do not count. Existing current-month
withdrawals seed the counter without retrospective notifications.

No-show reports are separate flags, never automatic findings or suspensions.
Only a report after the visit starts, with an assigned professional and no
arrival record, produces a flag. Review the associated Resolution desk case.

Admin: More tools → Professional operations. Professionals see their own count
and current rates under Earnings. No account or check has been changed.

## Experience pay

Only the £15 standard rate progresses: £15.25 from the start of month 6, then
£15.50 from month 13. Deep/end-of-tenancy stays £17.50. A non-£15 standard rate
set by admin is preserved. Calendar-month boundaries use London time.

The first completed cleaning visit starts a durable clock. A gap of at least
90 days resets it at the next completion; until then the base rate applies.
Older replayed completions never move it backwards. The rate at acceptance is
saved per booking and professional. Reaccepting the same job cannot change it.
Previously assigned jobs and existing payouts retain their agreed terms.

Allocation, cancellation compensation and settlement read the same saved rate.
Current published products/tips rules remain unchanged, including the separate
£4 cleaner products component introduced by the latest Production release.

## Complaints and breach log

Admin → More tools → Problems & incidents supports private complaints, breaches
and incidents, optional booking/professional links, review status and outcomes.
Creation and every review are audited. An open linked record protects that
professional's records from retention; resolved evidence retains its full six
years under the existing incident rules. No complaint is a public review.

## Tax export

Admin → Professional operations → Professional earnings export. Staff password
and authenticator sign-in is required. Each export is logged. CSV includes
professional ID, name, recorded private address/postcode, DOB, UTR, net paid
earnings, transfer count and missing-details flags. No VAT field is introduced.

The same page has an Earnings CSV access log: staff identity, database-recorded
request time, requested period and professional count, with older entries
available through pagination. Personal CSV contents are not copied into it.
Authorised requests are logged before generation. A count of -1 marks an
unfinished request; zero is a valid empty export. An insert failure or missing
completion audit prevents the file from being returned. Historical requests
remain visible. No extra migration is needed beyond the four listed below.

This is a cash-basis reconciliation file, not an HMRC submission. Date range
uses inclusive start/exclusive end in London time. Actual paid-event dates are
used, falling back to creation only for legacy payouts without a paid event.
Current recorded reversals of source transfers are deducted; export time
therefore matters. Tips recorded as payouts are included. Unpaid amounts are
excluded. Staff must check tax details and the relevant reporting rules before
filing. Private files must be handled securely. CSV formulas are neutralised.

## Migrations, in order

1. `20261026000500_cleaner_reliability_and_complaints.sql`
2. `20261026000600_standard_cleaner_experience_pay.sql`
3. `20261026000700_private_professional_earnings_export.sql`
4. `20261026000800_all_service_earnings_export.sql` adds recorded property
   maintenance transfers and reversals to the same report, without changing
   marketplace code or switching it on.

Requires the four retention migrations already on staging. No additional
scheduler is needed: counters, clocks and snapshots are transactional triggers.

Validation uses actual PostgreSQL in an isolated PGlite database, the existing
application tests, typecheck and a clean build. Staging integration fixtures
are synthetic, rolled back and never charge a card or send customer messages.
