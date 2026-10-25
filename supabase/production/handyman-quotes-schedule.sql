-- Production uiqcsihgqaktpjumyeap: install before the I2 code deployment.
-- Deliberately INACTIVE. The marketplace and its recovery route remain disabled.
-- Launch requires an explicit release, live-payment support and a matching
-- existing Vercel CRON_SECRET saved to Vault under the name below. This script
-- does not create, read out or change credentials and must not activate the job.
begin;

create or replace function public.invoke_production_handyman_quotes()
returns bigint
language plpgsql
security definer
set search_path = public, vault, net
as $function$
declare
  scheduler_secret text;
  request_id bigint;
begin
  select decrypted_secret into strict scheduler_secret
  from vault.decrypted_secrets
  where name = 'opulence_production_handyman_recovery_secret';

  if length(coalesce(scheduler_secret, '')) < 32 then
    raise exception 'Marketplace launch scheduler credential is missing';
  end if;

  select net.http_get(
    url := 'https://www.opulencebliss.com/api/cron/handyman-payments',
    headers := jsonb_build_object('Authorization', 'Bearer ' || scheduler_secret),
    timeout_milliseconds := 120000
  ) into request_id;
  return request_id;
end;
$function$;

revoke all on function public.invoke_production_handyman_quotes()
from public, anon, authenticated, service_role;

select cron.schedule(
  'opulence-production-handyman-quotes',
  '* * * * *',
  'select public.invoke_production_handyman_quotes();'
);
select cron.alter_job(jobid, active := false)
from cron.job where jobname = 'opulence-production-handyman-quotes';

commit;

select jobname, schedule, active,
  command = 'select public.invoke_production_handyman_quotes();' as command_matches
from cron.job where jobname = 'opulence-production-handyman-quotes';
