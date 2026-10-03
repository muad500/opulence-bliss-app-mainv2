begin;
alter table public.booking_notification_deliveries drop constraint booking_notification_deliveries_channel_check;
alter table public.booking_notification_deliveries add constraint booking_notification_deliveries_channel_check check(channel in('email','in_app','sms'));
alter table public.booking_notification_deliveries add column sms_provider_ref text,add column sms_cost_cap_pence integer,add column sms_budget_month date;

create or replace function public.queue_booking_sms_copy()
returns trigger language plpgsql security definer set search_path=public as $fn$
begin
 if new.channel='email' and new.kind in('received','confirmed','reminder_24h','reminder_90m') and exists(select 1 from public.account_profile_details where user_id=new.user_id and contact_sms) then
  insert into public.booking_notification_deliveries(booking_id,user_id,event_key,kind,channel,title,body,href,due_at,expires_at)
  values(new.booking_id,new.user_id,new.event_key,new.kind,'sms',new.title,new.body,new.href,new.due_at,new.expires_at) on conflict(booking_id,user_id,event_key,channel) do nothing;
 end if;
 return new;
end $fn$;
create trigger queue_booking_sms_copy after insert on public.booking_notification_deliveries for each row execute function public.queue_booking_sms_copy();
revoke all on function public.queue_booking_sms_copy() from public,anon,authenticated;

create or replace function public.booking_sms_allowed(p_id uuid,p_token uuid)
returns boolean language sql stable security definer set search_path=public as $fn$
 select coalesce((select d.status='processing' and d.claim_token=p_token and d.expires_at>now() and b.status::text in('offered','scheduled') and coalesce(s.contact_sms,false) and(d.kind='received' or (b.status::text='scheduled' and (d.kind='confirmed' or coalesce(s.notify_bookings,true))))
  from public.booking_notification_deliveries d join public.bookings b on b.id=d.booking_id left join public.account_profile_details s on s.user_id=d.user_id where d.id=p_id and d.channel='sms'),false) and auth.role()='service_role';
$fn$;
revoke all on function public.booking_sms_allowed(uuid,uuid) from public,anon,authenticated;
grant execute on function public.booking_sms_allowed(uuid,uuid) to service_role;

create or replace function public.claim_booking_sms(p_budget_pence integer,p_cost_cap_pence integer)
returns table(id uuid,claim_token uuid,phone text,kind text,booking_id uuid,scheduled_at timestamptz)
language plpgsql security definer set search_path=public as $fn$
declare item record; spent bigint; month date:=date_trunc('month',now() at time zone 'Europe/London')::date; token uuid; claimed integer:=0;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
 if p_budget_pence<=0 or p_budget_pence>1000000 or p_cost_cap_pence<=0 or p_cost_cap_pence>p_budget_pence then raise exception 'SMS budget required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('booking-sms-budget:'||month::text,0));
 -- No automatic retries after a lease expires: provider acceptance is unknown.
 update public.booking_notification_deliveries d set status='failed',last_error='SMS outcome uncertain; manual provider review required.',claim_token=null where d.channel='sms' and d.status='processing' and d.claimed_at<now()-interval '10 minutes';
 update public.booking_notification_deliveries d set status='cancelled',claim_token=null where d.channel='sms' and d.status='pending' and(d.expires_at<=now() or not exists(select 1 from public.bookings b join public.account_profile_details s on s.user_id=d.user_id where b.id=d.booking_id and b.status::text in('offered','scheduled') and s.contact_sms and(d.kind='received' or (b.status::text='scheduled' and (d.kind='confirmed' or s.notify_bookings)))));
 select coalesce(sum(d.sms_cost_cap_pence),0) into spent from public.booking_notification_deliveries d where d.sms_budget_month=month;
 for item in select d.id,d.booking_id,d.kind,p.phone,b.scheduled_at from public.booking_notification_deliveries d join public.profiles p on p.id=d.user_id join public.bookings b on b.id=d.booking_id where d.channel='sms' and d.status='pending' and d.due_at<=now() and d.expires_at>now() and p.phone~'^\+44[0-9]{10}$' order by d.due_at,d.id limit 5 for update of d skip locked loop
  if spent+p_cost_cap_pence>p_budget_pence then exit; end if;
  token:=gen_random_uuid();
  update public.booking_notification_deliveries d set status='processing',claimed_at=now(),claim_token=token,attempts=d.attempts+1,sms_budget_month=month,sms_cost_cap_pence=p_cost_cap_pence where d.id=item.id;
  spent:=spent+p_cost_cap_pence;claimed:=claimed+1;
  id:=item.id;claim_token:=token;phone:=item.phone;kind:=item.kind;booking_id:=item.booking_id;scheduled_at:=item.scheduled_at;return next;
 end loop;
end $fn$;
revoke all on function public.claim_booking_sms(integer,integer) from public,anon,authenticated;
grant execute on function public.claim_booking_sms(integer,integer) to service_role;

create or replace function public.finish_booking_sms(p_id uuid,p_token uuid,p_sid text,p_error text)
returns void language plpgsql security definer set search_path=public as $fn$
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
 update public.booking_notification_deliveries d set status=case when p_sid is not null then 'sent' else 'failed' end,sms_provider_ref=p_sid,sent_at=case when p_sid is not null then now() else null end,claim_token=null,last_error=left(p_error,300) where d.id=p_id and d.claim_token=p_token and d.status='processing' and d.channel='sms';
end $fn$;
revoke all on function public.finish_booking_sms(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.finish_booking_sms(uuid,uuid,text,text) to service_role;
commit;
