begin;

-- Endpoints are bearer capabilities. Never expose subscriptions through SELECT,
-- Realtime, logs or the notification payload. Bind each device to its auth session.
create table public.web_push_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true
);
create table public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references auth.sessions(id) on delete cascade,
  endpoint text not null unique check(length(endpoint) <= 2048),
  auth_key text not null, p256dh text not null,
  updated_at timestamptz not null default now()
);
create table public.web_push_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  subscription_id uuid not null references public.web_push_subscriptions(id) on delete cascade,
  kind text not null,
  status text not null default 'pending' check(status in ('pending','processing','sent','cancelled','failed')),
  attempts integer not null default 0,
  claim_token uuid, lease_until timestamptz,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(notification_id, subscription_id)
);
create index web_push_pending on public.web_push_deliveries(next_attempt_at) where status in ('pending','processing');
alter table public.web_push_preferences enable row level security;
alter table public.web_push_subscriptions enable row level security;
alter table public.web_push_deliveries enable row level security;
revoke all on public.web_push_preferences,public.web_push_subscriptions,public.web_push_deliveries from public,anon,authenticated;
grant all on public.web_push_preferences,public.web_push_subscriptions,public.web_push_deliveries to service_role;

create function public.web_push_kind(p_title text)
returns text language sql immutable set search_path=public as $$
 select case
  when p_title like 'Message from %' then 'message'
  when p_title='New cleaning job offer' then 'offer'
  when p_title='This job has been taken' then 'taken'
  when p_title='Booking confirmed' then 'confirmed'
  when p_title='Booking received' then 'received'
  when p_title ilike '%cleaner assigned%' or p_title ilike '%professional assigned%' then 'assigned'
  when p_title ilike '%running late' or p_title ilike '%arrival update%' then 'late'
  when p_title like 'Your booking is in %' then 'reminder'
  when p_title='30 minutes remaining' then 'remaining'
  when p_title ilike '%still finding%' or p_title ilike '%finding your cleaner%' then 'finding'
  when p_title in ('Update your saved card','Payment failed','Payment needs attention') then 'payment'
 end;
$$;

create function public.web_push_user_allowed(p_user uuid,p_kind text,p_href text)
returns boolean language sql stable security definer set search_path=public,auth as $$
 select exists(select 1 from auth.users u join public.profiles profile on profile.id=u.id
  where u.id=p_user and u.deleted_at is null and profile.account_deleted_at is null
  and coalesce(u.banned_until,now()) <= now()
  and not exists(select 1 from public.web_push_preferences where user_id=p_user and not enabled)
  and case when p_href like '/worker%' then
    exists(select 1 from public.providers p left join public.provider_profile_settings s on s.provider_id=p.id
      where p.profile_id=p_user and p.vetting_status::text='approved' and not coalesce(p.is_suspended,false)
      and coalesce(s.alert_app,true) and (p_kind<>'message' or coalesce(s.notify_messages,true)))
   else not exists(select 1 from public.account_profile_details s where s.user_id=p_user
     and case when p_kind='message' then not s.notify_messages else not s.notify_bookings end)
   end);
$$;

create function public.web_push_enrolment()
returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('eligible', auth.uid() is not null and public.account_is_active() and (
   exists(select 1 from public.bookings where customer_id=auth.uid() and status::text in ('offered','scheduled','in_progress','completed'))
   or exists(select 1 from public.providers where profile_id=auth.uid() and vetting_status::text='approved' and not coalesce(is_suspended,false))),
  'hasConsent', exists(select 1 from public.web_push_preferences where user_id=auth.uid() and enabled),
  'optedOut', exists(select 1 from public.web_push_preferences where user_id=auth.uid() and not enabled));
$$;

create function public.save_web_push_subscription(p_endpoint text,p_auth text,p_p256dh text,p_opt_in boolean default false)
returns void language plpgsql security definer set search_path=public,auth as $$
declare uid uuid:=auth.uid(); sid uuid:=nullif(auth.jwt()->>'session_id','')::uuid;
begin
 if uid is null or sid is null or not (public.web_push_enrolment()->>'eligible')::boolean
  or not exists(select 1 from auth.sessions where id=sid and user_id=uid and (not_after is null or not_after>now()))
  then raise exception 'Not eligible'; end if;
 if p_endpoint !~ '^https://(fcm[.]googleapis[.]com|updates[.]push[.]services[.]mozilla[.]com|[a-z0-9-]+[.]notify[.]windows[.]com)/[^[:space:]]+$'
  or length(p_endpoint)>2048 or p_auth !~ '^[A-Za-z0-9_-]{22}$' or p_p256dh !~ '^B[A-Za-z0-9_-]{86}$'
  then raise exception 'Unsupported subscription'; end if;
 perform pg_advisory_xact_lock(hashtextextended('push:'||uid::text,0));
 if not p_opt_in and not exists(select 1 from public.web_push_preferences where user_id=uid and enabled) then raise exception 'Explicit opt-in required'; end if;
 if exists(select 1 from public.web_push_subscriptions where endpoint=p_endpoint and user_id<>uid) then raise exception 'Device belongs to another account'; end if;
 if (select count(*) from public.web_push_subscriptions where user_id=uid)>=10
  and not exists(select 1 from public.web_push_subscriptions where endpoint=p_endpoint and user_id=uid) then raise exception 'Device limit reached'; end if;
 if p_opt_in then
  insert into public.web_push_preferences(user_id,enabled) values(uid,true) on conflict(user_id) do update set enabled=true;
 end if;
 insert into public.web_push_subscriptions(user_id,session_id,endpoint,auth_key,p256dh) values(uid,sid,p_endpoint,p_auth,p_p256dh)
 on conflict(endpoint) do update set session_id=sid,auth_key=p_auth,p256dh=p_p256dh,updated_at=now() where web_push_subscriptions.user_id=uid;
end;
$$;

create function public.disable_web_push()
returns void language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 perform pg_advisory_xact_lock(hashtextextended('push:'||auth.uid()::text,0));
 insert into public.web_push_preferences(user_id,enabled) values(auth.uid(),false) on conflict(user_id) do update set enabled=false;
 delete from public.web_push_subscriptions where user_id=auth.uid();
end;
$$;

create function public.queue_web_push()
returns trigger language plpgsql security definer set search_path=public as $$
declare kind text:=public.web_push_kind(new.title);
begin
 if kind is not null and not new.read and new.href ~ '^/(account|worker|handyman)(/|$)'
  and public.web_push_user_allowed(new.user_id,kind,new.href) then
  insert into public.web_push_deliveries(notification_id,subscription_id,kind)
   select new.id,id,kind from public.web_push_subscriptions where user_id=new.user_id on conflict do nothing;
 end if;
 return new;
end;
$$;
create trigger queue_web_push after insert on public.notifications for each row execute function public.queue_web_push();

create function public.web_push_delivery_allowed(p_id uuid,p_token uuid)
returns boolean language sql stable security definer set search_path=public,auth as $$
 select auth.role()='service_role' and exists(
  select 1 from public.web_push_deliveries d join public.notifications n on n.id=d.notification_id
  join public.web_push_subscriptions s on s.id=d.subscription_id
  join auth.sessions session on session.id=s.session_id and session.user_id=s.user_id
  where d.id=p_id and d.claim_token=p_token and d.status='processing' and d.lease_until>now()
  and s.user_id=n.user_id and (session.not_after is null or session.not_after>now())
  and d.created_at>now()-interval '10 minutes' and not n.read
  and public.web_push_user_allowed(n.user_id,d.kind,n.href)
  and (d.kind<>'offer' or exists(select 1 from public.bookings b
    join public.booking_offer_queue q on q.booking_id=b.id
    join public.providers p on p.id=q.provider_id
    where n.href='/worker/job/'||b.id::text and b.status::text='offered' and b.provider_id is null and p.profile_id=n.user_id)
    or (d.kind='offer' and n.href like '/worker/handyman%'))
 );
$$;

create function public.claim_web_push(p_limit integer default 5)
returns table(id uuid,claim_token uuid,notification_id uuid,user_id uuid,kind text,href text,endpoint text,auth_key text,p256dh text)
language plpgsql security definer set search_path=public as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
 delete from public.web_push_deliveries where created_at<now()-interval '7 days';
 return query with picked as (
  select d.id from public.web_push_deliveries d where d.attempts<4 and d.created_at>now()-interval '10 minutes'
   and ((d.status='pending' and d.next_attempt_at<=now()) or (d.status='processing' and d.lease_until<now()))
  order by d.created_at for update skip locked limit greatest(1,least(p_limit,5))
 ), claimed as (
  update public.web_push_deliveries d set status='processing',claim_token=gen_random_uuid(),lease_until=now()+interval '3 minutes',attempts=d.attempts+1
  from picked where d.id=picked.id returning d.*
 ) select d.id,d.claim_token,d.notification_id,n.user_id,d.kind,n.href,s.endpoint,s.auth_key,s.p256dh
  from claimed d join public.notifications n on n.id=d.notification_id join public.web_push_subscriptions s on s.id=d.subscription_id;
end;
$$;

create function public.finish_web_push(p_id uuid,p_token uuid,p_outcome text)
returns void language plpgsql security definer set search_path=public as $$
declare sub uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
 if p_outcome not in ('sent','cancelled','retry','expired') then raise exception 'Invalid outcome'; end if;
 update public.web_push_deliveries set status=case when p_outcome='sent' then 'sent'
  when p_outcome in ('expired','cancelled') then 'cancelled' when attempts>=4 then 'failed' else 'pending' end,
  claim_token=null,lease_until=null,next_attempt_at=now()+interval '1 minute'*power(2,attempts)
  where id=p_id and claim_token=p_token and status='processing' returning subscription_id into sub;
 if p_outcome='expired' and sub is not null then delete from public.web_push_subscriptions where id=sub; end if;
end;
$$;

revoke all on function public.web_push_kind(text),public.web_push_user_allowed(uuid,text,text),public.queue_web_push(),public.web_push_delivery_allowed(uuid,uuid),public.claim_web_push(integer),public.finish_web_push(uuid,uuid,text),public.web_push_enrolment(),public.save_web_push_subscription(text,text,text,boolean),public.disable_web_push() from public,anon,authenticated;
grant execute on function public.web_push_enrolment(),public.save_web_push_subscription(text,text,text,boolean),public.disable_web_push() to authenticated;
grant execute on function public.web_push_delivery_allowed(uuid,uuid),public.claim_web_push(integer),public.finish_web_push(uuid,uuid,text) to service_role;
commit;
