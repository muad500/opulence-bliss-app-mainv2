-- Hosted staging caught the older outbox kind constraint rejecting an end
-- confirmation. Keep the same freshness and open-account checks as other mail.
begin;

alter table public.visit_matching_notices
  drop constraint visit_matching_notices_kind_check;
alter table public.visit_matching_notices
  add constraint visit_matching_notices_kind_check check (kind in (
    'admin_48h', 'customer_24h', 'unmatched_cancelled',
    'series_paused', 'series_resumed', 'series_ended', 'payment_reconciled'
  ));

create or replace function public.visit_matching_notice_allowed(p_id uuid, p_token uuid)
returns boolean
language plpgsql security definer set search_path = public
as $fn$
declare
  notice public.visit_matching_notices;
  booking public.bookings;
  series public.regular_booking_series;
begin
  if auth.role() is distinct from 'service_role' then return false; end if;
  select * into notice from public.visit_matching_notices
    where id = p_id and claim_token = p_token and status = 'processing'
      and expires_at > now();
  if not found then return false; end if;
  select * into strict booking from public.bookings where id = notice.booking_id;
  if booking.regular_series_id is not null then
    select * into strict series from public.regular_booking_series
      where id = booking.regular_series_id;
  end if;
  if exists (
    select 1 from public.profiles
    where id = notice.user_id and account_deleted_at is not null
  ) then return false; end if;
  if notice.kind in ('admin_48h', 'customer_24h') then
    return booking.status::text = 'offered' and booking.provider_id is null
      and booking.scheduled_at = notice.scheduled_at
      and booking.scheduled_at > now() + interval '2 hours'
      and booking.scheduled_at <= now() + case when notice.kind = 'customer_24h'
        then interval '24 hours' else interval '48 hours' end
      and not coalesce(series.billing_paused, false)
      and notice.series_generation = coalesce(series.pause_generation, 0);
  elsif notice.kind = 'series_paused' then
    return series.billing_paused and notice.series_generation = series.pause_generation;
  elsif notice.kind = 'series_resumed' then
    return not series.billing_paused and notice.series_generation = series.pause_generation;
  elsif notice.kind = 'series_ended' then
    return series.ended_at is not null and series.billing_paused
      and notice.series_generation = series.pause_generation;
  end if;
  return true;
end;
$fn$;
revoke all on function public.visit_matching_notice_allowed(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.visit_matching_notice_allowed(uuid,uuid) to service_role;

commit;
notify pgrst, 'reload schema';
