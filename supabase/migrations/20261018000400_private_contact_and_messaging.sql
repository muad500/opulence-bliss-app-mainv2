begin;

create function public.visit_contact_end(p_booking uuid)
returns timestamptz language sql stable security definer set search_path = public
as $function$
  select coalesce(
    (select max(left_at) from public.check_ins where booking_id = b.id),
    (select max(created_at) from public.booking_events
      where booking_id = b.id and to_status = 'completed'),
    b.scheduled_at + make_interval(mins => coalesce(b.duration_minutes, p.duration_minutes, 120))
  )
  from public.bookings b left join public.packages p on p.id = b.package_id
  where b.id = p_booking;
$function$;

create function public.booking_messaging_open(p_booking_id uuid)
returns boolean language sql stable security definer set search_path = public
as $function$
  select auth.uid() is not null and public.account_is_active() and exists (
    select 1 from public.bookings b where b.id = p_booking_id and (
      public.is_admin() or (
        (b.customer_id = auth.uid() or b.provider_id = public.current_provider_id())
        and b.provider_id is not null
        and b.status::text in ('scheduled', 'in_progress', 'completed', 'needs_review')
        and now() < public.visit_contact_end(b.id) + interval '24 hours'
      )
    )
  );
$function$;

create function public.worker_address_visible(p_booking uuid)
returns boolean language sql stable security definer set search_path = public
as $function$
  select exists (select 1 from public.bookings b
    where b.id = p_booking and b.provider_id = public.current_provider_id()
      and b.status::text in ('scheduled', 'in_progress')
      and now() < public.visit_contact_end(b.id)
      and public.account_is_active());
$function$;

-- A restrictive policy closes every old permissive historical-booking policy.
create policy private_contact_after_visit on public.bookings as restrictive
for select to authenticated using (
  public.is_admin() or customer_id = auth.uid() or public.worker_address_visible(id)
);

-- Safe history/offers preserve the real table type and its PostgREST relationships.
create function public.worker_visible_bookings()
returns setof public.bookings language plpgsql stable security definer set search_path = public
as $function$
declare b public.bookings; payload jsonb;
begin
  if auth.uid() is null or not public.account_is_active() then return; end if;
  for b in select * from public.bookings x where
    x.provider_id = public.current_provider_id() or exists (
      select 1 from public.booking_offers o where o.booking_id = x.id
        and o.provider_id = public.current_provider_id() and o.status = 'open'
        and x.status::text = 'offered'
    )
  loop
    payload := to_jsonb(b) || jsonb_build_object('customer_email', null);
    if not public.worker_address_visible(b.id) then
      payload := payload || jsonb_build_object('address', null, 'household_notes', null,
        'cleaning_extras', coalesce(b.cleaning_extras, '{}'::jsonb) - 'notes');
    else
      payload := payload || jsonb_build_object('household_notes',
        regexp_replace(coalesce(b.household_notes, ''), '(\+44|0)[0-9 ()-]{9,20}', '[Use in-app messages]', 'g'));
    end if;
    return next jsonb_populate_record(null::public.bookings, payload);
  end loop;
end;
$function$;

create or replace function public.booking_customer_summary(p_booking_id uuid)
returns table(full_name text, client_rating_avg numeric, client_rating_count integer, phone text)
language plpgsql stable security definer set search_path = public
as $function$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  return query select c.full_name,
    case when public.is_admin() then c.client_rating_avg else null::numeric end,
    case when public.is_admin() then c.client_rating_count else 0 end,
    case when public.is_admin() then c.phone::text else null::text end
  from public.bookings b join public.profiles c on c.id = b.customer_id
  where b.id = p_booking_id and (b.provider_id = public.current_provider_id() or public.is_admin());
end;
$function$;

alter function public.send_booking_message(uuid, text) rename to send_booking_message_before_contact_decisions;
create function public.send_booking_message(p_booking_id uuid, p_body text)
returns jsonb language plpgsql security definer set search_path = public
as $function$
begin
  if not public.booking_messaging_open(p_booking_id) then
    raise exception 'Messages open when a professional accepts and close 24 hours after the visit. Contact hello@opulencebliss.com for help.' using errcode = 'insufficient_privilege';
  end if;
  if p_body ~ '(\+44|0)[0-9 ()-]{9,20}' then
    return jsonb_build_object('ok', false, 'blocked', true, 'category', 'private_contact');
  end if;
  return public.send_booking_message_before_contact_decisions(p_booking_id, p_body);
end;
$function$;
revoke all on function public.send_booking_message_before_contact_decisions(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.send_booking_message(uuid, text) from public, anon, service_role;
grant execute on function public.send_booking_message(uuid, text) to authenticated;

create policy message_time_window on public.booking_messages as restrictive
for select to authenticated using (public.booking_messaging_open(booking_id));

create policy booking_file_time_window_read on storage.objects as restrictive
for select to authenticated using (
  bucket_id <> 'booking-attachments' or exists (
    select 1 from public.bookings b where b.id::text = (storage.foldername(name))[1]
      and public.booking_messaging_open(b.id)
  )
);
-- Use a security-definer lookup, because the worker's raw history address is hidden.
create function public.booking_file_window(p_path text)
returns boolean language sql stable security definer set search_path = public
as $function$
  select coalesce((select public.booking_messaging_open(id) from public.bookings
    where id::text = split_part(p_path, '/', 1)), false);
$function$;
drop policy booking_file_time_window_read on storage.objects;
create policy booking_file_time_window_read on storage.objects as restrictive
for select to authenticated using (bucket_id <> 'booking-attachments' or public.booking_file_window(name));
drop policy if exists "participants read private booking files" on storage.objects;
create policy "participants read private booking files" on storage.objects
for select to authenticated using (bucket_id = 'booking-attachments' and public.booking_file_window(name));
drop policy if exists "participants upload private booking files" on storage.objects;
create policy "participants upload private booking files" on storage.objects
for insert to authenticated with check (
  bucket_id = 'booking-attachments' and (storage.foldername(name))[2] = auth.uid()::text
    and public.booking_file_window(name)
);

-- Historical GPS and invoice addresses must not bypass the contact restriction.
create policy private_history_coordinates on public.check_ins as restrictive
for select to authenticated using (
  public.is_admin() or exists (select 1 from public.bookings b where b.id = booking_id
    and (b.customer_id = auth.uid() or public.worker_address_visible(b.id)))
);
create policy private_invoice_addresses on public.provider_job_invoices as restrictive
for select to authenticated using (public.is_admin());
create function public.worker_visible_invoices()
returns setof public.provider_job_invoices language sql stable security definer set search_path = public
as $function$
  select (jsonb_populate_record(null::public.provider_job_invoices,
    to_jsonb(i) || jsonb_build_object('address', 'Address hidden after visit'))).*
  from public.provider_job_invoices i where i.provider_id = public.current_provider_id()
    and auth.uid() is not null and public.account_is_active();
$function$;

-- New feedback cannot request public/customer delivery, including direct API writes.
create function public.keep_professional_feedback_internal()
returns trigger language plpgsql set search_path = public as $function$
begin
  if new.reviewer = 'provider' then new.visibility := 'private'; end if;
  return new;
end;
$function$;
create trigger keep_professional_feedback_internal before insert or update of visibility on public.reviews
for each row execute function public.keep_professional_feedback_internal();
revoke all on function public.keep_professional_feedback_internal() from public,anon,authenticated,service_role;
update public.notifications set title = 'Account update', body = 'For support, contact hello@opulencebliss.com.'
where title like 'Your provider rated you %';

-- Customer feedback written by professionals is internal, including old public rows.
create policy professional_reviews_admin_only on public.reviews as restrictive
for select using (reviewer <> 'provider' or public.is_admin());
create or replace function public.public_reviews_feed(p_limit integer default 60)
returns table(id uuid, reviewer text, rating integer, comment text, created_at timestamptz,
  recipient_name text, recipient_type text)
language sql stable security definer set search_path = public
as $function$
  select r.id, r.reviewer, r.rating, r.comment, r.created_at,
    coalesce(nullif(btrim(p.display_name), ''), 'Opulence professional'), 'professional'::text
  from public.reviews r join public.bookings b on b.id = r.booking_id
  left join public.providers p on p.id = b.provider_id
  where r.visibility = 'public' and r.reviewer = 'client'
  order by r.created_at desc limit least(greatest(coalesce(p_limit, 60), 1), 100);
$function$;

-- Preserve non-public customer feedback received by a professional after the visit,
-- without reopening the private booking/address row.
create function public.owns_reviewed_cleaning_visit(p_booking uuid)
returns boolean language sql stable security definer set search_path = public
as $function$
  select exists (select 1 from public.bookings where id = p_booking
    and provider_id = public.current_provider_id() and public.account_is_active());
$function$;
revoke all on function public.owns_reviewed_cleaning_visit(uuid) from public, anon, service_role;
grant execute on function public.owns_reviewed_cleaning_visit(uuid) to authenticated;
create function public.professional_can_review_visit(p_booking uuid)
returns boolean language sql stable security definer set search_path=public as $function$
  select exists(select 1 from public.bookings where id=p_booking
    and provider_id=public.current_provider_id() and status::text='completed' and public.account_is_active());
$function$;
revoke all on function public.professional_can_review_visit(uuid) from public,anon,service_role;
grant execute on function public.professional_can_review_visit(uuid) to authenticated;
create policy provider_writes_internal_feedback on public.reviews for insert to authenticated
with check (reviewer='provider' and public.professional_can_review_visit(booking_id));

create policy professional_reads_received_customer_review on public.reviews
for select to authenticated using (reviewer = 'client' and public.owns_reviewed_cleaning_visit(booking_id));

update public.notifications set body = 'A job offer in your coverage area was received. Open your jobs for its current status.'
where title = 'New job offer' and href = '/worker';

create function public.worker_visible_payments()
returns setof public.payments language sql stable security definer set search_path=public as $function$
  select payment.* from public.payments payment join public.bookings booking on booking.id=payment.booking_id
  where booking.provider_id=public.current_provider_id() and public.account_is_active();
$function$;
create function public.worker_visible_payouts()
returns setof public.payouts language sql stable security definer set search_path=public as $function$
  select payout.* from public.payouts payout join public.bookings booking on booking.id=payout.booking_id
  where booking.provider_id=public.current_provider_id() and public.account_is_active();
$function$;
revoke all on function public.worker_visible_payments(),public.worker_visible_payouts() from public,anon,authenticated,service_role;
grant execute on function public.worker_visible_payments(),public.worker_visible_payouts() to authenticated;

-- No account can recover its internal customer score through a direct profile read.
revoke select on public.profiles from public, authenticated, anon;
revoke select (client_rating_avg, client_rating_count) on public.profiles from public, authenticated, anon;
do $permissions$
declare columns text;
begin
  select string_agg(quote_ident(attname), ', ') into columns from pg_attribute
  where attrelid = 'public.profiles'::regclass and attnum > 0 and not attisdropped
    and attname not in ('client_rating_avg', 'client_rating_count');
  execute 'grant select (' || columns || ') on public.profiles to authenticated';
end;
$permissions$;
create function public.admin_customer_profiles()
returns setof public.profiles language sql stable security definer set search_path = public
as $function$ select * from public.profiles where public.is_admin(); $function$;

revoke all on function public.visit_contact_end(uuid), public.booking_messaging_open(uuid),
  public.worker_address_visible(uuid), public.worker_visible_bookings(),
  public.worker_visible_invoices(), public.booking_file_window(text),
  public.admin_customer_profiles() from public, anon, authenticated, service_role;
grant execute on function public.booking_messaging_open(uuid), public.worker_address_visible(uuid),
  public.worker_visible_bookings(), public.worker_visible_invoices(), public.booking_file_window(text),
  public.admin_customer_profiles() to authenticated;
grant execute on function public.visit_contact_end(uuid) to service_role;

-- Store checkout time before history RLS hides the underlying visit.
create function public.record_private_visit_checkout()
returns trigger language plpgsql security definer set search_path = public
as $function$
begin
  if new.status::text = 'completed' and old.status is distinct from new.status then
    update public.check_ins set left_at = coalesce(left_at, now()) where booking_id = new.id;
  end if;
  return new;
end;
$function$;
create trigger record_private_visit_checkout after update of status on public.bookings
for each row execute function public.record_private_visit_checkout();
revoke all on function public.record_private_visit_checkout() from public, anon, authenticated, service_role;

commit;
notify pgrst, 'reload schema';
