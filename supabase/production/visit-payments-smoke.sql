-- READ ONLY: no live checkout, capture, refund, transfer or test customer.
-- The release preparer expands this marker from the same seventeen sources as
-- 01-migrations.sql. Use the generated 03-database-smoke.sql after the release;
-- all seventeen rows must be recorded=true, source_matches=true, ledger_status=matched.
-- RELEASE_MIGRATION_LEDGER_CHECK

select public.per_visit_checkout_ready() as checkout_ready,
  last_scheduler_at, now() - last_scheduler_at as heartbeat_age
from public.visit_billing_runtime;

select jobname, schedule, active
from cron.job
where jobname = 'opulence-production-visit-payments';

-- Only metadata; never select response headers, Vault values, or request headers.
select status, return_message, start_time, end_time
from cron.job_run_details
where jobid in (
  select jobid from cron.job
  where jobname = 'opulence-production-visit-payments'
)
order by start_time desc limit 3;

select count(*) as invalid_unconfirmed_cleaner_payouts
from public.payouts p
join public.booking_visit_billing b on b.booking_id = p.booking_id
left join public.payments pay on pay.id = p.payment_id
where not b.rate_confirmed and coalesce(pay.kind, 'booking') <> 'tip' and p.amount > 0;
