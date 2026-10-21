-- STAGING OPERATIONS ONLY. Not a production migration. Credentials must already
-- be in staging Vault; the URL gate prevents using a public production origin.
begin;
do $$
begin
 if not exists(select 1 from vault.decrypted_secrets where name='opulence_staging_web_push_cron')
  or not exists(select 1 from vault.decrypted_secrets where name='opulence_staging_vercel_bypass')
  or not exists(select 1 from vault.decrypted_secrets where name='opulence_staging_web_push_origin'
   and decrypted_secret ~ '^https://opulence-bliss-app-mainv2-git-codex-[a-z0-9-]+-muad500s-projects[.]vercel[.]app$')
 then raise exception 'Isolated staging push Vault configuration is required'; end if;
end;
$$;

create or replace function public.invoke_staging_web_push()
returns bigint language plpgsql security definer set search_path=public,vault,net as $$
declare origin text; bearer text; bypass text;
begin
 select decrypted_secret into origin from vault.decrypted_secrets where name='opulence_staging_web_push_origin';
 select decrypted_secret into bearer from vault.decrypted_secrets where name='opulence_staging_web_push_cron';
 select decrypted_secret into bypass from vault.decrypted_secrets where name='opulence_staging_vercel_bypass';
 if origin !~ '^https://opulence-bliss-app-mainv2-git-codex-[a-z0-9-]+-muad500s-projects[.]vercel[.]app$'
  or origin is null or bearer is null or bypass is null then return null; end if;
 return net.http_get(url:=origin||'/api/cron/web-push',
  headers:=jsonb_build_object('Authorization','Bearer '||bearer,'x-vercel-protection-bypass',bypass),
  timeout_milliseconds:=60000);
end;
$$;
revoke all on function public.invoke_staging_web_push() from public,anon,authenticated,service_role;

-- Updating this named job is idempotent and does not touch payment, chat/email
-- or other developers' jobs. Disable/remove it when this branch is archived.
select cron.schedule('opulence-staging-web-push','* * * * *','select public.invoke_staging_web_push();');
commit;
