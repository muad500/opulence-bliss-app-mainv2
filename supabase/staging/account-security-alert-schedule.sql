-- Apply ONLY to staging project comwdjprdedmsnxtvuuk, after the staging release.
-- Reuse the existing private staging cron/bypass secrets; do not expose them.
begin;
create or replace function public.invoke_staging_account_security_alerts()
returns bigint language plpgsql security definer set search_path=public,vault,net as $fn$
declare v_secret text; v_bypass text; v_id bigint;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name='opulence_staging_recovery_secret';
  select decrypted_secret into v_bypass from vault.decrypted_secrets where name='opulence_staging_vercel_bypass';
  if coalesce(v_secret,'')='' or coalesce(v_bypass,'')='' then raise exception 'Staging delivery credentials missing'; end if;
  select net.http_get(
    url:='https://opulence-bliss-app-mainv2-git-codex-staging-muad500s-projects.vercel.app/api/cron/account-security-alerts',
    headers:=jsonb_build_object('Authorization','Bearer '||v_secret,'x-vercel-protection-bypass',v_bypass),
    timeout_milliseconds:=55000
  ) into v_id;
  return v_id;
end $fn$;
revoke all on function public.invoke_staging_account_security_alerts() from public,anon,authenticated,service_role;
do $fn$
declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname='opulence-staging-account-security-alerts';
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule('opulence-staging-account-security-alerts','* * * * *','select public.invoke_staging_account_security_alerts();');
end $fn$;
commit;
