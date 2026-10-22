-- Isolated PostgreSQL only. NEVER bootstrap this on a hosted database.
\set ON_ERROR_STOP on
\ir web_push.sql
alter table auth.users add column email text;
alter table public.account_profile_details add column contact_email boolean default true,add column contact_sms boolean default false,add column marketing_emails boolean default false;
create table public.verification_renewal_reminders(provider_id uuid,check_type text check(check_type in ('dbs','right_to_work')),due_date date,phase text,recipient_id uuid,unique(provider_id,check_type,due_date,phase,recipient_id));
create table public.provider_verification_items(provider_id uuid,document_type text,status text,expires_at date);
create function public.process_verification_renewals() returns integer language sql as $$select 0$$;
alter table public.provider_profile_settings add column alert_email boolean default true,add column alert_sms boolean default false;
create table public.job_offer_notices(run_id uuid,provider_id uuid,kind text,unique(run_id,provider_id,kind));
create table public.job_offer_emails(id uuid primary key default gen_random_uuid(),run_id uuid,booking_id uuid,provider_id uuid,unique(run_id,provider_id));
create table public.booking_notification_deliveries(id uuid,user_id uuid,href text,title text);
create table public.visit_matching_notices(id uuid,user_id uuid,kind text,title text,href text,channel text);
create table public.chat_message_emails(id uuid,message_id bigint,booking_id uuid,recipient_id uuid,notification_id uuid);
create table public.booking_messages(id bigint,read_at timestamptz,sender_id uuid,sender_role text);
create function public.visit_contact_end(uuid) returns timestamptz language sql as $$select now()+interval '1 day'$$;
create function public.booking_sms_allowed(uuid,uuid) returns boolean language sql as $$select auth.role()='service_role'$$;
create function public.preferred_confirmation_sms_sent(uuid) returns boolean language sql as $$select true$$;
create function public.visit_matching_notice_allowed(uuid,uuid) returns boolean language sql as $$select auth.role()='service_role'$$;
\ir ../migrations/20261022000100_notification_channels.sql
select set_config('test.uid','10000000-0000-4000-8000-000000000001',false),set_config('test.role','authenticated',false);
select public.snooze_web_push_prompt();
select public.test_assert((select prompt_after between now()+interval '13 days 23 hours' and now()+interval '14 days 1 hour' from public.web_push_preferences where user_id=auth.uid()),'Not now persists for 14 days');
select public.save_web_push_device('https://fcm.googleapis.com/fcm/send/new-device',repeat('a',22),'B'||repeat('a',86),'50000000-0000-4000-8000-000000000001','Computer browser',true);
select public.save_web_push_device('https://fcm.googleapis.com/fcm/send/phone',repeat('b',22),'B'||repeat('b',86),'50000000-0000-4000-8000-000000000002','Android phone',true);
select public.test_assert(jsonb_array_length(public.notification_settings('50000000-0000-4000-8000-000000000001')->'devices')=2,'safe device listing');
select public.save_notification_settings('50000000-0000-4000-8000-000000000001','[{"audience":"customer","kind":"messages","channel":"push","enabled":false},{"audience":"customer","kind":"messages","channel":"email","enabled":false},{"audience":"customer","kind":"booking","channel":"email","enabled":false},{"audience":"customer","kind":"payments","channel":"email","enabled":false}]');
select public.test_assert(not public.notification_channel_allowed(auth.uid(),'customer','messages','push','50000000-0000-4000-8000-000000000001'),'push type off on this device');
select public.test_assert(public.notification_channel_allowed(auth.uid(),'customer','messages','push','50000000-0000-4000-8000-000000000002'),'other device unchanged');
select public.test_assert(not public.notification_channel_allowed(auth.uid(),'customer','messages','email'),'optional emails off');
select public.test_assert(public.notification_channel_allowed(auth.uid(),'customer','booking','email',null,public.notification_essential_email('Booking cancelled')),'essential cancellation email always on');
select public.test_assert(public.notification_channel_allowed(auth.uid(),'customer','payments','email',null,public.notification_essential_email('Payment failed')),'payment problem email always on');
select public.test_assert(not public.notification_channel_allowed(auth.uid(),'customer','payments','email',null,public.notification_essential_email('Refund receipt')),'optional receipt honours toggle');
insert into public.notifications(user_id,title,href) values(auth.uid(),'Message from Demo','/account/visit/30000000-0000-4000-8000-000000000001');
select public.test_assert((select count(*)>0 from public.notifications where user_id=auth.uid() and title='Message from Demo'),'Updates never suppressed');
select public.remove_web_push_device('50000000-0000-4000-8000-000000000001');
select public.test_assert((select count(*)=1 from public.web_push_subscriptions where user_id=auth.uid()),'remove only one device');
do $$begin
 begin perform public.save_web_push_device('https://fcm.googleapis.com/fcm/send/new-device',repeat('a',22),'B'||repeat('a',86),'50000000-0000-4000-8000-000000000001','Browser',false); raise exception 'Removed device resurrected'; exception when raise_exception then if sqlerrm='Removed device resurrected' then raise; end if; end;
end$$;
select public.test_assert((select count(*)=1 from public.web_push_subscriptions where user_id=auth.uid()),'background cannot reverse removal');
select public.test_web_push_device('50000000-0000-4000-8000-000000000002');
do $$begin
 begin perform public.test_web_push_device('50000000-0000-4000-8000-000000000002');raise exception 'No throttle';exception when raise_exception then if sqlerrm='No throttle' then raise;end if;end;
end$$;
select set_config('test.role','service_role',false);
create temp table new_claim as select * from public.claim_web_push();
select public.test_assert((select public.web_push_delivery_allowed(id,claim_token) from new_claim where kind='test'),'own-device test allowed');
select public.finish_web_push(id,claim_token,'expired') from new_claim where kind='test';
select public.test_assert((select count(*)=0 from public.web_push_subscriptions where user_id=auth.uid()),'expired subscription automatically removed');
select public.test_assert(not has_table_privilege('authenticated','public.notification_channel_preferences','SELECT'),'other users preferences private');
select public.test_assert(not has_function_privilege('authenticated','public.notification_channel_allowed(uuid,text,text,text,uuid,boolean)','EXECUTE'),'cannot inspect another user preferences');
select public.test_assert(not has_function_privilege('authenticated','public.operational_email_allowed(text,text,text)','EXECUTE'),'email lookup service only');
select public.test_assert(not has_function_privilege('authenticated','public.web_push_delivery_allowed_before_channels(uuid,uuid)','EXECUTE'),'cannot bypass new delivery gate');
select public.test_assert(public.notification_essential_email('Annual DBS re-check') and public.notification_essential_email('Insurance expiry warning') and public.notification_essential_email('Your security code'),'all essential warning types forced');
select 'Notification channel contracts passed' as result;
