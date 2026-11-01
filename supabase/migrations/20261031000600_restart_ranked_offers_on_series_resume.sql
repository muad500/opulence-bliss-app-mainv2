-- A resumed visit needs a fresh ranked run; its previous waves may already be
-- exhausted and pausing closed their open offers. Preserve delivery history.
begin;

create function public.restart_regular_cleaning_offers(p_booking uuid)
returns void
language plpgsql security definer set search_path = public
as $fn$
declare
  booking public.bookings;
  settings public.job_offer_settings;
begin
  perform public.lock_visit_series(p_booking);
  select * into strict booking from public.bookings where id = p_booking for update;
  if auth.uid() is null or not exists (
    select 1 from public.regular_booking_series
    where id = booking.regular_series_id and not billing_paused and ended_at is null
      and (customer_id = auth.uid() or public.is_admin())
  ) then raise exception 'Resume your own active regular booking first'; end if;
  if booking.status::text not in ('offered', 'declined') or booking.provider_id is not null
    or booking.scheduled_at <= now() + interval '2 hours'
  then return; end if;
  select * into strict settings from public.job_offer_settings where id;
  if booking.status::text = 'declined' then
    perform public._apply_booking_transition(
      booking.id, 'offered', auth.uid(), 'customer',
      'Customer resumed the remaining regular visit', '{}'::jsonb
    );
  end if;
  update public.booking_offers set status = 'expired'
    where booking_id = booking.id and status = 'open';
  delete from public.booking_offer_queue where booking_id = booking.id;
  update public.bookings set offer_expires_at = scheduled_at - interval '2 hours'
    where id = booking.id;
  insert into public.booking_offer_runs(
    booking_id, cadence_minutes, run_id, wave_size, wave_wait_minutes, settings_version
  ) values (
    booking.id, settings.second_wave_after_minutes, gen_random_uuid(),
    settings.first_wave_size, settings.second_wave_after_minutes, settings.version
  ) on conflict(booking_id) do update set
    run_id = excluded.run_id, wave_size = excluded.wave_size,
    wave_wait_minutes = excluded.wave_wait_minutes,
    settings_version = excluded.settings_version, cadence_minutes = excluded.cadence_minutes,
    started_at = clock_timestamp(), first_wave_at = null, second_wave_due_at = null,
    second_wave_at = null, exhausted_at = null;
  insert into public.booking_offer_queue(booking_id, provider_id, queue_position, ranking)
    select booking.id, ranked.provider_id,
      row_number() over(order by ranked.score desc, ranked.provider_id)::integer,
      ranked.factors || jsonb_build_object('score', ranked.score)
    from public._rank_cleaning_offers(booking.id) ranked;
  perform public._advance_cleaning_offer_waves(booking.id);
end;
$fn$;
revoke all on function public.restart_regular_cleaning_offers(uuid)
  from public, anon, authenticated, service_role;

alter function public.resume_regular_series(uuid,integer)
  rename to resume_regular_series_before_offer_restart;
revoke all on function public.resume_regular_series_before_offer_restart(uuid,integer)
  from public, anon, authenticated, service_role;
create function public.resume_regular_series(p_series uuid, p_generation integer)
returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  was_paused boolean;
  result jsonb;
  visit record;
begin
  perform pg_advisory_xact_lock(hashtextextended('visit-series:' || p_series, 0));
  select billing_paused into was_paused from public.regular_booking_series
    where id = p_series for update;
  -- Ownership, generation, ended-series and active-operation checks are shared
  -- with the prior wrapper. Repeating a successful resume never rebroadcasts.
  result := public.resume_regular_series_before_offer_restart(p_series, p_generation);
  if not coalesce(was_paused, false) then return result; end if;
  for visit in
    select b.id from public.bookings b
    join public.booking_visit_billing bill on bill.booking_id = b.id
    where b.regular_series_id = p_series and b.provider_id is null
      and b.status::text in ('offered', 'declined') and b.scheduled_at > now() + interval '2 hours'
      and bill.active_operation_id is null and not bill.policy_refund_required
      and bill.status in ('unpaid', 'failed', 'requires_action', 'paid')
    order by b.scheduled_at, b.id
  loop
    perform public.restart_regular_cleaning_offers(visit.id);
  end loop;
  return result;
end;
$fn$;
revoke all on function public.resume_regular_series(uuid,integer) from public, anon;
grant execute on function public.resume_regular_series(uuid,integer) to authenticated;

commit;
