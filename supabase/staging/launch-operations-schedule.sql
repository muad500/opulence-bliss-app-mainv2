-- STAGING ONLY. Never project this file/function/job into Production.
-- Install BEFORE Preview deployment; activate only after its route is Ready.
begin;
do $guard$ begin
  if not exists(select 1 from vault.secrets where name='opulence_staging_recovery_secret')
    or not exists(select 1 from vault.secrets where name='opulence_staging_vercel_bypass') then
    raise exception 'Staging Vault markers missing; stop'; end if;
end; $guard$;
create table if not exists public.staging_launch_operations_runs(
  request_id bigint primary key, requested_at timestamptz not null default now()
);
alter table public.staging_launch_operations_runs enable row level security;
revoke all on public.staging_launch_operations_runs from public,anon,authenticated,service_role;
create or replace function public.invoke_staging_launch_operations()
returns bigint language plpgsql security definer set search_path=public,vault,net as $fn$
declare origin text; bearer text; bypass text; request bigint;
begin
  select decrypted_secret into origin from vault.decrypted_secrets where name='opulence_staging_launch_operations_origin';
  select decrypted_secret into bearer from vault.decrypted_secrets where name='opulence_staging_recovery_secret';
  select decrypted_secret into bypass from vault.decrypted_secrets where name='opulence_staging_vercel_bypass';
  if origin is null or origin !~ '^https://opulence-bliss-app-mainv2-[a-z0-9-]+-muad500s-projects[.]vercel[.]app$'
    or bearer is null or bypass is null then return null; end if;
  request:=net.http_get(url:=origin||'/api/cron/launch-operations',headers:=jsonb_build_object(
    'Authorization','Bearer '||bearer,'x-vercel-protection-bypass',bypass),timeout_milliseconds:=55000);
  insert into public.staging_launch_operations_runs(request_id) values(request);
  delete from public.staging_launch_operations_runs where requested_at<now()-interval '7 days';
  return request;
end;
$fn$;
revoke all on function public.invoke_staging_launch_operations() from public,anon,authenticated,service_role;
select cron.schedule('opulence-staging-launch-operations','* * * * *','select public.invoke_staging_launch_operations();');
select cron.alter_job(jobid,active:=false) from cron.job where jobname='opulence-staging-launch-operations';
commit;
