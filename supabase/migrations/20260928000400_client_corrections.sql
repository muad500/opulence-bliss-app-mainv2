-- Client corrections: FAQ wording and photo-only booking chat uploads.
-- Existing PDF attachments remain readable; only new uploads are refused.

begin;

update public.faqs
set answer = 'Yes. You can share photos in your booking chat (JPG, PNG or WebP, up to 10 MB). Please only share photos related to your booking or the cleaning.',
    updated_at = now()
where lower(trim(question)) = 'can i send photos or files to my professional?';

update public.faqs
set answer = 'Yes. All our cleaning professionals are vetted before they can take bookings.',
    updated_at = now()
where lower(trim(question)) = 'are professionals vetted?';

update public.faqs
set answer = 'Yes. Choose weekly, every two weeks or monthly when you book, and book 6 to 10 visits together.',
    updated_at = now()
where lower(trim(question)) = 'can i arrange regular cleaning?';

update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'booking-attachments';

-- Match the chat moderation function while refusing new PDF attachments.
create or replace function public.send_booking_attachment(p_booking_id uuid, p_body text, p_path text, p_name text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_result jsonb;
  v_meta jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = 'insufficient_privilege'; end if;
  if p_path not like p_booking_id::text || '/' || auth.uid()::text || '/%' then
    raise exception 'Invalid attachment path.' using errcode = 'insufficient_privilege';
  end if;
  select metadata into v_meta from storage.objects where bucket_id = 'booking-attachments' and name = p_path for update;
  if not found or coalesce(v_meta->>'mimetype', '') not in ('image/jpeg','image/png','image/webp')
    or coalesce((v_meta->>'size')::bigint, 0) not between 1 and 10485760 then
    raise exception 'Choose a JPG, PNG or WebP photo up to 10 MB.';
  end if;
  -- Apply the same content and membership checks as typed messages.
  if public.classify_chat_message(p_name) is not null then
    return public.send_booking_message(p_booking_id, p_name);
  end if;
  v_result := public.send_booking_message(p_booking_id, p_body);
  if coalesce((v_result->>'blocked')::boolean, false) then
    return v_result;
  end if;
  insert into public.booking_message_attachments(message_id, path, name, mime_type)
  values((v_result->>'id')::bigint, p_path, left(coalesce(nullif(trim(p_name), ''), 'Attachment'), 160), v_meta->>'mimetype');
  return v_result;
end $fn$;

revoke all on function public.send_booking_attachment(uuid,text,text,text) from public, anon, service_role;
grant execute on function public.send_booking_attachment(uuid,text,text,text) to authenticated;

commit;
