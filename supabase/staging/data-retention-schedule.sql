-- STAGING ONLY. Install after the web route is deployed. Deletion remains
-- disabled until data_retention_control is explicitly enabled after preview.
begin;
create extension if not exists http with schema extensions;
update public.data_retention_control
  set storage_origin='https://comwdjprdedmsnxtvuuk.supabase.co' where id;
do $guard$
begin
  if not exists(select 1 from vault.secrets where name='opulence_staging_web_push_cron')
    or not exists(select 1 from vault.secrets where name='opulence_staging_vercel_bypass') then
    raise exception 'Staging credentials are not configured';
  end if;
end;
$guard$;

create or replace function public.invoke_staging_data_retention()
returns bigint language plpgsql security definer
set search_path=public,vault,net as $fn$
declare secret text; bypass text;
begin
  select decrypted_secret into secret from vault.decrypted_secrets
    where name='opulence_staging_web_push_cron';
  select decrypted_secret into bypass from vault.decrypted_secrets
    where name='opulence_staging_vercel_bypass';
  if coalesce(secret,'')='' or coalesce(bypass,'')='' then
    raise exception 'Staging retention credentials unavailable';
  end if;
  return net.http_get(
    url:='https://opulence-bliss-app-mainv2-git-codex-staging-muad500s-projects.vercel.app/api/cron/data-retention',
    headers:=jsonb_build_object('Authorization','Bearer '||secret,'x-vercel-protection-bypass',bypass),
    timeout_milliseconds:=55000
  );
end;
$fn$;
revoke all on function public.invoke_staging_data_retention() from public,anon,authenticated,service_role;
do $schedule$
declare existing bigint;
begin
  select jobid into existing from cron.job where jobname='opulence-staging-data-retention';
  if existing is not null then perform cron.unschedule(existing); end if;
  perform cron.schedule('opulence-staging-data-retention','15 3 * * *',
    'select public.invoke_staging_data_retention();');
end;
$schedule$;
commit;
