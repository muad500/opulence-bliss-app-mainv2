-- A retry can discover a missing provider account or a legacy destination
-- charge before issuing any new transfer. In those verified no-transfer cases,
-- let the system hold the payout for an admin instead of leaving it processing.
begin;

-- Tip payouts are separate from the visit payout but must still have a
-- durable, unique link to the captured tip payment for retries and admin UI.
alter table public.payouts
  add column if not exists payment_id uuid references public.payments(id) on delete restrict;
create unique index if not exists payouts_payment_id_key
  on public.payouts(payment_id) where payment_id is not null;

insert into public.payout_transitions
  (from_status, to_status, actor_kind, reason_required, note)
values
  ('failed', 'held', 'system', true, 'No new transfer was attempted; admin action required.'),
  ('processing', 'held', 'system', true, 'No new transfer was attempted; admin action required.')
on conflict (from_status, to_status, actor_kind) do update set
  reason_required = excluded.reason_required,
  note = excluded.note;

-- Release the visit's own payout, not a tip payout that may have been created
-- earlier on the same booking. Locking the booking serialises this with case
-- creation, just like maybe_release_payout does for older payout paths.
create or replace function public.maybe_release_visit_payout(p_booking_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_booking public.bookings;
  v_payout public.payouts;
begin
  select * into v_booking from public.bookings
    where id = p_booking_id for update;
  if not found or v_booking.status::text <> 'completed' then
    return jsonb_build_object('released', false, 'reason', 'visit not completed');
  end if;
  select * into v_payout from public.payouts
    where booking_id = p_booking_id and payment_id is null
    order by created_at limit 1 for update;
  if not found or v_payout.status <> 'not_ready' then
    return jsonb_build_object('released', false, 'reason', 'visit payout not awaiting release');
  end if;
  if not exists (
    select 1 from public.payments
    where booking_id = p_booking_id
      and coalesce(kind, 'booking') <> 'tip'
      and status = 'succeeded'
  ) then
    return jsonb_build_object('released', false, 'reason', 'visit funds not captured');
  end if;
  if exists (
    select 1 from public.review_cases
    where booking_id = p_booking_id and status <> 'resolved'
      and (blocks_payment or blocks_payout)
  ) then
    perform public._apply_payout_transition(v_payout.id, 'held', null, 'system',
      'An open review case blocks this payout', '{}'::jsonb);
    return jsonb_build_object('released', false, 'reason', 'held by review case');
  end if;
  perform public._apply_payout_transition(v_payout.id, 'pending', null, 'system',
    'Completed visit and captured payment', '{}'::jsonb);
  return jsonb_build_object('released', true, 'payout_id', v_payout.id);
end $fn$;
revoke all on function public.maybe_release_visit_payout(uuid) from public, anon, authenticated;
grant execute on function public.maybe_release_visit_payout(uuid) to service_role;

commit;
