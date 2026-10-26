begin;

create table public.booking_checkin_safety_alerts (
  booking_id uuid not null references public.bookings(id) on delete cascade,
  scheduled_at timestamptz not null,
  provider_id uuid not null references public.providers(id),
  alerted_at timestamptz not null default clock_timestamp(),
  primary key (booking_id, scheduled_at)
);
alter table public.booking_checkin_safety_alerts enable row level security;
revoke all on public.booking_checkin_safety_alerts from public, anon, authenticated, service_role;
grant select on public.booking_checkin_safety_alerts to authenticated, service_role;
create policy "Authenticator admins read check-in safety alerts"
  on public.booking_checkin_safety_alerts for select to authenticated
  using (public.is_admin());

create function public.alert_missing_cleaner_checkins()
returns integer language plpgsql security definer set search_path = public as $function$
declare
  booking record;
  inserted integer;
  alerted integer := 0;
begin
  for booking in
    select b.id, b.provider_id, b.scheduled_at
    from public.bookings b
    where b.status::text = 'scheduled' and b.provider_id is not null
      and exists (select 1 from public.profiles where role::text = 'admin' and account_deleted_at is null)
      and b.scheduled_at <= now() - interval '30 minutes'
      and b.scheduled_at > now() - interval '24 hours'
      and not exists (select 1 from public.check_ins c
        where c.booking_id = b.id and c.arrived_at is not null)
    order by b.scheduled_at, b.id limit 200
    for update of b skip locked
  loop
    insert into public.booking_checkin_safety_alerts(booking_id, scheduled_at, provider_id)
    values (booking.id, booking.scheduled_at, booking.provider_id)
    on conflict do nothing;
    get diagnostics inserted = row_count;
    if inserted = 0 then continue; end if;
    insert into public.notifications(user_id, title, body, href)
    select p.id, 'Cleaner check-in overdue',
      'A cleaner has not checked in 30 minutes after the scheduled start. Contact the professional and review the visit safety status.',
      '/admin/bookings?booking=' || booking.id::text
    from public.profiles p where p.role::text = 'admin' and p.account_deleted_at is null;
    alerted := alerted + 1;
  end loop;
  return alerted;
end;
$function$;
revoke all on function public.alert_missing_cleaner_checkins()
  from public, anon, authenticated;
grant execute on function public.alert_missing_cleaner_checkins() to service_role;

do $patch$
declare source text;
begin
  select pg_get_functiondef('public.notification_essential_email(text)'::regprocedure) into source;
  if strpos(source, '(security|verification code') = 0 then
    raise exception 'Essential notification classification changed; review before installation';
  end if;
  execute replace(source, '(security|verification code',
    '(Cleaner check-in overdue|Gas Safe registration expiry|Electrical registration expiry|security|verification code');
end;
$patch$;

-- Installed separately per environment after tests; no schedule starts here.
-- This alert never changes booking, payment, payout or no-show decisions.
commit;
