-- Compliance changes that need no approval of legal wording.
--
-- 1. Record a customer's express request to start within the 14-day
--    cancellation period, and confirm it in the "Booking received" email
--    (Consumer Contracts Regulations 2013, regs. 16 and 36).
-- 2. Keep only the outcome of a DBS check. Once an admin verifies a
--    certificate, the uploaded copy is deleted and only the certificate
--    number, issue date and outcome remain, as agreed with the client.
-- 3. Correct the phone number in the published legal documents: with +44 the
--    leading 0 is dropped.

begin;

-- 1. Early-start request
alter table public.bookings
  add column if not exists early_start_requested_at timestamptz;

comment on column public.bookings.early_start_requested_at is
  'When the customer expressly asked for the service to start within their 14-day cancellation period.';

-- The notice function, copied unchanged from 20260907000100 apart from the
-- early-start confirmation added to the customer's "Booking received" email.
create or replace function public.queue_booking_notice(
  p_booking_id uuid, p_kind text, p_key text, p_due timestamptz, p_expires timestamptz
) returns void language plpgsql security definer set search_path = public as $fn$
declare
  v_booking public.bookings;
  v_service text;
  v_recipient record;
  v_title text;
  v_body text;
  v_id uuid;
  v_channel text;
begin
  select * into v_booking from public.bookings where id = p_booking_id;
  if not found or v_booking.customer_id is null then return; end if;
  select name into v_service from public.packages where id = v_booking.package_id;

  for v_recipient in
    select v_booking.customer_id as user_id, 'customer'::text as audience, '/account/visit/' || p_booking_id as href
    union all
    select p.profile_id, 'provider'::text, '/worker/job/' || p_booking_id
      from public.providers p
     where p.id = v_booking.provider_id
       and p_kind in ('confirmed', 'reminder_24h', 'reminder_90m', 'remaining_30m')
  loop
    v_title := case
      when v_recipient.audience = 'provider' and p_kind = 'confirmed' then 'Job confirmed'
      when v_recipient.audience = 'provider' and p_kind = 'reminder_24h' then 'Your job is in 24 hours'
      when v_recipient.audience = 'provider' and p_kind = 'reminder_90m' then 'Your job is in 1 hour 30 minutes'
      when p_kind = 'received' then 'Booking received'
      when p_kind = 'confirmed' then 'Booking confirmed'
      when p_kind = 'reminder_24h' then 'Your booking is in 24 hours'
      when p_kind = 'reminder_90m' then 'Your booking is in 1 hour 30 minutes'
      else '30 minutes remaining'
    end;
    v_body := case
      when v_recipient.audience = 'provider' and p_kind = 'confirmed' then 'You accepted this job. '
      when v_recipient.audience = 'provider' and p_kind = 'remaining_30m' then 'Your active job has 30 minutes remaining. '
      when v_recipient.audience = 'provider' then 'A reminder for your confirmed job. '
      when p_kind = 'received' then 'We have received your booking and are finding your cleaner or professional. '
      when p_kind = 'confirmed' then 'Your professional has accepted your booking. '
      when p_kind = 'remaining_30m' then 'Your session has 30 minutes remaining from the checked-in start time. '
      else 'A reminder for your confirmed booking. '
    end || coalesce(v_service, 'Service') || ' on ' ||
      to_char(v_booking.scheduled_at at time zone 'Europe/London', 'Dy DD Mon YYYY, HH12:MI AM') ||
      ' (London time), ' || coalesce(v_booking.duration_minutes::text, '120') ||
      ' minutes. This is an automated notification; use your booking chat for replies.';
    -- Confirm the customer's express request to start within the 14-day
    -- cancellation period (Consumer Contracts Regulations 2013, regs. 16 and
    -- 36). Checkout requires that request for any booking starting before the
    -- period ends, which is midnight London time after the 14th day.
    if v_recipient.audience = 'customer' and p_kind = 'received'
       and v_booking.scheduled_at <
         (((v_booking.created_at at time zone 'Europe/London')::date + 15)::timestamp
           at time zone 'Europe/London') then
      v_body := v_body || ' You asked for this service to start within your 14-day cancellation period, '
        || 'and acknowledged that you lose the right to cancel once it has been fully provided. '
        || 'If you cancel after it has started, you pay for the part already provided.';
    end if;

    foreach v_channel in array array['in_app','email'] loop
      v_id := null;
      insert into public.booking_notification_deliveries
        (booking_id,user_id,event_key,kind,channel,title,body,href,due_at,expires_at)
      values(p_booking_id,v_recipient.user_id,p_key,p_kind,v_channel,v_title,v_body,v_recipient.href,p_due,p_expires)
      on conflict(booking_id,user_id,event_key,channel) do update
        set status = 'pending', due_at = excluded.due_at, expires_at = excluded.expires_at,
            title = excluded.title, body = excluded.body, href = excluded.href, claim_token = null
        where booking_notification_deliveries.status = 'cancelled'
          and booking_notification_deliveries.sent_at is null
      returning id into v_id;
      if v_id is not null and v_channel = 'in_app' and p_due <= now() then
        insert into public.notifications(user_id,title,body,href)
        values(v_recipient.user_id,v_title,v_body,v_recipient.href);
        update public.booking_notification_deliveries set status = 'sent', sent_at = now() where id = v_id;
      end if;
    end loop;
  end loop;
end
$fn$;

revoke all on function public.queue_booking_notice(uuid,text,text,timestamptz,timestamptz) from public, anon, authenticated, service_role;

-- 2. DBS data minimisation
alter table public.provider_dbs_checks
  alter column certificate_storage_path drop not null;
alter table public.provider_dbs_checks
  add column if not exists certificate_deleted_at timestamptz;

comment on column public.provider_dbs_checks.certificate_deleted_at is
  'When the uploaded certificate copy was deleted after verification. The number, issue date and outcome are kept.';

-- 3. Phone number format in published legal documents. Only this exact text is
--    replaced, so any other admin edits are kept.
update public.legal_documents
set content_html = replace(content_html, '+44 07484 717935', '+44 7484 717935'),
    updated_at = now()
where content_html like '%+44 07484 717935%';

commit;
