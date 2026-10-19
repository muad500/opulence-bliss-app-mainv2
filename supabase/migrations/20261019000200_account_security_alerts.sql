-- Transactional, private outbox: only committed changes enqueue mail. Pending
-- email-change requests never notify; auth.users.email changes after confirmation.
begin;
create table public.account_security_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  recipient text not null,
  source_event text not null,
  status text not null default 'pending' check (status in ('pending','processing','sent','failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  leased_until timestamptz,
  claim_token uuid,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  last_error text,
  unique (user_id, source_event, recipient)
);
alter table public.account_security_alerts enable row level security;
revoke all on public.account_security_alerts from public,anon,authenticated;
grant all on public.account_security_alerts to service_role;
create index account_security_alerts_due on public.account_security_alerts(next_attempt_at) where status in ('pending','processing');

create function public.queue_account_security_alert(p_user uuid, p_event text, p_old_email text default null)
returns void language plpgsql security definer set search_path=public,auth as $fn$
declare v_email text; v_deleted boolean;
begin
  select u.email, (u.deleted_at is not null or p.account_deleted_at is not null)
    into v_email,v_deleted from auth.users u left join public.profiles p on p.id=u.id where u.id=p_user;
  if not found or coalesce(v_deleted,false) then return; end if;
  insert into public.account_security_alerts(user_id,recipient,source_event)
    select p_user,lower(btrim(e)),p_event from unnest(array[v_email,p_old_email]) e
    where coalesce(btrim(e),'')<>'' on conflict do nothing;
end $fn$;
revoke all on function public.queue_account_security_alert(uuid,text,text) from public,anon,authenticated;
grant execute on function public.queue_account_security_alert(uuid,text,text) to service_role;

create function public.track_auth_security_change()
returns trigger language plpgsql security definer set search_path=public,auth as $fn$
begin
  if new.email is distinct from old.email or new.encrypted_password is distinct from old.encrypted_password then
    perform public.queue_account_security_alert(new.id,'auth:'||txid_current()::text,
      case when new.email is distinct from old.email then old.email end);
  end if;
  return new;
end $fn$;
revoke all on function public.track_auth_security_change() from public,anon,authenticated;
create trigger account_security_auth_change after update of email,encrypted_password on auth.users
  for each row execute function public.track_auth_security_change();

-- Compare only the named fields, never timestamps, ratings, marketing settings,
-- confirmation requests or payout-dashboard links. No values enter the outbox.
create function public.track_profile_security_change()
returns trigger language plpgsql security definer set search_path=public as $fn$
declare v_old jsonb; v_new jsonb; v_row jsonb; v_user uuid; v_key text; v_changed boolean:=false;
begin
  if tg_op<>'INSERT' then v_old:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then v_new:=to_jsonb(new); end if;
  v_row:=coalesce(v_new,v_old);
  if tg_table_name='profiles' then v_user:=(v_row->>'id')::uuid;
  elsif tg_table_name in ('account_profile_details','customer_addresses') then v_user:=(v_row->>'user_id')::uuid;
  elsif tg_table_name='providers' then v_user:=(v_row->>'profile_id')::uuid;
  else select profile_id into v_user from public.providers where id=(v_row->>'provider_id')::uuid;
  end if;
  foreach v_key in array tg_argv loop
    if nullif(v_old->v_key,'null'::jsonb) is distinct from nullif(v_new->v_key,'null'::jsonb) then v_changed:=true; end if;
  end loop;
  if v_changed and v_user is not null then
    perform public.queue_account_security_alert(v_user,'profile:'||txid_current()::text);
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end $fn$;
revoke all on function public.track_profile_security_change() from public,anon,authenticated;
create trigger account_security_profile after update on public.profiles for each row
  execute function public.track_profile_security_change('full_name','phone','address','postcode');
create trigger account_security_details after insert or update on public.account_profile_details for each row
  execute function public.track_profile_security_change('first_name','last_name','photo_url','photo_storage_path');
create trigger account_security_address after insert or update or delete on public.customer_addresses for each row
  execute function public.track_profile_security_change('label','line1','line2','city','postcode','access_instructions','property_type','bedrooms','bathrooms','pets','products_provided_by','is_default');
create trigger account_security_provider after update on public.providers for each row
  execute function public.track_profile_security_change('display_name','photo_url','stripe_account_id','payout_schedule');
create trigger account_security_provider_home after update on public.provider_profile_settings for each row
  execute function public.track_profile_security_change('home_postcode','emergency_contact_name','emergency_contact_phone');

create function public.claim_account_security_alerts(p_limit integer default 4)
returns setof public.account_security_alerts language sql security definer set search_path=public as $fn$
  update public.account_security_alerts a set status='processing',attempts=attempts+1,
    claim_token=gen_random_uuid(),leased_until=now()+interval '2 minutes'
  where a.id in (select id from public.account_security_alerts
    where status in ('pending','processing') and next_attempt_at<=now()
      and (leased_until is null or leased_until<now()) and attempts<12
      and created_at>now()-interval '23 hours'
    order by created_at for update skip locked limit greatest(1,least(p_limit,4)))
  returning a.*;
$fn$;
revoke all on function public.claim_account_security_alerts(integer) from public,anon,authenticated;
grant execute on function public.claim_account_security_alerts(integer) to service_role;

-- Staging can install a private asynchronous delivery hook separately. The
-- generic migration contains no staging URL, bypass token or service credential.
create function public.wake_account_security_delivery()
returns trigger language plpgsql security definer set search_path=public as $fn$
begin
  if to_regprocedure('public.invoke_staging_account_security_alerts()') is not null then
    execute 'select public.invoke_staging_account_security_alerts()';
  end if;
  return null;
end $fn$;
revoke all on function public.wake_account_security_delivery() from public,anon,authenticated;
create trigger account_security_delivery after insert on public.account_security_alerts
  for each statement execute function public.wake_account_security_delivery();
commit;
