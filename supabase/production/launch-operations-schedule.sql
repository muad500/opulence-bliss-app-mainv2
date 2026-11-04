-- Production uiqcsihgqaktpjumyeap only. Install before the web deployment.
-- New installs start paused; enable after the protected web route is Ready.
-- Reuse the existing Production web scheduler credential only, inside Vault.
begin;
do $production_guard$
declare gateway text; payload text;
begin
  select decrypted_secret into strict gateway from vault.decrypted_secrets
    where name='opulence_production_function_anon';
  payload:=split_part(gateway,'.',2);
  payload:=translate(payload,'-_','+/')||repeat('=',(4-length(payload)%4)%4);
  if (convert_from(decode(payload,'base64'),'UTF8')::jsonb->>'ref')<>'uiqcsihgqaktpjumyeap'
    or not exists(select 1 from vault.decrypted_secrets where name='opulence_cron_secret' and length(decrypted_secret)>0)
    or to_regprocedure('public.queue_launch_operations_reminders()') is null then
    raise exception 'Production scheduler or launch migration prerequisites missing';
  end if;
end;
$production_guard$;
create table if not exists public.production_launch_operations_runs(
  request_id bigint primary key, requested_at timestamptz not null default now()
);
alter table public.production_launch_operations_runs enable row level security;
revoke all on public.production_launch_operations_runs from public,anon,authenticated,service_role;
create or replace function public.invoke_production_launch_operations()
returns bigint language plpgsql security definer set search_path=public,vault,net as $function$
declare credential text; request bigint;
begin
  select decrypted_secret into strict credential from vault.decrypted_secrets
    where name='opulence_cron_secret';
  if coalesce(credential,'')='' then raise exception 'Production scheduler credential unavailable'; end if;
  request:=net.http_get(url:='https://www.opulencebliss.com/api/cron/launch-operations',
    headers:=jsonb_build_object('Authorization','Bearer '||credential),timeout_milliseconds:=55000);
  insert into public.production_launch_operations_runs(request_id) values(request);
  delete from public.production_launch_operations_runs where requested_at<now()-interval '7 days';
  return request;
end;
$function$;
revoke all on function public.invoke_production_launch_operations()
  from public,anon,authenticated,service_role;
do $schedule$
begin
  if not exists(select 1 from cron.job where jobname='opulence-production-launch-operations') then
    perform cron.schedule('opulence-production-launch-operations','* * * * *','select public.invoke_production_launch_operations();');
    perform cron.alter_job(jobid,active:=false) from cron.job where jobname='opulence-production-launch-operations';
  end if;
end;
$schedule$;
commit;
