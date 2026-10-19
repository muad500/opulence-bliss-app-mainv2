begin;

-- Only notification/message references are stored here, never duplicate message text.
create table public.chat_email_threads (
  booking_id uuid not null references public.bookings(id),
  recipient_id uuid not null references public.profiles(id),
  next_email_at timestamptz,
  primary key (booking_id, recipient_id)
);
create table public.chat_message_emails (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null,
  recipient_id uuid not null,
  message_id bigint not null unique references public.booking_messages(id),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'cancelled', 'failed')),
  attempts integer not null default 0,
  claim_token uuid,
  leased_until timestamptz,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  foreign key (booking_id, recipient_id)
    references public.chat_email_threads(booking_id, recipient_id)
);
create unique index chat_email_one_pending_per_recipient
  on public.chat_message_emails(booking_id, recipient_id)
  where status in ('pending', 'processing');
alter table public.chat_email_threads enable row level security;
alter table public.chat_message_emails enable row level security;
revoke all on public.chat_email_threads, public.chat_message_emails
  from public, anon, authenticated;
grant select, insert, update, delete on public.chat_email_threads, public.chat_message_emails
  to service_role;

create function public.chat_message_email_eligible(p_id uuid)
returns boolean
language sql stable security definer set search_path = public, auth
as $function$
  select exists (
    select 1 from public.chat_message_emails e
    join public.booking_messages m on m.id = e.message_id
    join public.bookings b on b.id = e.booking_id
    join public.providers p on p.id = b.provider_id
    join public.profiles recipient on recipient.id = e.recipient_id
    join public.profiles sender on sender.id = m.sender_id
    join auth.users u on u.id = recipient.id
    join public.notifications n on n.id = e.notification_id
    left join public.account_profile_details c on c.user_id = recipient.id
    left join public.provider_profile_settings w on w.provider_id = p.id
    where e.id = p_id and m.read_at is null and n.read = false
      and recipient.account_deleted_at is null and sender.account_deleted_at is null
      and u.deleted_at is null and coalesce(u.banned_until, now()) <= now()
      and nullif(u.email, '') is not null
      and b.status::text in ('scheduled', 'in_progress', 'completed', 'needs_review')
      and now() < public.visit_contact_end(b.id) + interval '24 hours'
      and (
        (m.sender_role = 'provider' and m.sender_id = p.profile_id
          and recipient.id = b.customer_id and coalesce(c.notify_messages, true)
          and coalesce(c.contact_email, true))
        or (m.sender_role = 'customer' and m.sender_id = b.customer_id
          and recipient.id = p.profile_id and coalesce(w.notify_messages, true))
      )
  );
$function$;
revoke all on function public.chat_message_email_eligible(uuid)
  from public, anon, authenticated;
grant execute on function public.chat_message_email_eligible(uuid) to service_role;

create function public.queue_unread_chat_email()
returns trigger
language plpgsql security definer set search_path = public
as $function$
declare
  message public.booking_messages;
  booking uuid;
  cooldown timestamptz;
begin
  if new.title not like 'Message from %' or new.read
    or coalesce(new.href, '') !~ '^/(account/visit|worker/job)/[0-9a-f-]{36}$' then
    return new;
  end if;
  booking := substring(new.href from '[0-9a-f-]{36}$')::uuid;
  -- Resolve the actual message and its participants, never trust notification text.
  select m.* into message from public.booking_messages m
  join public.bookings b on b.id = m.booking_id
  join public.providers p on p.id = b.provider_id
  where m.booking_id = booking and m.created_at = new.created_at
    and left(m.body, 140) = new.body
    and ((m.sender_role = 'customer' and m.sender_id = b.customer_id
      and new.user_id = p.profile_id and new.href = '/worker/job/' || booking::text)
      or (m.sender_role = 'provider' and m.sender_id = p.profile_id
      and new.user_id = b.customer_id and new.href = '/account/visit/' || booking::text))
  order by m.id desc limit 1;
  if not found then return new; end if;

  perform pg_advisory_xact_lock(hashtextextended('chat-email:' || booking::text || ':' || new.user_id::text, 0));
  insert into public.chat_email_threads(booking_id, recipient_id)
    values (booking, new.user_id) on conflict do nothing;
  select next_email_at into cooldown from public.chat_email_threads
    where booking_id = booking and recipient_id = new.user_id for update;
  if cooldown > now() or exists (
    select 1 from public.notifications n
    where n.id <> new.id and n.user_id = new.user_id and n.href = new.href
      and n.read = false and n.title like 'Message from %'
  ) then return new; end if;

  insert into public.chat_message_emails(booking_id, recipient_id, message_id, notification_id)
    values (booking, new.user_id, message.id, new.id) on conflict do nothing;
  return new;
end;
$function$;
revoke all on function public.queue_unread_chat_email()
  from public, anon, authenticated, service_role;
create trigger queue_unread_chat_email after insert on public.notifications
  for each row execute function public.queue_unread_chat_email();

-- Opening a conversation clears its message notifications as well as read receipts.
create or replace function public.mark_messages_read(p_booking_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $function$
declare
  uid uuid := auth.uid();
  marked integer;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not public.account_is_active() or not exists (
    select 1 from public.bookings b where b.id = p_booking_id
      and (b.customer_id = uid or b.provider_id = public.current_provider_id())
  ) then raise exception 'Not a conversation participant'; end if;
  -- Serialize sending/read clearing for this recipient and conversation.
  perform pg_advisory_xact_lock(hashtextextended('chat-email:' || p_booking_id::text || ':' || uid::text, 0));
  perform 1 from public.chat_email_threads
    where booking_id = p_booking_id and recipient_id = uid for update;
  update public.booking_messages set read_at = now()
    where booking_id = p_booking_id and sender_id <> uid and read_at is null;
  get diagnostics marked = row_count;
  update public.notifications set read = true
    where user_id = uid and title like 'Message from %'
      and href in ('/account/visit/' || p_booking_id::text, '/worker/job/' || p_booking_id::text);
  return jsonb_build_object('ok', true, 'marked', marked);
end;
$function$;

create function public.claim_chat_message_emails(p_limit integer default 2)
returns table(id uuid, claim_token uuid, email text, sender_role text, body text, href text)
language plpgsql security definer set search_path = public, auth
as $function$
declare
  item public.chat_message_emails;
  token uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  update public.chat_message_emails e set status = 'cancelled', claim_token = null, leased_until = null
    where e.status in ('pending', 'processing')
      and (e.leased_until is null or e.leased_until < now())
      and not public.chat_message_email_eligible(e.id);
  update public.chat_message_emails e set status = 'failed', claim_token = null, leased_until = null
    where e.status in ('pending', 'processing')
      and (e.leased_until is null or e.leased_until < now())
      and (e.attempts >= 8 or e.created_at < now() - interval '23 hours');
  for item in
    select e.* from public.chat_message_emails e
    where e.status in ('pending', 'processing') and e.next_attempt_at <= now()
      and pg_try_advisory_xact_lock(hashtextextended('chat-email:' || e.booking_id::text || ':' || e.recipient_id::text, 0))
      and (e.leased_until is null or e.leased_until < now())
    order by e.created_at for update skip locked limit greatest(1, least(p_limit, 2))
  loop
    token := gen_random_uuid();
    -- Reserve the cooldown before external delivery, including uncertain failures.
    -- Retries use the SAME outbox ID as Resend's idempotency key.
    update public.chat_email_threads t
      set next_email_at = greatest(coalesce(t.next_email_at, now()), now() + interval '15 minutes')
      where t.booking_id = item.booking_id and t.recipient_id = item.recipient_id;
    update public.chat_message_emails e set status = 'processing', attempts = attempts + 1,
      claim_token = token, leased_until = now() + interval '2 minutes'
      where e.id = item.id;
    return query select item.id, token, u.email::text, m.sender_role, m.body, n.href
      from auth.users u join public.booking_messages m on m.id = item.message_id
      join public.notifications n on n.id = item.notification_id where u.id = item.recipient_id;
  end loop;
end;
$function$;

create function public.chat_message_email_allowed(p_id uuid, p_token uuid, p_email text)
returns boolean
language sql stable security definer set search_path = public, auth
as $function$
  select auth.role() = 'service_role' and exists (
    select 1 from public.chat_message_emails e join auth.users u on u.id = e.recipient_id
    where e.id = p_id and e.claim_token = p_token and e.status = 'processing'
      and e.leased_until > now() and u.email = p_email
      and public.chat_message_email_eligible(e.id)
  );
$function$;

create function public.finish_chat_message_email(p_id uuid, p_token uuid, p_outcome text)
returns void
language plpgsql security definer set search_path = public
as $function$
declare
  item public.chat_message_emails;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  select * into item from public.chat_message_emails where id = p_id;
  if not found then return; end if;
  perform pg_advisory_xact_lock(hashtextextended('chat-email:' || item.booking_id::text || ':' || item.recipient_id::text, 0));
  if p_outcome not in ('sent', 'cancelled', 'retry') then raise exception 'Invalid delivery outcome'; end if;
  update public.chat_message_emails e set
    status = case when p_outcome <> 'retry' then p_outcome when e.attempts >= 8 then 'failed' else 'pending' end,
    sent_at = case when p_outcome = 'sent' then now() end,
    claim_token = null, leased_until = null,
    next_attempt_at = now() + make_interval(secs => least(3600, 60 * (2 ^ e.attempts)::integer))
    where e.id = p_id and e.claim_token = p_token and e.status = 'processing';
  if found and p_outcome = 'sent' then
    update public.chat_email_threads t set next_email_at = greatest(t.next_email_at, now() + interval '15 minutes')
    from public.chat_message_emails e
    where e.id = p_id and t.booking_id = e.booking_id and t.recipient_id = e.recipient_id;
  end if;
end;
$function$;
revoke all on function public.claim_chat_message_emails(integer),
  public.chat_message_email_allowed(uuid, uuid, text), public.finish_chat_message_email(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.claim_chat_message_emails(integer),
  public.chat_message_email_allowed(uuid, uuid, text), public.finish_chat_message_email(uuid, uuid, text)
  to service_role;

-- Existing private per-minute account-security schedulers deliver this outbox too.
-- No emails are queued for historical messages, and no new credential is needed.
commit;
