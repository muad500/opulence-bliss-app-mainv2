-- Professional work tools require approval; no accounts or verification records are changed.
begin;

create or replace function public.save_my_professional_availability(p_periods jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  professional_id uuid;
  period jsonb;
  day_number integer;
  start_value time;
  end_value time;
  seen_days integer[] := '{}';
begin
  if (select auth.uid()) is null then raise exception 'Sign in to save availability'; end if;
  select id into professional_id from public.providers where profile_id = (select auth.uid()) and vetting_status = 'approved' and is_suspended = false limit 1;
  if professional_id is null then raise exception 'Professional approval is required before changing availability'; end if;
  if p_periods is null or jsonb_typeof(p_periods) <> 'array' or jsonb_array_length(p_periods) > 7 then
    raise exception 'Invalid weekly availability';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('professional-schedule:' || professional_id::text, 0));
  delete from public.provider_availability where provider_id = professional_id;
  for period in select value from jsonb_array_elements(p_periods) as item(value) loop
    if jsonb_typeof(period) <> 'object'
       or coalesce(period->>'weekday', '') !~ '^[0-6]$'
       or coalesce(period->>'start_time', '') !~ '^(0[7-9]|1[0-9]|20):00$'
       or coalesce(period->>'end_time', '') !~ '^(0[8-9]|1[0-9]|20|21):00$' then
      raise exception 'Invalid working hours';
    end if;
    day_number := (period->>'weekday')::integer;
    if day_number = any(seen_days) then raise exception 'Duplicate weekday'; end if;
    seen_days := array_append(seen_days, day_number);
    start_value := (period->>'start_time')::time;
    end_value := (period->>'end_time')::time;
    if end_value <= start_value then raise exception 'Working hours must end after they start'; end if;
    insert into public.provider_availability(provider_id, weekday, start_time, end_time)
      values (professional_id, day_number, start_value, end_value);
  end loop;
  insert into public.provider_profile_settings(provider_id, availability_configured, updated_at)
    values (professional_id, true, now())
    on conflict (provider_id) do update
      set availability_configured = true, updated_at = excluded.updated_at;
end
$fn$;
revoke all on function public.save_my_professional_availability(jsonb) from public, anon, service_role;
grant execute on function public.save_my_professional_availability(jsonb) to authenticated;

-- Also protect direct authenticated table writes. Application schedules saved
-- by the signup service, and administrator changes, are unaffected.
create or replace function public.guard_approved_professional_schedule()
returns trigger
language plpgsql security definer set search_path = public
as $guard$
declare professional_id uuid;
begin
  if auth.role() = 'authenticated' and not public.is_admin() then
    if tg_op = 'DELETE' then professional_id := old.provider_id;
    else professional_id := new.provider_id; end if;
    if not exists (select 1 from public.providers p where p.id = professional_id
      and p.profile_id = auth.uid() and p.vetting_status = 'approved' and p.is_suspended = false) then
      raise exception 'Professional approval is required before changing availability' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and new.provider_id is distinct from old.provider_id then
      raise exception 'Professional schedule ownership cannot be changed' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $guard$;
revoke all on function public.guard_approved_professional_schedule() from public, anon, authenticated;
drop trigger if exists approved_professional_schedule on public.provider_availability;
create trigger approved_professional_schedule
before insert or update or delete on public.provider_availability
for each row execute function public.guard_approved_professional_schedule();

commit;
