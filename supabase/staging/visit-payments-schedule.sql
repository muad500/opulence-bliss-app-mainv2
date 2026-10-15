-- STAGING ONLY: comwdjprdedmsnxtvuuk. Apply separately from schema migrations.
-- Deploy the matching visit-payments Edge Function and its secrets first.
begin;

create or replace function public.invoke_staging_visit_payments()
returns bigint
language plpgsql
security definer
set search_path = public, vault, net
as $function$
declare
  scheduler_secret text;
  gateway_key text;
  request_id bigint;
begin
  select decrypted_secret into strict scheduler_secret
  from vault.decrypted_secrets
  where name = 'opulence_staging_recovery_secret';
  select decrypted_secret into strict gateway_key
  from vault.decrypted_secrets
  where name = 'opulence_staging_function_anon';

  if length(coalesce(scheduler_secret, '')) < 32 then
    raise exception 'Staging scheduler credential is missing';
  end if;
  if to_regprocedure('public.finish_visit_money_operation(uuid,text,jsonb,text)') is null then
    raise exception 'Apply the visit billing schema before enabling its scheduler';
  end if;

  select net.http_post(
    url := 'https://comwdjprdedmsnxtvuuk.supabase.co/functions/v1/visit-payments',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || gateway_key,
      'apikey', gateway_key,
      'x-visit-payments-secret', scheduler_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) into request_id;
  return request_id;
end;
$function$;

revoke all on function public.invoke_staging_visit_payments()
from public, anon, authenticated, service_role;

select cron.schedule(
  'opulence-staging-visit-payments',
  '*/5 * * * *',
  'select public.invoke_staging_visit_payments();'
);
select cron.alter_job(jobid, active := true)
from cron.job where jobname = 'opulence-staging-visit-payments';

commit;
