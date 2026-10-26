-- PREPARED ONLY. Production requires an approved deployment slot.
-- Install disabled; verify a dry run after deploy before enabling deletion.
begin;
do $guard$
begin
  if not exists(select 1 from vault.secrets where name='opulence_cron_secret')
    or exists(select 1 from vault.secrets where name='opulence_staging_web_push_cron') then
    raise exception 'Production project marker required';
  end if;
  if (select count(*) from supabase_migrations.schema_migrations
    where version in('20261026000100','20261026000200','20261026000300','20261026000400'))<>4 then
    raise exception 'Apply and verify all retention migrations first';
  end if;
end;
$guard$;
create extension if not exists http with schema extensions;
update public.data_retention_control
  set storage_origin='https://uiqcsihgqaktpjumyeap.supabase.co' where id;

create or replace function public.invoke_production_data_retention()
returns bigint language plpgsql security definer
set search_path=public,vault,net as $fn$
declare secret text;
begin
  select decrypted_secret into strict secret from vault.decrypted_secrets
    where name='opulence_cron_secret';
  if coalesce(secret,'')='' then raise exception 'Production cron credential unavailable'; end if;
  return net.http_get(
    url:='https://www.opulencebliss.com/api/cron/data-retention',
    headers:=jsonb_build_object('Authorization','Bearer '||secret),
    timeout_milliseconds:=55000
  );
end;
$fn$;
revoke all on function public.invoke_production_data_retention() from public,anon,authenticated,service_role;
do $schedule$
declare existing bigint;
begin
  select jobid into existing from cron.job where jobname='opulence-production-data-retention';
  if existing is not null then perform cron.unschedule(existing); end if;
  perform cron.schedule('opulence-production-data-retention','15 3 * * *',
    'select public.invoke_production_data_retention();');
  perform cron.alter_job(jobid,active:=false) from cron.job
    where jobname='opulence-production-data-retention';
end;
$schedule$;
commit;
