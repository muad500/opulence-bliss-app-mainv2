begin;
-- A confirmed Supabase phone change may happen independently of profiles.
create function public.track_auth_phone_security_change()
returns trigger language plpgsql security definer set search_path=public,auth as $fn$
begin
  if new.phone is distinct from old.phone then
    perform public.queue_account_security_alert(new.id,'auth:'||txid_current()::text);
  end if;
  return new;
end $fn$;
revoke all on function public.track_auth_phone_security_change() from public,anon,authenticated;
create trigger account_security_auth_phone after update of phone on auth.users
  for each row execute function public.track_auth_phone_security_change();

-- The first saved professional home address uses an upsert/INSERT, not UPDATE.
drop trigger account_security_provider_home on public.provider_profile_settings;
create trigger account_security_provider_home after insert or update on public.provider_profile_settings for each row
  execute function public.track_profile_security_change('home_postcode','emergency_contact_name','emergency_contact_phone');
commit;
