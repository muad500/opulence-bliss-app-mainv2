-- Apply only after approval of Production preview counts and deletion.
-- This does not enable deletion itself. The approved activation transaction
-- installs this helper together with its guarded control change.
create or replace function public.invoke_production_data_retention()
returns bigint language plpgsql security definer
set search_path=public,vault,net as $fn$
declare
  secret text;
  deletion_enabled boolean;
begin
  select enabled into strict deletion_enabled
  from public.data_retention_control
  where id and storage_origin='https://uiqcsihgqaktpjumyeap.supabase.co';

  if exists(select 1 from vault.secrets
    where name='opulence_staging_web_push_cron') then
    raise exception 'Production project marker required';
  end if;

  select decrypted_secret into strict secret
  from vault.decrypted_secrets where name='opulence_cron_secret';
  if coalesce(secret,'')='' then
    raise exception 'Production cron credential unavailable';
  end if;

  return net.http_get(
    url:='https://www.opulencebliss.com/api/cron/data-retention'
      || case when deletion_enabled then '' else '?dry=1' end,
    headers:=jsonb_build_object('Authorization','Bearer '||secret),
    timeout_milliseconds:=55000
  );
end;
$fn$;
revoke all on function public.invoke_production_data_retention()
from public,anon,authenticated,service_role;
