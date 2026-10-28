begin;

-- Interest is contact permission only, not Partner registration or marketing.
create table public.partner_interests (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(btrim(full_name)) between 2 and 160),
  email text not null unique
    check (email = lower(btrim(email)) and length(email) <= 254),
  phone text not null check (phone ~ '^\+44[0-9]{10}$'),
  description text not null check (description in (
    'Cleaner', 'Digital marketer', 'Stay-at-home mum/dad', 'Freelancer',
    'Looking to earn extra income', 'Other'
  )),
  created_at timestamptz not null default now(),
  consent_at timestamptz not null default now(),
  consent_wording text not null check (consent_wording =
    'I agree to be contacted about the partnership opportunity and have read the privacy notice.'),
  consent_ip inet,
  partner_registered_at timestamptz,
  partner_profile_id uuid references public.profiles(id) on delete set null,
  check (partner_profile_id is null or partner_registered_at is not null)
);
create index partner_interest_signup_order
  on public.partner_interests(created_at desc, id desc);
create table public.partner_interest_email_queue (
  id uuid primary key default gen_random_uuid(),
  interest_id uuid not null unique
    references public.partner_interests(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed', 'held')),
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  leased_until timestamptz,
  claim_token uuid,
  sent_at timestamptz,
  last_error text
);
create index partner_interest_email_pending
  on public.partner_interest_email_queue(next_attempt_at)
  where status in ('pending', 'processing');
create table public.partner_interest_rate_limits (
  key text not null check (key = 'global' or key ~ '^[a-f0-9]{64}$'),
  window_start timestamptz not null,
  requests integer not null,
  primary key (key, window_start)
);
create table public.partner_interest_export_audits (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id),
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  row_count integer not null default -1 check (row_count >= -1)
);

do $permissions$
declare
  item text;
begin
  foreach item in array array[
    'partner_interests',
    'partner_interest_email_queue',
    'partner_interest_rate_limits',
    'partner_interest_export_audits'
  ] loop
    execute format('alter table public.%I enable row level security', item);
    execute format(
      'revoke all on public.%I from public, anon, authenticated, service_role',
      item
    );
  end loop;
end;
$permissions$;
grant select on public.partner_interests,
  public.partner_interest_email_queue,
  public.partner_interest_export_audits
  to authenticated, service_role;
grant insert, update on public.partner_interest_export_audits to service_role;
create policy "Authenticator staff read Partner interest"
  on public.partner_interests for select to authenticated
  using (public.is_admin());
create policy "Authenticator staff read Partner confirmations"
  on public.partner_interest_email_queue for select to authenticated
  using (public.is_admin());
create policy "Authenticator staff read Partner exports"
  on public.partner_interest_export_audits for select to authenticated
  using (public.is_admin());

create function public.guard_partner_interest_evidence()
returns trigger language plpgsql set search_path = public as $function$
begin
  if tg_op = 'DELETE' then
    if public.retention_delete_authorised() then
      return old;
    end if;
    raise exception 'Authorised retention is required';
  end if;
  if new.full_name is distinct from old.full_name
    or new.email is distinct from old.email
    or new.phone is distinct from old.phone
    or new.description is distinct from old.description
    or new.created_at is distinct from old.created_at
    or new.consent_at is distinct from old.consent_at
    or new.consent_wording is distinct from old.consent_wording
    or new.consent_ip is distinct from old.consent_ip
    or (
      old.partner_registered_at is not null
      and new.partner_registered_at is distinct from old.partner_registered_at
    )
  then
    raise exception 'Partner interest evidence is immutable';
  end if;
  return new;
end;
$function$;
revoke all on function public.guard_partner_interest_evidence()
  from public, anon, authenticated, service_role;
create trigger partner_interest_evidence_immutable
  before update or delete on public.partner_interests
  for each row execute function public.guard_partner_interest_evidence();

create function public.guard_partner_interest_export_audit()
returns trigger language plpgsql set search_path = public as $function$
begin
  if tg_op = 'DELETE' or old.completed_at is not null then
    raise exception 'Export access records are immutable';
  end if;
  if new.actor_id is distinct from old.actor_id
    or new.requested_at is distinct from old.requested_at
    or new.id is distinct from old.id
    or new.completed_at is null
    or new.row_count < 0
  then
    raise exception 'Only export completion can be recorded';
  end if;
  return new;
end;
$function$;
revoke all on function public.guard_partner_interest_export_audit()
  from public, anon, authenticated, service_role;
create trigger partner_interest_export_immutable
  before update or delete on public.partner_interest_export_audits
  for each row execute function public.guard_partner_interest_export_audit();

create function public.register_partner_interest(
  p_name text,
  p_email text,
  p_phone text,
  p_description text,
  p_consent text,
  p_ip inet,
  p_rate_key text
)
returns jsonb language plpgsql security definer set search_path = public as $function$
declare
  interest uuid;
  count_ip integer;
  count_global integer;
  hour_start timestamptz := date_trunc('hour', now());
  minute_start timestamptz := date_trunc('minute', now());
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required';
  end if;
  if p_email is null
    or p_email <> lower(btrim(p_email))
    or length(p_email) > 254
    or p_email !~ '^[^[:space:]@]+@[^[:space:]@.]+(\.[^[:space:]@.]+)+$'
    or length(btrim(coalesce(p_name,''))) not between 2 and 160
    or p_phone !~ '^\+44[0-9]{10}$'
    or p_description not in (
      'Cleaner', 'Digital marketer', 'Stay-at-home mum/dad',
      'Freelancer', 'Looking to earn extra income', 'Other'
    )
    or p_consent is distinct from 'I agree to be contacted about the partnership opportunity and have read the privacy notice.'
    or p_rate_key !~ '^[a-f0-9]{64}$'
    or p_phone is null
    or p_description is null
    or p_rate_key is null
  then
    raise exception 'Invalid Partner interest';
  end if;
  -- Serialise the duplicate check and queue insertion. One email per interest.
  perform pg_advisory_xact_lock(
    hashtextextended('partner-interest/email/' || p_email, 0)
  );
  select id into interest from public.partner_interests where email = p_email;
  if found then
    return jsonb_build_object('duplicate', true);
  end if;
  -- Fixed order avoids deadlocks. No raw request IP enters the limiter.
  perform pg_advisory_xact_lock(
    hashtextextended('partner-interest/rate/global', 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended('partner-interest/rate/' || p_rate_key, 0)
  );
  select requests into count_ip
  from public.partner_interest_rate_limits
  where key = p_rate_key and window_start = hour_start;
  select requests into count_global
  from public.partner_interest_rate_limits
  where key = 'global' and window_start = minute_start;
  if coalesce(count_ip, 0) >= 10 or coalesce(count_global, 0) >= 100 then
    return jsonb_build_object('limited', true);
  end if;
  insert into public.partner_interest_rate_limits(key, window_start, requests)
  values (p_rate_key, hour_start, 1), ('global', minute_start, 1)
  on conflict (key, window_start) do update
    set requests = partner_interest_rate_limits.requests + 1;
  delete from public.partner_interest_rate_limits
  where window_start < now() - interval '1 day';
  insert into public.partner_interests(
    full_name, email, phone, description, consent_wording, consent_ip
  )
  values (btrim(p_name), p_email, p_phone, p_description, p_consent, p_ip)
  returning id into interest;
  insert into public.partner_interest_email_queue(interest_id)
  values (interest);
  return jsonb_build_object('id',interest,'duplicate',false);
end;
$function$;
revoke all on function public.register_partner_interest(
  text, text, text, text, text, inet, text
) from public, anon, authenticated;
grant execute on function public.register_partner_interest(
  text, text, text, text, text, inet, text
) to service_role;

create function public.claim_partner_interest_emails(
  p_limit integer default 2,
  p_interest uuid default null
)
returns table(id uuid, interest_id uuid, email text, claim_token uuid)
language plpgsql security definer set search_path = public as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required';
  end if;
  -- Resend idempotency lasts 24h. Stop before it expires, retaining failure for staff.
  update public.partner_interest_email_queue q
  set status = 'failed',
    claim_token = null,
    leased_until = null,
    last_error = 'Confirmation needs staff review'
  where q.status in ('pending', 'processing')
    and (q.attempts >= 12 or q.created_at < now() - interval '23 hours')
    and coalesce(q.leased_until, '-infinity') < now();
  return query
  with chosen as (
    select q.id
    from public.partner_interest_email_queue q
    where (p_interest is null or q.interest_id = p_interest)
      and (
        (q.status = 'pending' and q.next_attempt_at <= now())
        or (q.status = 'processing' and q.leased_until < now())
      )
      and q.attempts < 12
      and q.created_at >= now() - interval '23 hours'
    order by q.created_at, q.id
    limit greatest(0, least(coalesce(p_limit, 2), 4))
    for update skip locked
  ), claimed as (
    update public.partner_interest_email_queue q
    set status = 'processing',
      attempts = q.attempts + 1,
      claim_token = gen_random_uuid(),
      leased_until = now() + interval '2 minutes'
    from chosen
    where q.id = chosen.id
    returning q.*
  )
  select q.id, q.interest_id, i.email, q.claim_token
  from claimed q
  join public.partner_interests i on i.id = q.interest_id;
end;
$function$;
revoke all on function public.claim_partner_interest_emails(integer, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_partner_interest_emails(integer,uuid) to service_role;

create function public.finish_partner_interest_email(
  p_id uuid,
  p_token uuid,
  p_outcome text
)
returns void language plpgsql security definer set search_path = public as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required';
  end if;
  if p_outcome not in ('sent', 'retry', 'held') then
    raise exception 'Invalid confirmation outcome';
  end if;
  update public.partner_interest_email_queue set
    status = case p_outcome
      when 'sent' then 'sent'
      when 'held' then 'held'
      else case when attempts >= 12 then 'failed' else 'pending' end
    end,
    sent_at = case when p_outcome = 'sent' then now() end,
    next_attempt_at = case
      when p_outcome = 'retry' then
        now() + make_interval(
          secs => least(3600, 60 * (2 ^ least(attempts, 6))::integer)
        )
      else next_attempt_at
    end,
    last_error = case p_outcome
      when 'sent' then null
      when 'held' then 'Staging recipient is not authorised'
      else 'Email delivery could not be confirmed'
    end,
    claim_token = null,
    leased_until = null
  where id = p_id and claim_token = p_token and status = 'processing';
  if not found then
    raise exception 'Confirmation claim expired';
  end if;
end;
$function$;
revoke all on function public.finish_partner_interest_email(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.finish_partner_interest_email(uuid,uuid,text) to service_role;

commit;
notify pgrst, 'reload schema';
