-- STAGING ONLY (comwdjprdedmsnxtvuuk). Never include in a Production release.
-- The public Preview origin is installed in Vault separately after deployment.
begin;
create or replace function public.invoke_staging_cleaner_stage2()
returns bigint language plpgsql security definer set search_path = '' as $fn$
declare secret text; gateway text; bypass text; origin text;
begin
  select decrypted_secret into strict secret from vault.decrypted_secrets where name='opulence_staging_recovery_secret';
  select decrypted_secret into strict gateway from vault.decrypted_secrets where name='opulence_staging_function_anon';
  select decrypted_secret into strict bypass from vault.decrypted_secrets where name='opulence_staging_vercel_bypass';
  select decrypted_secret into strict origin from vault.decrypted_secrets where name='opulence_staging_cleaner_stage2_origin';
  if coalesce(length(secret),0)<32 or coalesce(length(bypass),0)<20
    or origin !~ '^https://opulence-bliss-app-mainv2-[a-z0-9-]+-muad500s-projects\.vercel\.app$' then
    raise exception 'Isolated staging worker configuration required.';
  end if;
  return net.http_post(url:='https://comwdjprdedmsnxtvuuk.supabase.co/functions/v1/cleaner-stage2-recovery',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||gateway,
      'apikey',gateway,'x-cleaner-stage2-secret',secret),
    body:=jsonb_build_object('origin',origin,'protectionBypass',bypass),timeout_milliseconds:=120000);
end;
$fn$;
revoke all on function public.invoke_staging_cleaner_stage2() from public,anon,authenticated,service_role;
select cron.schedule('opulence-staging-cleaner-stage2','* * * * *','select public.invoke_staging_cleaner_stage2();');
commit;
