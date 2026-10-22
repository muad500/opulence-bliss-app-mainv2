-- Production operations only. Run after the web-push migrations and before
-- deploying the notification handlers. Uses the existing production cron secret.
begin;

do $$
begin
  if not exists (
    select 1
    from vault.decrypted_secrets
    where name = 'opulence_cron_secret'
      and length(btrim(decrypted_secret)) > 0
  ) then
    raise exception 'The existing production cron credential is required';
  end if;

  if to_regclass('public.web_push_subscriptions') is null then
    raise exception 'Apply the web-push migrations before installing the scheduler';
  end if;
end;
$$;

create or replace function public.invoke_production_web_push()
returns bigint
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  bearer text;
begin
  select decrypted_secret
  into strict bearer
  from vault.decrypted_secrets
  where name = 'opulence_cron_secret';

  if bearer is null or length(btrim(bearer)) = 0 then
    raise exception 'The production cron credential is unavailable';
  end if;

  return net.http_get(
    url := 'https://www.opulencebliss.com/api/cron/web-push',
    headers := jsonb_build_object('Authorization', 'Bearer ' || bearer),
    timeout_milliseconds := 60000
  );
end;
$$;

revoke all on function public.invoke_production_web_push()
  from public, anon, authenticated, service_role;

-- Reusing the name updates this job in place and leaves other schedules intact.
select cron.schedule(
  'opulence-production-web-push',
  '* * * * *',
  'select public.invoke_production_web_push();'
);

commit;

