begin;

alter table public.booking_checkout_time_choices add column booking_preferences jsonb not null default '{}'::jsonb;
alter table public.bookings add column how_heard text,
  add column confirmation_channel text not null default 'email' check (confirmation_channel in ('email', 'sms')),
  add column rooms_to_clean text,
  add column access_instructions text;

create function public.copy_checkout_booking_preferences()
returns trigger language plpgsql security definer set search_path = public
as $function$
declare preferences jsonb;
begin
  select booking_preferences into preferences from public.booking_checkout_time_choices
  where checkout_session_id = new.checkout_session_id and customer_id = new.customer_id;
  if preferences is not null then
    new.how_heard := nullif(preferences ->> 'howHeard', '');
    new.confirmation_channel := coalesce(preferences ->> 'confirmationChannel', 'email');
    new.rooms_to_clean := nullif(preferences ->> 'roomsToClean', '');
    new.access_instructions := nullif(preferences ->> 'accessInstructions', '');
  end if;
  return new;
end;
$function$;
create trigger a_copy_checkout_booking_preferences before insert on public.bookings
for each row execute function public.copy_checkout_booking_preferences();

-- Redact newly added access data from the safe historical projection too.
create or replace function public.worker_visible_bookings()
returns setof public.bookings language plpgsql stable security definer set search_path = public
as $function$
declare b public.bookings; payload jsonb;
begin
  if auth.uid() is null or not public.account_is_active() then return; end if;
  for b in select * from public.bookings x where x.provider_id = public.current_provider_id() or exists (
    select 1 from public.booking_offers o where o.booking_id = x.id
      and o.provider_id = public.current_provider_id() and o.status = 'open' and x.status::text = 'offered'
  ) loop
    payload := to_jsonb(b) || jsonb_build_object('customer_email', null, 'how_heard', null);
    if not public.worker_address_visible(b.id) then
      payload := payload || jsonb_build_object('address', null, 'household_notes', null,
        'access_instructions', null, 'rooms_to_clean', null,
        'cleaning_extras', coalesce(b.cleaning_extras, '{}'::jsonb) - 'notes');
    else
      payload := payload || jsonb_build_object('household_notes',
        regexp_replace(coalesce(b.household_notes, ''), '(\+44|0)[0-9 ()-]{9,20}', '[Use in-app messages]', 'g'),
        'access_instructions', regexp_replace(coalesce(b.access_instructions, ''), '(\+44|0)[0-9 ()-]{9,20}', '[Use in-app messages]', 'g'));
    end if;
    return next jsonb_populate_record(null::public.bookings, payload);
  end loop;
end;
$function$;

create or replace function public.queue_booking_sms_copy()
returns trigger language plpgsql security definer set search_path = public
as $function$
begin
  if new.channel = 'email' and new.kind in ('received','confirmed','reminder_24h','reminder_90m') and exists (
    select 1 from public.bookings b where b.id = new.booking_id and b.customer_id = new.user_id
    and (b.confirmation_channel = 'sms' or exists (
      select 1 from public.account_profile_details where user_id = new.user_id and contact_sms
    ))
  ) then
    insert into public.booking_notification_deliveries(booking_id,user_id,event_key,kind,channel,title,body,href,due_at,expires_at)
    values(new.booking_id,new.user_id,new.event_key,new.kind,'sms',new.title,new.body,new.href,new.due_at,new.expires_at)
    on conflict(booking_id,user_id,event_key,channel) do nothing;
  end if;
  return new;
end;
$function$;

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
 update public.booking_notification_deliveries d set status='cancelled',claim_token=null where d.channel='sms' and d.status='pending' and(d.expires_at<=now() or not exists(select 1 from public.bookings b left join public.account_profile_details s on s.user_id=d.user_id where b.id=d.booking_id and b.status::text in('offered','scheduled') and not exists(select 1 from public.regular_booking_series rs where rs.id=b.regular_series_id and rs.billing_paused) and (b.confirmation_channel='sms' or coalesce(s.contact_sms,false)) and(d.kind='received' or (b.status::text='scheduled' and (d.kind='confirmed' or coalesce(s.notify_bookings,true))))));
 select coalesce(sum(cost), 0) into spent from (
   select sms_cost_cap_pence as cost from public.booking_notification_deliveries where sms_budget_month = month
   union all select sms_cost_cap_pence from public.visit_matching_notices where sms_budget_month = month
   union all select sms_cost_cap_pence from public.account_change_challenges where sms_budget_month = month
 ) combined;
 for item in select d.id,d.booking_id,d.kind,p.phone,b.scheduled_at from public.booking_notification_deliveries d join public.profiles p on p.id=d.user_id join public.bookings b on b.id=d.booking_id where d.channel='sms' and d.status='pending' and d.due_at<=now() and d.expires_at>now() and p.phone~'^\+44[0-9]{10}$' order by d.due_at,d.id limit 5 for update of d skip locked loop
  if spent+p_cost_cap_pence>p_budget_pence then exit; end if;
  token:=gen_random_uuid();
  update public.booking_notification_deliveries d set status='processing',claimed_at=now(),claim_token=token,attempts=d.attempts+1,sms_budget_month=month,sms_cost_cap_pence=p_cost_cap_pence where d.id=item.id;
  spent:=spent+p_cost_cap_pence;claimed:=claimed+1;
  id:=item.id;claim_token:=token;phone:=item.phone;kind:=item.kind;booking_id:=item.booking_id;scheduled_at:=item.scheduled_at;return next;
 end loop;
end $fn$;

create or replace function public.claim_visit_matching_notices(
  p_email_enabled boolean, p_sms_enabled boolean default false,
  p_budget_pence integer default 0, p_cost_pence integer default 0
)
returns table (
  id uuid, claim_token uuid, channel text, recipient text,
  title text, body text, href text, kind text, booking_id uuid, scheduled_at timestamptz
)
language plpgsql security definer set search_path = public
as $function$
declare
  item record;
  v_token uuid;
  v_month date := date_trunc('month', now() at time zone 'Europe/London')::date;
  v_spent bigint := 0;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  if p_sms_enabled then
    if p_budget_pence <= 0 or p_budget_pence > 1000000
      or p_cost_pence <= 0 or p_cost_pence > p_budget_pence
    then raise exception 'SMS budget required'; end if;
    perform pg_advisory_xact_lock(hashtextextended('booking-sms-budget:' || v_month::text, 0));
    select coalesce(sum(cost), 0) into v_spent from (
      select sms_cost_cap_pence as cost from public.booking_notification_deliveries where sms_budget_month = v_month
      union all select sms_cost_cap_pence from public.visit_matching_notices where sms_budget_month = v_month
      union all select sms_cost_cap_pence from public.account_change_challenges where sms_budget_month = v_month
    ) spent;
  end if;
  update public.visit_matching_notices notice
  set status = 'failed', last_error = 'SMS submission uncertain; manual review required.', claim_token = null
  where notice.channel = 'sms' and notice.status = 'processing'
    and notice.claimed_at < now() - interval '10 minutes';
  update public.visit_matching_notices notice
  set status = 'failed', last_error = 'Old email submission needs provider reconciliation.', claim_token = null
  where notice.channel = 'email' and notice.status in ('pending', 'processing')
    and notice.attempts > 0 and notice.claimed_at < now() - interval '23 hours';
  update public.visit_matching_notices notice
  set status = 'cancelled', claim_token = null
  where notice.status in ('pending', 'processing') and (
    notice.expires_at <= now() or (notice.kind in ('admin_48h', 'customer_24h') and not exists (
      select 1 from public.bookings booking
      left join public.regular_booking_series series on series.id = booking.regular_series_id
      where booking.id = notice.booking_id and booking.status::text = 'offered'
        and booking.provider_id is null and booking.scheduled_at > now() + interval '2 hours'
        and not coalesce(series.billing_paused, false)
        and notice.series_generation = coalesce(series.pause_generation, 0)
    ))
  );
  for item in
    select notice.*, profile.email, profile.phone, booking.scheduled_at
    from public.visit_matching_notices notice
    join public.profiles profile on profile.id = notice.user_id
    join public.bookings booking on booking.id = notice.booking_id
    left join public.account_profile_details preferences on preferences.user_id = notice.user_id
    where notice.attempts < 8 and notice.next_attempt_at <= now()
      and (notice.status = 'pending' or (notice.channel = 'email'
        and notice.status = 'processing' and notice.claimed_at < now() - interval '5 minutes'))
      and ((notice.channel = 'email' and p_email_enabled)
        or (notice.channel = 'sms' and p_sms_enabled and coalesce(preferences.contact_sms, false)
          and profile.phone ~ '^\+44[0-9]{10}$'))
    order by notice.created_at, notice.id limit 20 for update of notice skip locked
  loop
    if item.channel = 'sms' then
      if v_spent + p_cost_pence > p_budget_pence then continue; end if;
      v_spent := v_spent + p_cost_pence;
    end if;
    v_token := gen_random_uuid();
    update public.visit_matching_notices notice
    set status = 'processing', claimed_at = now(), claim_token = v_token,
      attempts = attempts + 1,
      sms_budget_month = case when item.channel = 'sms' then v_month else null end,
      sms_cost_cap_pence = case when item.channel = 'sms' then p_cost_pence else null end
    where notice.id = item.id;
    id := item.id; claim_token := v_token; channel := item.channel;
    recipient := case when item.channel = 'email' then item.email else item.phone end;
    title := item.title; body := item.body; href := item.href; kind := item.kind;
    booking_id := item.booking_id; scheduled_at := item.scheduled_at;
    return next;
  end loop;
end;
$function$;

create or replace function public.booking_sms_allowed(p_id uuid,p_token uuid)
returns boolean language sql stable security definer set search_path=public as $fn$
 select coalesce((select d.status='processing' and d.claim_token=p_token and d.expires_at>now() and b.status::text in('offered','scheduled') and not exists(select 1 from public.regular_booking_series rs where rs.id=b.regular_series_id and rs.billing_paused) and (b.confirmation_channel='sms' or coalesce(s.contact_sms,false)) and(d.kind='received' or (b.status::text='scheduled' and (d.kind='confirmed' or coalesce(s.notify_bookings,true))))
  from public.booking_notification_deliveries d join public.bookings b on b.id=d.booking_id left join public.account_profile_details s on s.user_id=d.user_id where d.id=p_id and d.channel='sms'),false) and auth.role()='service_role';
$fn$;

create function public.preferred_confirmation_sms_sent(p_email_id uuid)
returns boolean language sql stable security definer set search_path=public as $function$
  select auth.role() = 'service_role' and exists (
    select 1 from public.booking_notification_deliveries e
    join public.bookings b on b.id=e.booking_id
    join public.booking_notification_deliveries s on s.booking_id=e.booking_id and s.user_id=e.user_id and s.event_key=e.event_key
    where e.id=p_email_id and b.confirmation_channel='sms' and s.channel='sms' and s.status='sent'
      and s.sms_provider_ref is not null and e.kind in('received','confirmed','reminder_24h','reminder_90m')
  );
$function$;
revoke all on function public.preferred_confirmation_sms_sent(uuid) from public,anon,authenticated;
grant execute on function public.preferred_confirmation_sms_sent(uuid) to service_role;

-- Only the business contact address changes; held legal wording and versions stay unchanged.
update public.faqs set answer=replace(answer,'opulencebliss@gmail.com','hello@opulencebliss.com')
where answer like '%opulencebliss@gmail.com%';
update public.legal_documents set content_html=replace(content_html,'opulencebliss@gmail.com','hello@opulencebliss.com')
where content_html like '%opulencebliss@gmail.com%';
revoke all on function public.copy_checkout_booking_preferences() from public,anon,authenticated,service_role;
commit;
notify pgrst, 'reload schema';
