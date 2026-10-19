-- STAGING ONLY. No eligibility bypass and no financial operations.
-- Only inspect bookings created for the isolated F1 test run.
create or replace function public.staging_f1_offer_state(p_booking uuid)
returns jsonb language plpgsql security definer set search_path = public
as $function$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  if not exists (
    select 1 from public.bookings b join public.profiles p on p.id = b.customer_id
    where b.id = p_booking and p.email like 'qa-f1-%@example.invalid'
      and b.household_notes like 'F1 SYNTHETIC TEST ONLY%'
      and not exists(select 1 from public.payments pay where pay.booking_id = b.id)
      and not exists(select 1 from public.booking_visit_billing bill where bill.booking_id = b.id)
  ) then raise exception 'Only unfunded synthetic F1 fixtures may be inspected'; end if;
  return jsonb_build_object(
    'run', (select to_jsonb(r) from public.booking_offer_runs r where booking_id = p_booking),
    'queue', (select coalesce(jsonb_agg(to_jsonb(q) order by q.queue_position), '[]') from public.booking_offer_queue q where booking_id = p_booking),
    'offers', (select coalesce(jsonb_agg(to_jsonb(o)), '[]') from public.booking_offers o where booking_id = p_booking),
    'deliveries', (select coalesce(jsonb_agg(to_jsonb(d)), '[]') from public.job_offer_deliveries d where booking_id = p_booking),
    'runtime', (select to_jsonb(r) from public.job_offer_wave_runtime r where id),
    'cron', (select to_jsonb(j) from cron.job j where jobname = 'opulence-ranked-offer-waves'),
    'ledger', (select jsonb_build_object('version', version, 'sha256', encode(sha256(convert_to(statements[1], 'UTF8')), 'hex'))
      from supabase_migrations.schema_migrations where version = '20261019000500')
  );
end;
$function$;
revoke all on function public.staging_f1_offer_state(uuid) from public, anon, authenticated;
grant execute on function public.staging_f1_offer_state(uuid) to service_role;
