begin;

-- Return timing only, scoped to the visit participants. Historical GPS stays private.
create function public.booking_contact_state(p_booking_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $function$
declare visit_end timestamptz;
begin
  if auth.uid() is null or not public.account_is_active() or not exists (
    select 1 from public.bookings where id = p_booking_id
      and (customer_id = auth.uid() or provider_id = public.current_provider_id() or public.is_admin())
  ) then return null; end if;
  visit_end := public.visit_contact_end(p_booking_id);
  return jsonb_build_object('visitEnd', visit_end, 'closesAt', visit_end + interval '24 hours',
    'open', public.booking_messaging_open(p_booking_id),
    'addressVisible', public.worker_address_visible(p_booking_id));
end;
$function$;
revoke all on function public.booking_contact_state(uuid) from public, anon, authenticated, service_role;
grant execute on function public.booking_contact_state(uuid) to authenticated;

commit;
notify pgrst, 'reload schema';
