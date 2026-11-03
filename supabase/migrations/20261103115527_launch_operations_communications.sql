begin;
create table public.launch_operation_emails (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  kind text not null check(kind in ('welcome','receipt','complaint_ack','complaint_reply','complaint_update','replacement')),
  user_id uuid references public.profiles(id),
  incident_id uuid references public.account_incidents(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete cascade,
  email text not null,
  context jsonb not null,
  payload jsonb,
  status text not null default 'pending' check(status in ('pending','processing','sent','review')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  claim_token uuid,
  leased_until timestamptz,
  first_attempt_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index launch_operation_emails_due on public.launch_operation_emails(next_attempt_at) where status in ('pending','processing');
alter table public.launch_operation_emails enable row level security;
revoke all on public.launch_operation_emails from public,anon,authenticated;
grant select,insert,update,delete on public.launch_operation_emails to service_role;

create table public.complaint_bank_holidays(day date primary key, title text not null);
alter table public.complaint_bank_holidays enable row level security;
revoke all on public.complaint_bank_holidays from public,anon,authenticated;
grant select on public.complaint_bank_holidays to service_role;
-- England and Wales, GOV.UK bank-holidays.json, retrieved 3 November 2026.
-- Refresh this calendar before 2029; no external calls happen during a report.
insert into public.complaint_bank_holidays(day,title) values
('2026-01-01','New Year'),('2026-04-03','Good Friday'),('2026-04-06','Easter Monday'),('2026-05-04','Early May'),('2026-05-25','Spring'),('2026-08-31','Summer'),('2026-12-25','Christmas'),('2026-12-28','Boxing Day substitute'),
('2027-01-01','New Year'),('2027-03-26','Good Friday'),('2027-03-29','Easter Monday'),('2027-05-03','Early May'),('2027-05-31','Spring'),('2027-08-30','Summer'),('2027-12-27','Christmas substitute'),('2027-12-28','Boxing Day substitute'),
('2028-01-03','New Year substitute'),('2028-04-14','Good Friday'),('2028-04-17','Easter Monday'),('2028-05-01','Early May'),('2028-05-29','Spring'),('2028-08-28','Summer'),('2028-12-25','Christmas'),('2028-12-26','Boxing Day');
create function public.complaint_ack_due(p_received timestamptz)
returns timestamptz language plpgsql stable security definer set search_path=public as $fn$
declare d date:=(p_received at time zone 'Europe/London')::date; n integer:=0;
begin
  while n<3 loop
    d:=d+1;
    if extract(isodow from d)<6 and not exists(select 1 from public.complaint_bank_holidays where day=d) then n:=n+1; end if;
  end loop;
  return (d+time '17:00') at time zone 'Europe/London';
end;
$fn$;
revoke all on function public.complaint_ack_due(timestamptz) from public,anon,authenticated;

alter table public.account_incidents
  add column complaint_reference text unique,
  add column complaint_kind text not null default 'standard' check(complaint_kind in ('standard','complex','data')),
  add column complainant_email text,
  add column handler_name text not null default 'The Opulence Bliss support team',
  add column acknowledgement_due_at timestamptz,
  add column acknowledgement_sent_at timestamptz,
  add column reply_due_at timestamptz,
  add column reply_sent_at timestamptz,
  add column complex_update_sent_at timestamptz;

-- Give old complaints a reference/deadline without pretending they were
-- acknowledged or automatically resending historical customer mail.
update public.account_incidents i set
  complaint_reference='OB-C-'||to_char(i.created_at at time zone 'Europe/London','YYYY')||'-'||upper(replace(i.id::text,'-','')),
  acknowledgement_due_at=public.complaint_ack_due(i.created_at),
  reply_due_at=i.created_at+make_interval(days=>case i.complaint_kind when 'data' then 30 when 'complex' then 28 else 14 end),
  complainant_email=(select email from public.profiles where id=i.reporter_id and role::text<>'admin')
where i.log_kind='complaint' and i.complaint_reference is null;

create function public.initialise_launch_complaint()
returns trigger language plpgsql security definer set search_path=public as $fn$
begin
  if new.log_kind<>'complaint' then return new; end if;
  new.complaint_reference:='OB-C-'||to_char(new.created_at at time zone 'Europe/London','YYYY')||'-'||upper(replace(new.id::text,'-',''));
  new.acknowledgement_due_at:=public.complaint_ack_due(new.created_at);
  new.reply_due_at:=new.created_at+make_interval(days=>case new.complaint_kind when 'data' then 30 when 'complex' then 28 else 14 end);
  new.complainant_email:=coalesce(nullif(btrim(new.complainant_email),''),(select email from public.profiles where id=new.reporter_id));
  return new;
end;
$fn$;
revoke all on function public.initialise_launch_complaint() from public,anon,authenticated,service_role;
create trigger initialise_launch_complaint before insert on public.account_incidents
for each row execute function public.initialise_launch_complaint();

create function public.queue_launch_complaint_ack()
returns trigger language plpgsql security definer set search_path=public as $fn$
begin
  if new.log_kind='complaint' and new.complainant_email is not null then
    insert into public.launch_operation_emails(dedupe_key,kind,user_id,incident_id,email,context)
    values('complaint-ack:'||new.id,'complaint_ack',new.reporter_id,new.id,new.complainant_email,
      jsonb_build_object('reference',new.complaint_reference,'receivedAt',new.created_at,'handler',new.handler_name,'replyDueAt',new.reply_due_at));
  end if;
  return new;
end;
$fn$;
revoke all on function public.queue_launch_complaint_ack() from public,anon,authenticated,service_role;
create trigger queue_launch_complaint_ack after insert on public.account_incidents
for each row execute function public.queue_launch_complaint_ack();

-- A durable payment ledger fact is the source of each receipt: checkout success
-- pages are not reliable, and regular/extra-hour charges have no Checkout page.
create function public.queue_launch_payment_receipt()
returns trigger language plpgsql security definer set search_path=public as $fn$
declare b public.bookings; mail text;
begin
  if new.status<>'succeeded' or (tg_op='UPDATE' and old.status='succeeded')
    or new.stripe_payment_ref is null or new.gross_amount<=0 then return new; end if;
  select * into b from public.bookings where id=new.booking_id;
  if b.id is null then return new; end if;
  select email into mail from public.profiles where id=b.customer_id;
  if mail is null then return new; end if;
  insert into public.launch_operation_emails(dedupe_key,kind,user_id,booking_id,email,context)
  values('payment-receipt:'||new.id,'receipt',b.customer_id,b.id,mail,
    jsonb_build_object('reference',new.id,'bookingId',b.id,'amountPence',round(new.gross_amount*100),
      'paidAt',now(),'kind',coalesce(new.kind,'booking'),'scheduledAt',b.scheduled_at,
      'service',(select name from public.packages where id=b.package_id)))
  on conflict(dedupe_key) do nothing;
  return new;
end;
$fn$;
revoke all on function public.queue_launch_payment_receipt() from public,anon,authenticated,service_role;
create trigger queue_launch_payment_receipt after insert or update of status on public.payments
for each row execute function public.queue_launch_payment_receipt();

create function public.queue_professional_welcome()
returns trigger language plpgsql security definer set search_path=public as $fn$
declare docs jsonb; accepted timestamptz; p public.profiles;
begin
  select * into p from public.profiles where id=new.profile_id;
  select max(accepted_at) into accepted from public.account_legal_acceptances
    where user_id=new.profile_id and booking_id is null
      and document_slug in ('professional-partner-agreement','cleaner-terms','handyman-professional-terms');
  if accepted is null or p.email is null then return new; end if;
  select jsonb_agg(document) into docs from (
    select distinct on (document_slug) acceptance_evidence->'document' as document
    from public.account_legal_acceptances where user_id=new.profile_id and booking_id is null
      and accepted_at=accepted and acceptance_evidence->'document' is not null
    order by document_slug,id desc
  ) versions;
  if docs is null then return new; end if;
  insert into public.launch_operation_emails(dedupe_key,kind,user_id,email,context)
  values('professional-welcome:'||new.id,'welcome',p.id,p.email,
    jsonb_build_object('firstName',split_part(coalesce(nullif(btrim(p.full_name),''),'there'),' ',1),
      'acceptedAt',accepted,'documents',docs,'handyman',new.services @> array['handyman']::text[]))
  on conflict(dedupe_key) do nothing;
  return new;
end;
$fn$;
revoke all on function public.queue_professional_welcome() from public,anon,authenticated,service_role;
create trigger queue_professional_welcome after insert or update of services on public.providers
for each row execute function public.queue_professional_welcome();

create table public.booking_replacement_options (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  previous_provider_id uuid not null references public.providers(id),
  offered_at timestamptz not null default now(),
  source_event_id bigint not null references public.booking_events(id),
  cancelled_operation_id uuid references public.booking_visit_money_operations(id)
);
alter table public.booking_replacement_options enable row level security;
revoke all on public.booking_replacement_options from public,anon,authenticated;
grant all on public.booking_replacement_options to service_role;
grant select on public.booking_replacement_options to authenticated;
create policy "customer sees own replacement choice" on public.booking_replacement_options for select to authenticated
using(public.is_admin() or exists(select 1 from public.bookings b where b.id=booking_id and b.customer_id=auth.uid()));
-- Preserve the actual released assignee in the existing immutable event. This
-- also covers staff/system re-offers, not just a cleaner clicking withdraw.
do $release_metadata$
declare source text; marker text;
begin
  select replace(pg_get_functiondef('public._apply_booking_transition(uuid,text,uuid,text,text,jsonb)'::regprocedure),E'\r\n',E'\n') into source;
  marker:=$old$nullif(trim(coalesce(p_reason, '')), ''), coalesce(p_meta, '{}'::jsonb));$old$;
  if strpos(source,'v_leaving := v_booking.provider_id;')=0 or strpos(source,marker)=0 then
    raise exception 'Booking release event source changed; review before release'; end if;
  execute replace(source,marker,$new$nullif(trim(coalesce(p_reason, '')), ''), coalesce(p_meta, '{}'::jsonb)
    || case when p_to_status='offered' and p_actor_kind<>'customer' and v_leaving is not null
      then jsonb_build_object('released_provider',v_leaving) else '{}'::jsonb end);$new$);
end;
$release_metadata$;
create function public.queue_cleaner_replacement_option()
returns trigger language plpgsql security definer set search_path=public as $fn$
declare b public.bookings; provider uuid; mail text;
begin
  if new.actor_kind='customer' or new.from_status not in ('scheduled','needs_review') or new.to_status<>'offered' then return new; end if;
  select * into b from public.bookings where id=new.booking_id;
  provider:=(new.meta->>'released_provider')::uuid;
  if provider is null and new.actor_kind='provider' then select id into provider from public.providers where profile_id=new.actor_id; end if;
  if provider is null then return new; end if;
  insert into public.booking_replacement_options(booking_id,previous_provider_id,source_event_id)
  values(b.id,provider,new.id) on conflict(booking_id) do update
    set previous_provider_id=excluded.previous_provider_id,source_event_id=excluded.source_event_id,offered_at=now();
  insert into public.notifications(user_id,title,body,href)
  values(b.customer_id,'Your cleaner cannot attend','We are offering your visit to another cleaner. You can cancel this visit instead, at no charge. Open the visit to choose.','/account/visit/'||b.id);
  select email into mail from public.profiles where id=b.customer_id;
  if mail is not null then
    insert into public.launch_operation_emails(dedupe_key,kind,user_id,booking_id,email,context)
    values('cleaner-replacement:'||new.id,'replacement',b.customer_id,b.id,mail,
      jsonb_build_object('bookingId',b.id,'scheduledAt',b.scheduled_at)) on conflict do nothing;
  end if;
  return new;
end;
$fn$;
revoke all on function public.queue_cleaner_replacement_option() from public,anon,authenticated,service_role;
create trigger queue_cleaner_replacement_option after insert on public.booking_events
for each row execute function public.queue_cleaner_replacement_option();

create table public.booking_welfare_steps (
 id uuid primary key default gen_random_uuid(),
 booking_id uuid not null,
 scheduled_at timestamptz not null,
 action text not null check(action in ('cleaner_contacted','emergency_contacted','police_welfare_requested','resolved')),
 note text not null check(char_length(btrim(note)) between 10 and 2000),
 actor_id uuid not null references public.profiles(id),
 created_at timestamptz not null default clock_timestamp(),
 foreign key(booking_id,scheduled_at) references public.booking_checkin_safety_alerts(booking_id,scheduled_at),
 unique(booking_id,scheduled_at,action)
);
alter table public.booking_welfare_steps enable row level security;
revoke all on public.booking_welfare_steps from public,anon,authenticated;
grant select on public.booking_welfare_steps to authenticated;
grant all on public.booking_welfare_steps to service_role;
create policy "authenticator staff read welfare steps" on public.booking_welfare_steps for select to authenticated using(public.is_admin());
create function public.record_booking_welfare_step(p_booking uuid,p_scheduled timestamptz,p_action text,p_note text)
returns void language plpgsql security definer set search_path=public as $fn$
declare called timestamptz;
begin
  if not public.is_admin() then raise exception 'Authenticator staff access required' using errcode='insufficient_privilege'; end if;
  perform 1 from public.booking_checkin_safety_alerts where booking_id=p_booking and scheduled_at=p_scheduled for update;
  if not found then raise exception 'Safety alert not found'; end if;
  if exists(select 1 from public.booking_welfare_steps where booking_id=p_booking and scheduled_at=p_scheduled and action='resolved') then raise exception 'This safety alert is resolved'; end if;
  if p_action='emergency_contacted' then
    select created_at into called from public.booking_welfare_steps where booking_id=p_booking and scheduled_at=p_scheduled and action='cleaner_contacted';
    if called is null or now()<called+interval '15 minutes' then raise exception 'Phone and message the cleaner first; if there is no answer after 15 minutes, call the emergency contact'; end if;
  elsif p_action='police_welfare_requested' and not exists(select 1 from public.booking_welfare_steps where booking_id=p_booking and scheduled_at=p_scheduled and action='emergency_contacted') then
    raise exception 'Contact the emergency contact first. In immediate danger call 999 without waiting';
  end if;
  insert into public.booking_welfare_steps(booking_id,scheduled_at,action,note,actor_id)
  values(p_booking,p_scheduled,p_action,btrim(p_note),auth.uid());
end;
$fn$;
revoke all on function public.record_booking_welfare_step(uuid,timestamptz,text,text) from public,anon,authenticated,service_role;
grant execute on function public.record_booking_welfare_step(uuid,timestamptz,text,text) to authenticated;

create table public.launch_operations_reminders (
 dedupe_key text primary key, created_at timestamptz not null default now()
);
alter table public.launch_operations_reminders enable row level security;
revoke all on public.launch_operations_reminders from public,anon,authenticated;
grant all on public.launch_operations_reminders to service_role;
create function public.queue_launch_operations_reminders()
returns void language plpgsql security definer set search_path=public as $fn$
declare item record; key text;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service role required'; end if;
  -- The existing 30-minute alert remains installed separately. This function
  -- only follows its real alerts and never marks a phone call as completed.
  delete from public.launch_operations_reminders where created_at<now()-interval '30 days';
  for item in select i.id,i.complaint_reference from public.account_incidents i
    where i.log_kind='complaint' and i.status<>'resolved'
    and ((i.acknowledgement_sent_at is null and i.acknowledgement_due_at<=now()+interval '1 day')
      or (i.reply_sent_at is null and i.reply_due_at<=now()+interval '1 day')
      or (i.complaint_kind='complex' and i.complex_update_sent_at is null and i.created_at+interval '14 days'<=now()+interval '1 day'))
    order by i.created_at limit 100
  loop
    key:='complaint:'||item.id||':'||(now() at time zone 'Europe/London')::date;
    insert into public.launch_operations_reminders(dedupe_key) values(key) on conflict do nothing;
    if found then
      insert into public.notifications(user_id,title,body,href)
      select id,'Complaint response due','Review complaint '||item.complaint_reference||': an acknowledgement, update or reply is due.','/admin/incidents?complaint='||item.id
      from public.profiles where role::text='admin' and account_deleted_at is null;
    end if;
  end loop;
  for item in select a.booking_id,a.scheduled_at,coalesce(max(s.created_at) filter(where s.action='emergency_contacted'),max(s.created_at) filter(where s.action='cleaner_contacted')) as contacted
    from public.booking_checkin_safety_alerts a left join public.booking_welfare_steps s using(booking_id,scheduled_at)
    where a.scheduled_at>now()-interval '24 hours'
      and (now() at time zone 'Europe/London')::time between time '07:00' and time '20:00'
      and exists(select 1 from public.bookings b where b.id=a.booking_id and b.scheduled_at=a.scheduled_at and b.status::text='scheduled')
      and not exists(select 1 from public.check_ins c where c.booking_id=a.booking_id and c.arrived_at is not null)
      and not exists(select 1 from public.booking_welfare_steps done where done.booking_id=a.booking_id and done.scheduled_at=a.scheduled_at and done.action='resolved')
    group by a.booking_id,a.scheduled_at having coalesce(max(s.created_at),min(a.alerted_at))<=now()-interval '15 minutes'
  loop
    key:='welfare:'||item.booking_id||':'||item.scheduled_at||':'||floor(extract(epoch from now())/900)::text;
    insert into public.launch_operations_reminders(dedupe_key) values(key) on conflict do nothing;
    if found then
      insert into public.notifications(user_id,title,body,href)
      select id,'Welfare follow-up due','A missed check-in needs human follow-up. Phone the cleaner, then the emergency contact after 15 minutes without an answer; request a police welfare check if still concerned.','/admin/welfare'
      from public.profiles where role::text='admin' and account_deleted_at is null;
    end if;
  end loop;
end;
$fn$;
revoke all on function public.queue_launch_operations_reminders() from public,anon,authenticated;
grant execute on function public.queue_launch_operations_reminders() to service_role;

create function public.claim_launch_operation_emails()
returns setof public.launch_operation_emails language plpgsql security definer set search_path=public as $fn$
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service role required'; end if;
  update public.launch_operation_emails set status='review',claim_token=null,leased_until=null
  where status in ('pending','processing') and (leased_until is null or leased_until<now())
    and (attempts>=8 or first_attempt_at<now()-interval '23 hours');
  return query update public.launch_operation_emails e set status='processing',attempts=e.attempts+1,
    claim_token=gen_random_uuid(),leased_until=now()+interval '2 minutes',first_attempt_at=coalesce(e.first_attempt_at,now())
  where e.id in(select id from public.launch_operation_emails where status in ('pending','processing')
    and next_attempt_at<=now() and (leased_until is null or leased_until<now()) order by created_at for update skip locked limit 3)
  returning e.*;
end;
$fn$;
create function public.store_launch_operation_payload(p_id uuid,p_token uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare result jsonb;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service role required'; end if;
  update public.launch_operation_emails set payload=coalesce(payload,p_payload)
  where id=p_id and claim_token=p_token and status='processing' and leased_until>now() returning payload into result;
  return result;
end;
$fn$;
create function public.finish_launch_operation_email(p_id uuid,p_token uuid,p_ok boolean)
returns boolean language plpgsql security definer set search_path=public as $fn$
declare e public.launch_operation_emails;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service role required'; end if;
  update public.launch_operation_emails set status=case when p_ok then 'sent' when attempts>=8 then 'review' else 'pending' end,
    sent_at=case when p_ok then now() end,next_attempt_at=now()+interval '5 minutes',claim_token=null,leased_until=null
    where id=p_id and claim_token=p_token and status='processing' returning * into e;
  if not found then return false; end if;
  if p_ok and e.incident_id is not null then
    update public.account_incidents set acknowledgement_sent_at=case when e.kind='complaint_ack' then now() else acknowledgement_sent_at end,
      reply_sent_at=case when e.kind='complaint_reply' then now() else reply_sent_at end,
      complex_update_sent_at=case when e.kind='complaint_update' then now() else complex_update_sent_at end where id=e.incident_id;
  end if;
  return true;
end;
$fn$;
revoke all on function public.claim_launch_operation_emails(),public.store_launch_operation_payload(uuid,uuid,jsonb),public.finish_launch_operation_email(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.claim_launch_operation_emails(),public.store_launch_operation_payload(uuid,uuid,jsonb),public.finish_launch_operation_email(uuid,uuid,boolean) to service_role;

create function public.prepare_complaint_response(p_incident uuid,p_kind text,p_context jsonb)
returns void language plpgsql security definer set search_path=public as $fn$
declare i public.account_incidents; body jsonb; due timestamptz;
begin
  if not public.is_admin() then raise exception 'Authenticator staff access required' using errcode='insufficient_privilege'; end if;
  select * into strict i from public.account_incidents where id=p_incident and log_kind='complaint' for update;
  if i.complainant_email is null or i.complaint_reference is null then raise exception 'Add the complainant contact and reference before sending'; end if;
  if p_kind='ack' then
    if i.acknowledgement_sent_at is not null then raise exception 'The acknowledgement has already been sent'; end if;
    body:=jsonb_build_object('reference',i.complaint_reference,'receivedAt',i.created_at,'handler',i.handler_name,'replyDueAt',i.reply_due_at);
  elsif p_kind='reply' then
    if i.reply_sent_at is not null then raise exception 'The full reply has already been sent'; end if;
    if exists(select 1 from unnest(array['checked','findings','action']) key
      where char_length(btrim(coalesce(p_context->>key,''))) not between 10 and 2000) then raise exception 'Explain what was checked, the findings and the action'; end if;
    body:=p_context||jsonb_build_object('reference',i.complaint_reference);
  elsif p_kind='complex' then
    if i.complaint_kind='data' then raise exception 'Data complaints retain their 30-day deadline'; end if;
    if char_length(btrim(coalesce(p_context->>'reason',''))) not between 10 and 2000 then raise exception 'Explain why this complaint needs more time'; end if;
    due:=i.created_at+interval '28 days';
    update public.account_incidents set complaint_kind='complex',reply_due_at=due,
      reviewed_by=auth.uid(),reviewed_at=now(),resolution_note=p_context->>'reason',status='in_review' where id=i.id;
    body:=jsonb_build_object('reference',i.complaint_reference,'reason',p_context->>'reason','replyDueAt',due);
  else raise exception 'Choose an acknowledgement, reply or complex-case update'; end if;
  insert into public.launch_operation_emails(dedupe_key,kind,user_id,incident_id,email,context)
  values('complaint-'||p_kind||':'||i.id,case when p_kind='ack' then 'complaint_ack' when p_kind='reply' then 'complaint_reply' else 'complaint_update' end,
    i.reporter_id,i.id,i.complainant_email,body) on conflict(dedupe_key) do nothing;
  update public.account_incidents set reviewed_by=auth.uid(),reviewed_at=now(),status='in_review',
    resolution_note=case when p_kind='reply' then 'Reply queued: '||(p_context->>'action') else resolution_note end where id=i.id;
end;
$fn$;
revoke all on function public.prepare_complaint_response(uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.prepare_complaint_response(uuid,text,jsonb) to authenticated;
commit;
