-- Staging setup only: run on comwdjprdedmsnxtvuuk, never on Production.
begin;
create extension if not exists pg_net with schema extensions;
create or replace function public.configure_staging_handyman_recovery(p_cron text,p_bypass text)
returns bigint language plpgsql security definer set search_path=public,vault,cron as $fn$
declare v_id uuid; v_job bigint;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  if length(p_cron)<32 or length(p_bypass)<16 then raise exception 'Missing staging credentials'; end if;
  select id into v_id from vault.secrets where name='opulence_staging_recovery_secret';
  if v_id is null then perform vault.create_secret(p_cron,'opulence_staging_recovery_secret');
  else perform vault.update_secret(v_id,p_cron); end if;
  select id into v_id from vault.secrets where name='opulence_staging_vercel_bypass';
  if v_id is null then perform vault.create_secret(p_bypass,'opulence_staging_vercel_bypass');
  else perform vault.update_secret(v_id,p_bypass); end if;
  select jobid into v_job from cron.job where jobname='opulence-staging-handyman-recovery';
  if v_job is not null then perform cron.unschedule(v_job); end if;
  return cron.schedule('opulence-staging-handyman-recovery','*/2 * * * *',
    'select public.invoke_staging_handyman_recovery();');
end $fn$;
revoke all on function public.configure_staging_handyman_recovery(text,text) from public,anon,authenticated;
grant execute on function public.configure_staging_handyman_recovery(text,text) to service_role;

create or replace function public.invoke_staging_handyman_recovery()
returns bigint language plpgsql security definer set search_path=public,vault,net as $fn$
declare v_secret text; v_bypass text; v_id bigint;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name='opulence_staging_recovery_secret';
  select decrypted_secret into v_bypass from vault.decrypted_secrets where name='opulence_staging_vercel_bypass';
  if coalesce(v_secret,'')='' or coalesce(v_bypass,'')='' then raise exception 'Staging recovery credentials missing'; end if;
  select net.http_get(
    url:='https://opulence-bliss-app-mainv2-git-codex-staging-muad500s-projects.vercel.app/api/cron/handyman-payments',
    headers:=jsonb_build_object('Authorization','Bearer '||v_secret,'x-vercel-protection-bypass',v_bypass),
    timeout_milliseconds:=55000
  ) into v_id;
  return v_id;
end $fn$;
revoke all on function public.invoke_staging_handyman_recovery() from public,anon,authenticated,service_role;
commit;
