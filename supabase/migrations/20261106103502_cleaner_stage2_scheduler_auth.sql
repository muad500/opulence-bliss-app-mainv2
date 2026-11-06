begin;
-- Verify a domain-separated proof in the database. The existing staging
-- worker secret never leaves Vault and no API key is reused as a shared key.
create function public.cleaner_stage2_scheduler_authorized(p_token text)
returns boolean language plpgsql security definer set search_path = '' as $fn$
declare key text;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then return false; end if;
  select decrypted_secret into key from vault.decrypted_secrets where name='opulence_staging_recovery_secret';
  if key is null or length(key)<32 then return false;end if;
  return extensions.digest(p_token,'sha256')=extensions.digest(
    encode(extensions.hmac('opulence/staging/cleaner-stage2-scheduler/v1',key,'sha256'),'hex'),'sha256');
end;
$fn$;
revoke all on function public.cleaner_stage2_scheduler_authorized(text) from public,anon,authenticated,service_role;
grant execute on function public.cleaner_stage2_scheduler_authorized(text) to service_role;
notify pgrst,'reload schema';
commit;
