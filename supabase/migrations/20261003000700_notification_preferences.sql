begin;
-- Message content is still saved in chat when its optional notification is off.
create or replace function public.respect_account_notification_preferences()
returns trigger language plpgsql security definer set search_path=public as $fn$
declare enabled boolean;
begin
  if new.title like 'Message from %' then
    if new.href like '/worker/%' then
      select settings.notify_messages into enabled from public.providers p
        join public.provider_profile_settings settings on settings.provider_id=p.id where p.profile_id=new.user_id;
    else
      select notify_messages into enabled from public.account_profile_details where user_id=new.user_id;
    end if;
    if enabled=false then return null; end if;
  elsif new.href like '/account/%' and (new.title like 'Your booking is in %' or new.title='30 minutes remaining') then
    select notify_bookings into enabled from public.account_profile_details where user_id=new.user_id;
    if enabled=false then return null; end if;
  end if;
  return new;
end $fn$;
drop trigger if exists respect_account_notification_preferences on public.notifications;
create trigger respect_account_notification_preferences before insert on public.notifications
for each row execute function public.respect_account_notification_preferences();
revoke all on function public.respect_account_notification_preferences() from public,anon,authenticated,service_role;

create or replace function public.skip_booking_email(p_id uuid,p_token uuid)
returns void language plpgsql security definer set search_path=public as $fn$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  update public.booking_notification_deliveries set status='cancelled',claim_token=null,last_error='Account notification preference'
    where id=p_id and claim_token=p_token and status='processing';
end $fn$;
revoke all on function public.skip_booking_email(uuid,uuid) from public,anon,authenticated;
grant execute on function public.skip_booking_email(uuid,uuid) to service_role;

create or replace function public.booking_email_preference_allowed(p_id uuid)
returns boolean language sql security definer set search_path=public as $fn$
  select case when d.href like '/account/%' and d.kind in ('reminder_24h','reminder_90m','remaining_30m')
    then coalesce(settings.notify_bookings,true) and coalesce(settings.contact_email,true)
    else true end
  from public.booking_notification_deliveries d left join public.account_profile_details settings on settings.user_id=d.user_id
  where d.id=p_id and auth.role()='service_role';
$fn$;
revoke all on function public.booking_email_preference_allowed(uuid) from public,anon,authenticated;
grant execute on function public.booking_email_preference_allowed(uuid) to service_role;
commit;
