begin;

-- Keep the original name for professional and staff use. Customer-facing
-- queries select this projection so no surname reaches the browser or assistant.
create function public.cleaner_customer_first_name(p_name text)
returns text
language sql
immutable
strict
set search_path = ''
as $function$
  select case
    when btrim(p_name) in ('Closed professional', 'Deleted professional', 'Expired application')
      or position('@' in first_word) > 0 then null
    else first_word
  end
  from (
    select substring(
      regexp_replace(replace(p_name, chr(160), ' '),
        '^[[:space:]]*((Mr|Mrs|Ms|Miss|Mx|Dr|Prof)[.]?[[:space:]]+)?', '', 'i')
      from '^[^[:space:]]+'
    ) as first_word
  ) as name;
$function$;

alter table public.providers
  add column customer_first_name text generated always as
    (public.cleaner_customer_first_name(display_name)) stored;

-- Preserve the existing RPC identities, grants, eligibility and chat rules.
do $customer_names$
declare
  routine regprocedure;
  source text;
  redacted text;
begin
  foreach routine in array array[
    'public.my_previous_cleaners()'::regprocedure,
    'public.homepage_review_highlights_feed()'::regprocedure,
    'public.public_reviews_feed(integer)'::regprocedure,
    'public.report_provider_delay(uuid,integer)'::regprocedure,
    'public.send_booking_message_before_contact_decisions(uuid,text)'::regprocedure
  ] loop
    source := pg_get_functiondef(routine);
    redacted := replace(replace(source, 'p.display_name', 'p.customer_first_name'),
      'pr.display_name', 'pr.customer_first_name');
    if redacted = source then
      raise exception 'Inspect the customer name projection for % before applying this migration', routine;
    end if;
    execute redacted;
  end loop;
end;
$customer_names$;

-- Replace old system-generated titles only. Keep message bodies, booking
-- history and staff records intact, including when the assigned cleaner changed.
update public.notifications n
set title = case
  when n.title like 'Message from %' then
    'Message from ' || coalesce(
      public.cleaner_customer_first_name(substr(n.title, length('Message from ') + 1)),
      'your professional')
  when n.title like '% is running late' then
    coalesce(public.cleaner_customer_first_name(left(n.title, -length(' is running late'))),
      'Your professional') || ' is running late'
  else
    coalesce(public.cleaner_customer_first_name(left(n.title, -length(' is back on schedule'))),
      'Your professional') || ' is back on schedule'
end
from public.bookings b
where b.customer_id = n.user_id
  and n.href = '/account/visit/' || b.id::text
  and n.title not in (
    'Message from Opulence Bliss', 'Message from Your provider',
    'Your provider is running late', 'Your provider is back on schedule'
  )
  and (n.title like 'Message from %' or n.title like '% is running late'
    or n.title like '% is back on schedule');

notify pgrst, 'reload schema';
commit;
