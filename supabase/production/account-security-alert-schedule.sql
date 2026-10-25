-- Production uiqcsihgqaktpjumyeap only. Install after migrations, enable after deploy.
-- Reuses the existing private cron credential; never displays or copies its value.
begin;
create or replace function public.invoke_production_account_security_alerts()
returns bigint
language plpgsql
security definer
set search_path = public, vault, net
as $function$
declare
  cron_secret text;
  request_id bigint;
begin
  select decrypted_secret into strict cron_secret
  from vault.decrypted_secrets where name = 'opulence_cron_secret';
  if coalesce(cron_secret, '') = '' then
    raise exception 'Production security mail cron credential is missing';
  end if;
  select net.http_get(
    url := 'https://www.opulencebliss.com/api/cron/account-security-alerts',
    headers := jsonb_build_object('Authorization', 'Bearer ' || cron_secret),
    timeout_milliseconds := 55000
  ) into request_id;
  return request_id;
end;
$function$;
revoke all on function public.invoke_production_account_security_alerts()
from public, anon, authenticated, service_role;

select cron.schedule(
  'opulence-production-account-security-alerts',
  '* * * * *',
  'select public.invoke_production_account_security_alerts();'
);
select cron.alter_job(jobid, active := false)
from cron.job where jobname = 'opulence-production-account-security-alerts';

-- The minute timer is the fallback; committed account changes also wake delivery.
create or replace function public.wake_account_security_delivery()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  perform public.invoke_production_account_security_alerts();
  return null;
end;
$function$;
revoke all on function public.wake_account_security_delivery()
from public, anon, authenticated;
commit;
