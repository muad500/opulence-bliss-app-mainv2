-- READ ONLY: no live checkout, capture, refund, transfer or test customer.
select version, name,
  md5(replace(array_to_string(statements, E'\n'), E'\r\n', E'\n')) as source_md5
from supabase_migrations.schema_migrations
where version in (
  '20261014000100', '20261014000200', '20261014000300',
  '20261014000400', '20261014000500', '20261017000100',
  '20261018000100', '20261018000200', '20261018000300'
)
order by version;

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
