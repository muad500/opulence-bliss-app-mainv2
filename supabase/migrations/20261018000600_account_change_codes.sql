begin;

create table public.account_change_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  code_hash text not null,
  grant_hash text,
  channel text not null check (channel in ('email', 'sms')),
  attempts integer not null default 0,
  sent boolean not null default false,
  verified_at timestamptz,
  used_at timestamptz,
  expires_at timestamptz not null default now() + interval '10 minutes',
  created_at timestamptz not null default now(),
  sms_budget_month date,
  sms_cost_cap_pence integer not null default 0
);
create index account_change_user_time on public.account_change_challenges(user_id, created_at desc);
alter table public.account_change_challenges enable row level security;
revoke all on public.account_change_challenges from public, anon, authenticated;
grant all on public.account_change_challenges to service_role;

create function public.start_account_change(
  p_user uuid, p_session text, p_hash text, p_code text, p_channel text,
  p_sms_budget integer default 0, p_sms_cost integer default 0
) returns uuid language plpgsql security definer set search_path = public
as $function$
declare result uuid; spent integer; month_start date := date_trunc('month', now() at time zone 'Europe/London')::date;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;
  perform 1 from public.profiles where id = p_user and account_deleted_at is null for update;
  if not found then raise exception 'Account unavailable'; end if;
  if exists (select 1 from public.account_change_challenges where user_id = p_user and created_at > now() - interval '1 minute')
    or (select count(*) from public.account_change_challenges where user_id = p_user and created_at > now() - interval '1 hour') >= 5
  then raise exception 'Please wait before requesting another code'; end if;
  if p_channel = 'sms' then
    perform pg_advisory_xact_lock(hashtextextended('booking-sms-budget:' || month_start::text, 0));
    select coalesce(sum(sms_cost_cap_pence), 0) into spent from public.booking_notification_deliveries where sms_budget_month = month_start;
    select spent + coalesce(sum(sms_cost_cap_pence), 0) into spent from public.visit_matching_notices where sms_budget_month = month_start;
    select spent + coalesce(sum(sms_cost_cap_pence), 0) into spent from public.account_change_challenges where sms_budget_month = month_start;
    if p_sms_cost <= 0 or p_sms_budget <= 0 or spent + p_sms_cost > p_sms_budget then raise exception 'SMS budget unavailable'; end if;
  end if;
  insert into public.account_change_challenges(user_id, session_id, request_hash, code_hash, channel, sms_budget_month, sms_cost_cap_pence)
  values (p_user, p_session, p_hash, p_code, p_channel,
    case when p_channel = 'sms' then month_start end, case when p_channel = 'sms' then p_sms_cost else 0 end)
  returning id into result;
  return result;
end;
$function$;

create function public.verify_account_change(p_id uuid, p_user uuid, p_session text, p_code text, p_grant text)
returns boolean language plpgsql security definer set search_path = public
as $function$
declare challenge public.account_change_challenges;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;
  select * into challenge from public.account_change_challenges
    where id = p_id and user_id = p_user and session_id = p_session for update;
  if not found or not challenge.sent or challenge.expires_at <= now()
    or challenge.attempts >= 5 or challenge.verified_at is not null then return false; end if;
  update public.account_change_challenges set attempts = attempts + 1 where id = p_id;
  if challenge.code_hash <> p_code then return false; end if;
  update public.account_change_challenges set verified_at = now(), grant_hash = p_grant where id = p_id;
  return true;
end;
$function$;

create function public.consume_account_change(p_user uuid, p_session text, p_hash text, p_grant text)
returns boolean language plpgsql security definer set search_path = public
as $function$
declare result uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;
  update public.account_change_challenges set used_at = now()
  where user_id = p_user and session_id = p_session and request_hash = p_hash
    and grant_hash = p_grant and verified_at is not null and used_at is null and expires_at > now()
  returning id into result;
  return result is not null;
end;
$function$;

-- Direct browser writes must not bypass the server's verified account-edit flow.
create policy profile_changes_through_verified_server on public.profiles as restrictive
for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy details_changes_through_verified_server on public.account_profile_details as restrictive
for all to authenticated using (public.is_admin()) with check (public.is_admin());
-- Own details remain readable.
drop policy details_changes_through_verified_server on public.account_profile_details;
create policy details_update_through_verified_server on public.account_profile_details as restrictive
for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy details_insert_through_verified_server on public.account_profile_details as restrictive
for insert to authenticated with check (public.is_admin());

do $policies$
declare item text;
begin
  foreach item in array array['customer_addresses', 'provider_profile_settings', 'provider_onboarding_details'] loop
    execute format('create policy verified_server_updates on public.%I as restrictive for update to authenticated using (public.is_admin()) with check (public.is_admin())', item);
    execute format('create policy verified_server_inserts on public.%I as restrictive for insert to authenticated with check (public.is_admin())', item);
    execute format('create policy verified_server_deletes on public.%I as restrictive for delete to authenticated using (public.is_admin())', item);
  end loop;
end;
$policies$;

revoke all on function public.start_account_change(uuid,text,text,text,text,integer,integer),
 public.verify_account_change(uuid,uuid,text,text,text), public.consume_account_change(uuid,text,text,text)
 from public, anon, authenticated;
grant execute on function public.start_account_change(uuid,text,text,text,text,integer,integer),
 public.verify_account_change(uuid,uuid,text,text,text), public.consume_account_change(uuid,text,text,text)
 to service_role;

commit;
notify pgrst, 'reload schema';
