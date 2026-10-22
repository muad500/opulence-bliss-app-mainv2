begin;

-- Preferences are functional account data, not marketing consent. No historical
-- notifications are replayed. Existing Updates must NEVER be suppressed.
drop trigger if exists respect_account_notification_preferences on public.notifications;
alter table public.web_push_preferences add column prompt_after timestamptz;
alter table public.web_push_subscriptions
  add column device_id uuid not null default gen_random_uuid(),
  add column device_name text not null default 'Browser',
  add column last_test_at timestamptz;
create unique index web_push_device on public.web_push_subscriptions(user_id,device_id);

create table public.notification_channel_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  audience text not null check(audience in ('customer','professional')),
  kind text not null,
  channel text not null check(channel in ('push','email','sms')),
  device_id uuid,
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  check((channel='push') = (device_id is not null)),
  check((audience='customer' and kind in ('booking','reminders','messages','status','payments'))
    or (audience='professional' and kind in ('offers','taken','reminders','messages','schedule','earnings','checks'))),
  unique nulls not distinct(user_id,audience,kind,channel,device_id)
);
alter table public.notification_channel_preferences enable row level security;
revoke all on public.notification_channel_preferences from public,anon,authenticated;
grant all on public.notification_channel_preferences to service_role;

create function public.notification_category(p_title text,p_href text)
returns text language sql immutable set search_path=public as $$
 select case
  when p_title like 'Message from %' then 'messages'
  when p_title ilike '%check%' and (p_title ilike '%DBS%' or p_title ilike '%right-to-work%')
    or p_title ilike '%insurance%expir%' then 'checks'
  when p_title='New cleaning job offer' then 'offers'
  when p_title='This job has been taken' then 'taken'
  when p_title like 'Your booking is in %' or p_title='30 minutes remaining' then 'reminders'
  when p_href like '/worker/earnings%' or p_title ilike '%payout%' then 'earnings'
  when p_title ilike '%payment%' or p_title ilike '%refund%' or p_title='Update your saved card' then case when p_href like '/worker%' then 'earnings' else 'payments' end
  when p_title ilike '%running late%' or p_title ilike '%arrival update%' or p_title ilike '%still finding%'
    or p_title ilike '%finding your cleaner%' or p_title ilike '%hasn''t arrived%' then 'status'
  when p_href like '/worker%' then 'schedule'
  else 'booking' end;
$$;
create function public.notification_essential_email(p_title text)
returns boolean language sql immutable set search_path=public as $$
 select p_title ~* '(security|verification code|check-in code|at the door|password|account details.*changed|payment.*(fail|attention|review|problem)|update your saved card|cancel|reschedul|booking.*chang|visit.*chang|series.*(paus|resum)|DBS|right.to.work|insurance.*expir|couldn.t fill|no provider available|problem with your visit|couldn.t get in|no access|looking into your visit|thanks for telling us)';
$$;

create function public.notification_channel_allowed(p_user uuid,p_audience text,p_kind text,p_channel text,p_device uuid default null,p_essential boolean default false)
returns boolean language plpgsql stable security definer set search_path=public as $$
declare choice boolean; settings jsonb;
begin
 if not exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=p_user
    and p.account_deleted_at is null and u.deleted_at is null and coalesce(u.banned_until,now())<=now()) then return false; end if;
 if p_channel='email' and p_essential then return true; end if;
 select enabled into choice from public.notification_channel_preferences where user_id=p_user
   and audience=p_audience and kind=p_kind and channel=p_channel and device_id is not distinct from p_device;
 if found then return choice; end if;
 -- Preserve existing opt-outs until the user explicitly chooses a new value.
 if p_audience='professional' then
  select to_jsonb(s) into settings from public.providers p left join public.provider_profile_settings s on s.provider_id=p.id where p.profile_id=p_user;
  if p_channel='sms' then return coalesce((settings->>'alert_sms')::boolean,false); end if;
  if p_kind='messages' and not coalesce((settings->>'notify_messages')::boolean,true) then return false; end if;
  if p_kind in ('offers','taken') then return coalesce((settings->>case when p_channel='email' then 'alert_email' else 'alert_app' end)::boolean,true); end if;
 else
  select to_jsonb(s) into settings from public.account_profile_details s where user_id=p_user;
  if p_channel='sms' then return coalesce((settings->>'contact_sms')::boolean,false); end if;
  if p_channel='email' and not coalesce((settings->>'contact_email')::boolean,true) then return false; end if;
  if p_kind='messages' then return coalesce((settings->>'notify_messages')::boolean,true); end if;
  if p_kind='reminders' then return coalesce((settings->>'notify_bookings')::boolean,true); end if;
 end if;
 return true;
end;
$$;

create function public.notification_settings(p_device uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare prefs jsonb; devices jsonb;
begin
 if auth.uid() is null or not public.account_is_active() then raise exception 'Sign in first'; end if;
 select jsonb_agg(jsonb_build_object('audience',a,'kind',k,'channel',c,'enabled',
  public.notification_channel_allowed(auth.uid(),a,k,c,case when c='push' then p_device end))) into prefs
 from (values('customer','booking'),('customer','reminders'),('customer','messages'),('customer','status'),('customer','payments'),
  ('professional','offers'),('professional','taken'),('professional','reminders'),('professional','messages'),
  ('professional','schedule'),('professional','earnings'),('professional','checks')) kinds(a,k)
 cross join (values('push'),('email'),('sms')) channels(c)
 where a='customer' or exists(select 1 from public.providers where profile_id=auth.uid());
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'deviceId',device_id,'name',device_name,'updatedAt',updated_at,
  'current',device_id=p_device) order by updated_at desc),'[]'::jsonb) into devices
 from public.web_push_subscriptions where user_id=auth.uid();
 return jsonb_build_object('preferences',prefs,'devices',devices,'marketingEnabled',coalesce((select marketing_emails from public.account_profile_details where user_id=auth.uid()),false));
end;
$$;
create function public.save_notification_settings(p_device uuid,p_changes jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare item jsonb;
begin
 if auth.uid() is null or not public.account_is_active() or p_device is null then raise exception 'Sign in first'; end if;
 if jsonb_typeof(p_changes)<>'array' or jsonb_array_length(p_changes)>36 then raise exception 'Invalid preferences'; end if;
 -- Snapshot legacy defaults before opening a legacy delivery gate. Otherwise
 -- enabling one type could accidentally re-enable other previously muted types.
 insert into public.notification_channel_preferences(user_id,audience,kind,channel,device_id,enabled)
  select auth.uid(),p->>'audience',p->>'kind',p->>'channel',case when p->>'channel'='push' then p_device end,(p->>'enabled')::boolean
  from jsonb_array_elements(public.notification_settings(p_device)->'preferences') p
  on conflict do nothing;
 for item in select * from jsonb_array_elements(p_changes) loop
  if jsonb_typeof(item->'enabled')<>'boolean' or item->>'audience' not in ('customer','professional')
    or item->>'channel' not in ('push','email','sms') or item->>'kind' is null then raise exception 'Invalid preference'; end if;
  if item->>'audience'='professional' and not exists(select 1 from public.providers where profile_id=auth.uid()) then raise exception 'Professional account required'; end if;
  insert into public.notification_channel_preferences(user_id,audience,kind,channel,device_id,enabled)
   values(auth.uid(),item->>'audience',item->>'kind',item->>'channel',case when item->>'channel'='push' then p_device end,(item->>'enabled')::boolean)
   on conflict(user_id,audience,kind,channel,device_id) do update set enabled=excluded.enabled,updated_at=now();
 end loop;
 -- Legacy queues still use these broad gates. The specific choices above are
 -- always rechecked before delivery, so broadening a gate cannot send a muted type.
 if exists(select 1 from jsonb_array_elements(p_changes) p where p->>'enabled'='true' and p->>'channel'='sms') then
  update public.account_profile_details set contact_sms=true where user_id=auth.uid();
 end if;
 if exists(select 1 from jsonb_array_elements(p_changes) p where p->>'enabled'='true' and p->>'kind'='reminders') then
  update public.account_profile_details set notify_bookings=true where user_id=auth.uid();
 end if;
 if exists(select 1 from jsonb_array_elements(p_changes) p where p->>'enabled'='true' and p->>'audience'='professional' and p->>'kind'='offers' and p->>'channel'='email') then
  update public.provider_profile_settings set alert_email=true where provider_id in(select id from public.providers where profile_id=auth.uid());
 end if;
end;
$$;

-- Offer ranking, qualification, first-acceptance locks and deduplication are
-- unchanged. The Updates copy is unconditional; only delivery channels are optional.
create or replace function public._offer_wave_notice(p_run uuid,p_provider uuid,p_kind text,p_booking uuid)
returns void language plpgsql security definer set search_path=public as $$
declare inserted integer;
begin
 insert into public.job_offer_notices(run_id,provider_id,kind) values(p_run,p_provider,p_kind) on conflict do nothing;
 get diagnostics inserted=row_count;
 if inserted=0 then return; end if;
 if p_kind='offered' and exists(select 1 from public.providers p where p.id=p_provider
  and public.notification_channel_allowed(p.profile_id,'professional','offers','email')) then
  insert into public.job_offer_emails(run_id,booking_id,provider_id) values(p_run,p_booking,p_provider) on conflict do nothing;
 end if;
 insert into public.notifications(user_id,title,body,href)
 select profile_id,case when p_kind='taken' then 'This job has been taken' else 'New cleaning job offer' end,
 case when p_kind='taken' then 'Another cleaner accepted first. This offer is now closed.' else 'A cleaning visit in your coverage area is available. The first cleaner to accept gets the job.' end,
 case when p_kind='taken' then '/worker' else '/worker/job/'||p_booking::text end from public.providers where id=p_provider;
end;
$$;
create function public.snooze_web_push_prompt()
returns void language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 insert into public.web_push_preferences(user_id,prompt_after) values(auth.uid(),now()+interval '14 days')
 on conflict(user_id) do update set prompt_after=excluded.prompt_after;
end;
$$;
create function public.save_notification_marketing(p_enabled boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null or not public.account_is_active() or p_enabled is null then raise exception 'Sign in first'; end if;
 -- Existing consent-audit trigger records the explicit opt-in/withdrawal.
 insert into public.account_profile_details(user_id,marketing_emails) values(auth.uid(),p_enabled)
 on conflict(user_id) do update set marketing_emails=excluded.marketing_emails;
end;
$$;
create function public.remove_web_push_device(p_device uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 perform pg_advisory_xact_lock(hashtextextended('push:'||auth.uid()::text,0));
 delete from public.web_push_subscriptions where user_id=auth.uid() and device_id=p_device;
 -- Keep type preferences; a new explicit enrolment restores the user's choices.
 -- A background refresh requires the existing device row and cannot reverse removal.
end;
$$;

create or replace function public.web_push_enrolment()
returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('eligible',auth.uid() is not null and public.account_is_active() and (
   exists(select 1 from public.bookings where customer_id=auth.uid())
   or exists(select 1 from public.providers where profile_id=auth.uid() and vetting_status::text='approved' and not coalesce(is_suspended,false))),
  'professional',exists(select 1 from public.providers where profile_id=auth.uid() and vetting_status::text='approved' and not coalesce(is_suspended,false)),
  'customerEligible',exists(select 1 from public.bookings where customer_id=auth.uid()),
  'hasConsent',exists(select 1 from public.web_push_preferences where user_id=auth.uid() and enabled
    and exists(select 1 from public.web_push_subscriptions where user_id=auth.uid())),
  'promptAfter',(select prompt_after from public.web_push_preferences where user_id=auth.uid()),
  'optedOut',exists(select 1 from public.web_push_preferences where user_id=auth.uid() and not enabled));
$$;

create function public.save_web_push_device(p_endpoint text,p_auth text,p_p256dh text,p_device uuid,p_name text,p_opt_in boolean default false)
returns void language plpgsql security definer set search_path=public as $$
begin
 if p_device is null then raise exception 'Device required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('push:'||auth.uid()::text,0));
 if not p_opt_in and not exists(select 1 from public.web_push_subscriptions where user_id=auth.uid() and device_id=p_device) then
  raise exception 'Explicit device opt-in required'; end if;
 -- Retain all original session, ownership, origin-provider and approval safeguards.
 perform public.save_web_push_subscription(p_endpoint,p_auth,p_p256dh,p_opt_in);
 delete from public.web_push_subscriptions where user_id=auth.uid() and device_id=p_device and endpoint<>p_endpoint;
 update public.web_push_subscriptions set device_id=p_device,device_name=left(coalesce(nullif(p_name,''),'Browser'),60)
   where user_id=auth.uid() and endpoint=p_endpoint;
 if p_opt_in then
  -- Restore only this device. Other devices and explicit category opt-outs stay intact.
  update public.web_push_preferences set prompt_after=null where user_id=auth.uid();
 end if;
end;
$$;

-- Classification is shared across the in-app event stream and channel gates.
create or replace function public.web_push_kind(p_title text)
returns text language sql immutable set search_path=public as $$
 select case
  when p_title like 'Message from %' then 'message'
  when p_title='New cleaning job offer' then 'offer'
  when p_title='This job has been taken' then 'taken'
  when p_title='Booking confirmed' then 'confirmed'
  when p_title='Booking received' then 'received'
  when p_title ilike '%cleaner assigned%' or p_title ilike '%professional assigned%' then 'assigned'
  when p_title ilike '%running late%' or p_title ilike '%arrival update%' then 'late'
  when p_title like 'Your booking is in %' then 'reminder'
  when p_title='30 minutes remaining' then 'remaining'
  when p_title ilike '%still finding%' or p_title ilike '%finding your cleaner%' then 'finding'
  when p_title ~* '(payment|refund|update your saved card)' then 'payment'
  when p_title ~* '(DBS|right.to.work|insurance.*expir)' then 'checks'
  when p_title ~* '(payout|earnings|invoice)' then 'earnings'
  when p_title ~* '(cancel|reschedul|booking.*chang|visit.*chang|series.*(paus|resum))' then 'schedule'
 end;
$$;

-- Global opt-out and approval checks are retained. Type/channel choices are
-- evaluated for EACH subscription immediately before delivery, not just enqueue.
create or replace function public.web_push_user_allowed(p_user uuid,p_kind text,p_href text)
returns boolean language sql stable security definer set search_path=public,auth as $$
 select exists(select 1 from auth.users u join public.profiles profile on profile.id=u.id
  where u.id=p_user and u.deleted_at is null and profile.account_deleted_at is null
  and coalesce(u.banned_until,now())<=now()
  and not exists(select 1 from public.web_push_preferences where user_id=p_user and not enabled)
  and (p_href not like '/worker%' or exists(select 1 from public.providers p
   where p.profile_id=p_user and p.vetting_status::text='approved' and not coalesce(p.is_suspended,false))));
$$;
alter function public.web_push_delivery_allowed(uuid,uuid) rename to web_push_delivery_allowed_before_channels;
create function public.web_push_delivery_allowed(p_id uuid,p_token uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select public.web_push_delivery_allowed_before_channels(p_id,p_token) and exists(
  select 1 from public.web_push_deliveries d join public.notifications n on n.id=d.notification_id
  join public.web_push_subscriptions s on s.id=d.subscription_id where d.id=p_id
  and (d.kind='test' or public.notification_channel_allowed(n.user_id,
   case when n.href like '/worker%' then 'professional' else 'customer' end,
   public.notification_category(n.title,n.href),'push',s.device_id)));
$$;
create function public.test_web_push_device(p_device uuid)
returns void language plpgsql security definer set search_path=public as $$
declare subscription uuid; notice uuid;
begin
 if auth.uid() is null or not (public.web_push_enrolment()->>'eligible')::boolean then raise exception 'Not eligible'; end if;
 select id into subscription from public.web_push_subscriptions where user_id=auth.uid() and device_id=p_device
   and (last_test_at is null or last_test_at<now()-interval '1 minute') for update;
 if subscription is null then raise exception 'Enable this device, or wait a minute before testing again'; end if;
 update public.web_push_subscriptions set last_test_at=now() where id=subscription;
 insert into public.notifications(user_id,title,body,href) values(auth.uid(),'Test notification',
   'Notifications work on this device.',case when (public.web_push_enrolment()->>'professional')::boolean then '/worker/profile' else '/account/profile' end) returning id into notice;
 insert into public.web_push_deliveries(notification_id,subscription_id,kind) values(notice,subscription,'test');
end;
$$;

-- Existing durable email and SMS senders retain their state/freshness checks.
-- Channel preferences are rechecked after claiming, before any external send.
alter function public.preferred_confirmation_sms_sent(uuid) rename to preferred_confirmation_sms_sent_before_channels;
create function public.preferred_confirmation_sms_sent(p_email_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select public.preferred_confirmation_sms_sent_before_channels(p_email_id) and not exists(
  select 1 from public.booking_notification_deliveries d where d.id=p_email_id and (
   public.notification_essential_email(d.title) or exists(select 1 from public.notification_channel_preferences p
    where p.user_id=d.user_id and p.audience='customer' and p.kind=public.notification_category(d.title,d.href)
     and p.channel='email' and p.enabled)));
$$;
create or replace function public.booking_email_preference_allowed(p_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select auth.role()='service_role' and public.notification_channel_allowed(d.user_id,
  case when d.href like '/worker%' then 'professional' else 'customer' end,
  public.notification_category(d.title,d.href),'email',null,public.notification_essential_email(d.title))
 from public.booking_notification_deliveries d where d.id=p_id;
$$;
alter function public.booking_sms_allowed(uuid,uuid) rename to booking_sms_allowed_before_channels;
create function public.booking_sms_allowed(p_id uuid,p_token uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select public.booking_sms_allowed_before_channels(p_id,p_token) and exists(
  select 1 from public.booking_notification_deliveries d where d.id=p_id and
  public.notification_channel_allowed(d.user_id,case when d.href like '/worker%' then 'professional' else 'customer' end,
  public.notification_category(d.title,d.href),'sms'));
$$;
alter function public.visit_matching_notice_allowed(uuid,uuid) rename to visit_matching_notice_allowed_before_channels;
create function public.visit_matching_notice_allowed(p_id uuid,p_token uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select public.visit_matching_notice_allowed_before_channels(p_id,p_token) and case
  when exists(select 1 from public.job_offer_emails where id=p_id) then exists(
   select 1 from public.job_offer_emails e join public.providers p on p.id=e.provider_id where e.id=p_id
    and public.notification_channel_allowed(p.profile_id,'professional','offers','email'))
  else exists(select 1 from public.visit_matching_notices n where n.id=p_id and
   (n.kind='admin_48h' or public.notification_channel_allowed(n.user_id,'customer',
    public.notification_category(n.title,n.href),n.channel,null,public.notification_essential_email(n.title)))) end;
$$;

create or replace function public.chat_message_email_eligible(p_id uuid)
returns boolean language sql stable security definer set search_path=public,auth as $$
 select exists(select 1 from public.chat_message_emails e
  join public.booking_messages m on m.id=e.message_id join public.bookings b on b.id=e.booking_id
  join public.providers p on p.id=b.provider_id join public.profiles recipient on recipient.id=e.recipient_id
  join public.profiles sender on sender.id=m.sender_id join auth.users u on u.id=recipient.id
  join public.notifications n on n.id=e.notification_id
  where e.id=p_id and m.read_at is null and not n.read and recipient.account_deleted_at is null
   and sender.account_deleted_at is null and u.deleted_at is null and coalesce(u.banned_until,now())<=now()
   and nullif(u.email,'') is not null and b.status::text in ('scheduled','in_progress','completed','needs_review')
   and now()<public.visit_contact_end(b.id)+interval '24 hours'
   and ((m.sender_role='provider' and m.sender_id=p.profile_id and recipient.id=b.customer_id)
     or (m.sender_role='customer' and m.sender_id=b.customer_id and recipient.id=p.profile_id))
   and public.notification_channel_allowed(recipient.id,case when recipient.id=p.profile_id then 'professional' else 'customer' end,'messages','email'));
$$;

-- Direct operational emails use the same gate. Security/auth mail remains on
-- its existing essential-only path, never controlled by optional preferences.
create function public.operational_email_allowed(p_email text,p_title text,p_href text)
returns boolean language sql stable security definer set search_path=public,auth as $$
 select auth.role()='service_role' and coalesce((select public.notification_channel_allowed(u.id,
  case when p_href like '/worker%' then 'professional' else 'customer' end,
  public.notification_category(p_title,p_href),'email',null,public.notification_essential_email(p_title))
  from auth.users u where lower(u.email)=lower(p_email) limit 1),true);
$$;

-- Added email coverage for events not already handled by booking, matching,
-- direct operational or unread-chat mail. No duplicates of those senders.
create table public.notification_extra_emails (
 id uuid primary key default gen_random_uuid(),
 notification_id uuid not null unique references public.notifications(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','processing','sent','cancelled','failed')),
 attempts integer not null default 0, claim_token uuid, lease_until timestamptz,
 next_attempt_at timestamptz not null default now(),created_at timestamptz not null default now()
);
alter table public.notification_extra_emails enable row level security;
revoke all on public.notification_extra_emails from public,anon,authenticated;
grant all on public.notification_extra_emails to service_role;
create function public.queue_extra_notification_email()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.href ~ '^/(account|worker)(/|$)' and public.web_push_kind(new.title) in ('taken','checks','earnings','payment','schedule')
   and new.title not ilike 'Visit completed%' then
  insert into public.notification_extra_emails(notification_id) values(new.id) on conflict do nothing;
 end if;
 return new;
end;
$$;
create trigger queue_extra_notification_email after insert on public.notifications for each row execute function public.queue_extra_notification_email();

-- Add insurance expiry notices to the existing daily verification scheduler.
-- Qualification rules and admin verification are not changed.
alter table public.verification_renewal_reminders drop constraint verification_renewal_reminders_check_type_check;
alter table public.verification_renewal_reminders add constraint verification_renewal_reminders_check_type_check check(check_type in ('dbs','right_to_work','insurance'));
alter function public.process_verification_renewals() rename to process_verification_renewals_before_channels;
create function public.process_verification_renewals()
returns integer language plpgsql security definer set search_path=public as $$
declare total integer; item record; inserted integer;
begin
 total:=public.process_verification_renewals_before_channels();
 for item in select p.id,p.profile_id,v.expires_at::date as due from public.providers p
   join public.provider_verification_items v on v.provider_id=p.id where v.document_type='public_liability_insurance'
    and v.status='verified' and v.expires_at is not null and v.expires_at::date<=current_date+30 loop
  insert into public.verification_renewal_reminders(provider_id,check_type,due_date,phase,recipient_id)
  values(item.id,'insurance',item.due,case when item.due<current_date then 'expired' else 'due_soon' end,item.profile_id) on conflict do nothing;
  get diagnostics inserted=row_count;
  if inserted=1 then
   insert into public.notifications(user_id,title,body,href) values(item.profile_id,'Insurance expiry warning',
    'Your insurance evidence is due for renewal. Open your profile to check it.','/worker/profile#verification');
   total:=total+1;
  end if;
 end loop;
 return total;
end;
$$;
create function public.extra_notification_email_allowed(p_id uuid,p_token uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select auth.role()='service_role' and exists(select 1 from public.notification_extra_emails e
  join public.notifications n on n.id=e.notification_id where e.id=p_id and e.claim_token=p_token
   and e.status='processing' and e.lease_until>now() and e.created_at>now()-interval '23 hours'
   and public.notification_channel_allowed(n.user_id,case when n.href like '/worker%' then 'professional' else 'customer' end,
   public.notification_category(n.title,n.href),'email',null,public.notification_essential_email(n.title)));
$$;
create function public.claim_extra_notification_emails()
returns table(id uuid,claim_token uuid,email text,title text,href text)
language plpgsql security definer set search_path=public,auth as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
 delete from public.notification_extra_emails where created_at<now()-interval '7 days';
 return query with picked as (select e.id from public.notification_extra_emails e where e.attempts<5
   and e.created_at>now()-interval '23 hours' and e.next_attempt_at<=now()
   and (e.status='pending' or (e.status='processing' and e.lease_until<now()))
   order by e.created_at for update skip locked limit 5), claimed as (
  update public.notification_extra_emails e set status='processing',claim_token=gen_random_uuid(),
   lease_until=now()+interval '2 minutes',attempts=e.attempts+1 from picked where e.id=picked.id returning e.*)
 select e.id,e.claim_token,u.email::text,n.title,n.href from claimed e join public.notifications n on n.id=e.notification_id join auth.users u on u.id=n.user_id;
end;
$$;
create function public.finish_extra_notification_email(p_id uuid,p_token uuid,p_outcome text)
returns void language plpgsql security definer set search_path=public as $$
begin
 if auth.role() is distinct from 'service_role' or p_outcome not in ('sent','cancelled','retry') then raise exception 'Invalid delivery'; end if;
 update public.notification_extra_emails set status=case when p_outcome='retry' then case when attempts>=5 then 'failed' else 'pending' end else p_outcome end,
  claim_token=null,lease_until=null,next_attempt_at=now()+interval '1 minute'*power(2,attempts)
  where id=p_id and claim_token=p_token and status='processing';
end;
$$;

-- Revoke every new SECURITY DEFINER entry point by default, then allow only
-- narrow authenticated self-service methods and service-only delivery gates.
revoke all on function public.notification_category(text,text),public.notification_essential_email(text),
 public.notification_channel_allowed(uuid,text,text,text,uuid,boolean),public.notification_settings(uuid),
 public.save_notification_settings(uuid,jsonb),public.snooze_web_push_prompt(),public.remove_web_push_device(uuid),
 public.save_notification_marketing(boolean),public.process_verification_renewals(),public.process_verification_renewals_before_channels(),
 public.preferred_confirmation_sms_sent(uuid),public.preferred_confirmation_sms_sent_before_channels(uuid),
public.save_web_push_device(text,text,text,uuid,text,boolean),public.test_web_push_device(uuid),public._offer_wave_notice(uuid,uuid,text,uuid),
 public.web_push_delivery_allowed(uuid,uuid),public.web_push_delivery_allowed_before_channels(uuid,uuid),
 public.booking_sms_allowed(uuid,uuid),public.booking_sms_allowed_before_channels(uuid,uuid),
 public.visit_matching_notice_allowed(uuid,uuid),public.visit_matching_notice_allowed_before_channels(uuid,uuid),
 public.operational_email_allowed(text,text,text),public.queue_extra_notification_email(),
 public.extra_notification_email_allowed(uuid,uuid),public.claim_extra_notification_emails(),public.finish_extra_notification_email(uuid,uuid,text)
 from public,anon,authenticated;
grant execute on function public.notification_settings(uuid),public.save_notification_settings(uuid,jsonb),
 public.save_notification_marketing(boolean),
 public.snooze_web_push_prompt(),public.remove_web_push_device(uuid),public.save_web_push_device(text,text,text,uuid,text,boolean),public.test_web_push_device(uuid) to authenticated;
grant execute on function public.web_push_delivery_allowed(uuid,uuid),public.booking_sms_allowed(uuid,uuid),
 public.process_verification_renewals(),
 public.preferred_confirmation_sms_sent(uuid),
 public.visit_matching_notice_allowed(uuid,uuid),public.operational_email_allowed(text,text,text),
 public.extra_notification_email_allowed(uuid,uuid),public.claim_extra_notification_emails(),public.finish_extra_notification_email(uuid,uuid,text) to service_role;
commit;
