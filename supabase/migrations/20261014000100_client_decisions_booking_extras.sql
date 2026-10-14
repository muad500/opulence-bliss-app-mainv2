-- Approved add-ons are staged before Stripe checkout and copied atomically
-- into each booking by the existing checkout finalisation transactions.
begin;

alter table public.booking_checkout_time_choices
  add column if not exists cleaning_extras jsonb not null default '[]'::jsonb;
alter table public.bookings
  add column if not exists cleaning_extras jsonb not null default '{}'::jsonb;

create or replace function public.copy_checkout_cleaning_extras()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_session text := new.checkout_session_id;
  v_choices jsonb;
  v_choice jsonb;
  v_index integer := coalesce(new.regular_visit_number, 1) - 1;
begin
  if new.cleaning_extras <> '{}'::jsonb then
    raise exception 'Add-ons must be saved through checkout' using errcode = 'check_violation';
  end if;
  if new.regular_series_id is not null then
    select checkout_session_id into v_session
    from public.regular_booking_series
    where id = new.regular_series_id and customer_id = new.customer_id;
  end if;
  select cleaning_extras into v_choices
  from public.booking_checkout_time_choices
  where checkout_session_id = v_session and customer_id = new.customer_id;

  if jsonb_array_length(coalesce(v_choices, '[]'::jsonb)) > 0 then
    v_choice := v_choices -> v_index;
    if v_choice is null
      or jsonb_typeof(v_choice -> 'addons') <> 'array'
      or jsonb_typeof(v_choice -> 'petsAtHome') <> 'boolean'
      or jsonb_typeof(v_choice -> 'bringsProducts') <> 'boolean'
      or (v_choice ->> 'baseMinutes')::integer not between 120 and 480
      or mod((v_choice ->> 'baseMinutes')::integer, 30) <> 0
      or (v_choice ->> 'durationMinutes')::integer < 120
      or (v_choice ->> 'durationMinutes')::integer > 480
      or (v_choice ->> 'durationMinutes')::integer <>
        (v_choice ->> 'baseMinutes')::integer + 60 * jsonb_array_length(v_choice -> 'addons')
    then
      raise exception 'Invalid cleaning add-ons for this visit'
        using errcode = 'check_violation';
    end if;
    new.cleaning_extras := v_choice - 'notes';
    new.duration_minutes := (v_choice ->> 'durationMinutes')::integer;
    new.household_notes := concat_ws(E'\n', new.household_notes, v_choice ->> 'notes');
  end if;
  return new;
end;
$function$;

-- Before the existing duration, window and capacity checks.
drop trigger if exists a_copy_checkout_cleaning_extras on public.bookings;
create trigger a_copy_checkout_cleaning_extras
before insert on public.bookings
for each row execute function public.copy_checkout_cleaning_extras();

create or replace function public.protect_cleaning_extras()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  if new.cleaning_extras is distinct from old.cleaning_extras then
    raise exception 'Paid add-ons cannot be changed directly. Request a booking adjustment.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;
drop trigger if exists protect_paid_cleaning_extras on public.bookings;
create trigger protect_paid_cleaning_extras
before update of cleaning_extras on public.bookings
for each row execute function public.protect_cleaning_extras();

create or replace function public.cleaning_extras_checkout_ready()
returns boolean
language sql
security definer
set search_path = public
as $function$
  select exists (
    select 1 from pg_trigger
    where tgrelid = 'public.bookings'::regclass
      and tgname = 'a_copy_checkout_cleaning_extras' and tgenabled = 'O'
  );
$function$;
revoke all on function public.cleaning_extras_checkout_ready() from public, anon, authenticated;
grant execute on function public.cleaning_extras_checkout_ready() to service_role;
revoke all on function public.copy_checkout_cleaning_extras() from public, anon, authenticated;
revoke all on function public.protect_cleaning_extras() from public, anon, authenticated;

-- Include private quote images in the existing resumable deletion workflow.
create or replace function public.include_quote_erasure_files()
returns trigger
language plpgsql security definer set search_path = public
as $function$
begin
  new.files := new.files || coalesce((
    select jsonb_agg(jsonb_build_object('bucket', bucket_id, 'path', name))
    from storage.objects
    where bucket_id = 'property-maintenance-quotes'
      and starts_with(name, new.user_id::text || '/')
  ), '[]'::jsonb);
  update public.handyman_quote_requests
  set photos = '[]'::jsonb, full_name = 'Deleted account',
      email = new.user_id::text || '@deleted.invalid', phone = '',
      address = '', postcode = '', description = '', admin_notes = null
  where customer_id = new.user_id;
  return new;
end;
$function$;
revoke all on function public.include_quote_erasure_files() from public, anon, authenticated;
drop trigger if exists include_private_quote_files on public.account_erasure_jobs;
create trigger include_private_quote_files
before insert on public.account_erasure_jobs
for each row execute function public.include_quote_erasure_files();

-- Photos are private: application routes authorise their customer/admin access.
alter table public.handyman_quote_requests
  add column if not exists photos jsonb not null default '[]'::jsonb;
alter table public.provider_profile_settings
  add column if not exists maintenance_tasks text[] not null default '{}'::text[];
update public.provider_profile_settings as settings
set maintenance_tasks = tasks.names
from (
  select provider_id, array_agg(task_name order by task_name) as names
  from public.provider_task_rates
  group by provider_id
) as tasks
where tasks.provider_id = settings.provider_id;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('property-maintenance-quotes', 'property-maintenance-quotes', false, 1048576, array['image/jpeg'])
on conflict (id) do nothing;

-- Keep database-backed FAQ wording aligned without altering service categories.
update public.faqs
set question = replace(replace(question, 'Handyman', 'Property maintenance'), 'handyman', 'property maintenance'),
    answer = replace(replace(answer, 'Handyman', 'Property maintenance'), 'handyman', 'property maintenance')
where category = 'handyman';
update public.faqs
set answer = 'You can supply your own products or select "Cleaner brings products" for £5 per visit. Equipment is arranged separately. Add-ons are priced separately and each includes up to one hour within the eight-hour visit limit.'
where lower(question) like '%products%' and category <> 'handyman';

commit;
notify pgrst, 'reload schema';
