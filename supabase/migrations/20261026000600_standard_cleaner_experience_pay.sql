begin;

create table public.cleaner_experience_clocks (
  provider_id uuid primary key references public.providers(id),
  started_at timestamptz not null,
  last_completed_at timestamptz not null,
  check(last_completed_at>=started_at)
);
create table public.booking_cleaner_pay_terms (
  booking_id uuid not null references public.bookings(id),
  provider_id uuid not null references public.providers(id),
  hourly_pence integer not null check(hourly_pence between 1 and 10000),
  experience_started_at timestamptz,
  last_completed_at timestamptz,
  effective_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key(booking_id,provider_id)
);
alter table public.cleaner_experience_clocks enable row level security;
alter table public.booking_cleaner_pay_terms enable row level security;
revoke all on public.cleaner_experience_clocks,public.booking_cleaner_pay_terms from public,anon,authenticated;
grant select on public.cleaner_experience_clocks,public.booking_cleaner_pay_terms to authenticated;
grant select on public.cleaner_experience_clocks,public.booking_cleaner_pay_terms to service_role;
create policy "own experience clock" on public.cleaner_experience_clocks for select to authenticated
  using(provider_id=public.current_provider_id() or public.is_admin());
create policy "own agreed pay" on public.booking_cleaner_pay_terms for select to authenticated
  using(provider_id=public.current_provider_id() or public.is_admin());

-- Calendar months, not a rounded number of days. The sixth month starts five
-- months after the first completion, and the thirteenth starts after twelve.
create function public.standard_cleaner_experience_rate(
  p_base integer,p_start timestamptz,p_last timestamptz,p_at timestamptz
) returns integer language sql immutable set search_path=public as $fn$
  select case when p_base<>1500 or p_start is null or p_last is null
      or p_at>=p_last+interval '90 days' or p_at<p_start then p_base
    when (p_at at time zone 'Europe/London') >= (p_start at time zone 'Europe/London')+interval '12 months' then 1550
    when (p_at at time zone 'Europe/London') >= (p_start at time zone 'Europe/London')+interval '5 months' then 1525
    else 1500 end;
$fn$;

-- Small durable clock survives normal two-year check-in retention. Replaying
-- an older completion cannot move the clock backwards or reset tenure.
create function public.advance_cleaner_experience(p_provider uuid,p_completed timestamptz)
returns void language plpgsql security definer set search_path=public as $fn$
begin
  insert into public.cleaner_experience_clocks(provider_id,started_at,last_completed_at)
  values(p_provider,p_completed,p_completed)
  on conflict(provider_id) do update set
    started_at=case when excluded.last_completed_at>=cleaner_experience_clocks.last_completed_at+interval '90 days'
      then excluded.last_completed_at else cleaner_experience_clocks.started_at end,
    last_completed_at=excluded.last_completed_at
  where excluded.last_completed_at>cleaner_experience_clocks.last_completed_at;
end
$fn$;
revoke all on function public.advance_cleaner_experience(uuid,timestamptz) from public,anon,authenticated,service_role;

-- No historical payout is recalculated. Existing completed work only seeds
-- the experience clock from its recorded completion (or historic job end).
do $backfill$
declare row record;
begin
  for row in
    select b.provider_id,coalesce(
      (select min(e.created_at) from public.booking_events e where e.booking_id=b.id and e.to_status='completed'),
      b.retention_ended_at,b.scheduled_at+make_interval(mins=>b.duration_minutes)) as completed
    from public.bookings b where b.status::text='completed' and b.provider_id is not null
    order by completed,b.id
  loop
    perform public.advance_cleaner_experience(row.provider_id,row.completed);
  end loop;
end
$backfill$;

create function public.effective_booking_cleaner_hourly_pence(p_booking uuid)
returns integer language sql stable security definer set search_path=public as $fn$
  select coalesce(s.hourly_pence,(t.terms->>'cleanerHourlyPence')::integer)
  from public.booking_cleaning_billing_terms t join public.bookings b on b.id=t.booking_id
  left join public.booking_cleaner_pay_terms s on s.booking_id=b.id and s.provider_id=b.provider_id
  where b.id=p_booking;
$fn$;
revoke all on function public.effective_booking_cleaner_hourly_pence(uuid) from public,anon,authenticated;
grant execute on function public.effective_booking_cleaner_hourly_pence(uuid) to service_role;

create function public.snapshot_assigned_cleaner_pay()
returns trigger language plpgsql security definer set search_path=public as $fn$
declare v_base integer; v_deep boolean; v_clock public.cleaner_experience_clocks;
begin
  if new.provider_id is null then return new; end if;
  if new.provider_id is not distinct from old.provider_id
    and not(new.status::text='completed' and old.status::text<>'completed') then return new; end if;
  select (t.terms->>'cleanerHourlyPence')::integer,
    p.name in ('Signature Deep Clean','End of Tenancy / Move-In Clean')
  into v_base,v_deep from public.booking_cleaning_billing_terms t
    join public.packages p on p.id=new.package_id where t.booking_id=new.id;
  if v_base is not null and new.provider_id is distinct from old.provider_id
    and not exists(select 1 from public.payouts where booking_id=new.id) then
    perform 1 from public.providers where id=new.provider_id for update;
    select * into v_clock from public.cleaner_experience_clocks where provider_id=new.provider_id;
    insert into public.booking_cleaner_pay_terms
      (booking_id,provider_id,hourly_pence,experience_started_at,last_completed_at,effective_at)
    values(new.id,new.provider_id,case when v_deep then v_base else
      public.standard_cleaner_experience_rate(v_base,v_clock.started_at,v_clock.last_completed_at,now()) end,
      v_clock.started_at,v_clock.last_completed_at,now())
    on conflict do nothing;
    -- Allocation, settlement and cancellation all read this SAME snapshot.
    update public.payments set split_breakdown=split_breakdown where booking_id=new.id and coalesce(kind,'')<>'tip';
  end if;
  if new.status::text='completed' and old.status::text<>'completed' then
    perform public.advance_cleaner_experience(new.provider_id,now());
  end if;
  return new;
end
$fn$;
revoke all on function public.snapshot_assigned_cleaner_pay() from public,anon,authenticated,service_role;
create trigger assigned_cleaner_pay after update of provider_id,status on public.bookings
  for each row execute function public.snapshot_assigned_cleaner_pay();

-- Surgical substitutions preserve the reviewed refund/transfer state machines.
do $migration$
declare v_source text; v_name text;
begin
  foreach v_name in array array['public.set_cleaning_payment_allocation()','public.snapshot_cleaning_cancellation()'] loop
    select pg_get_functiondef(v_name::regprocedure) into v_source;
    if strpos(v_source,'(v_terms->>''cleanerHourlyPence'')::numeric')=0 then
      raise exception 'Cleaner pay calculation changed; review %',v_name;
    end if;
    execute replace(v_source,'(v_terms->>''cleanerHourlyPence'')::numeric',
      'public.effective_booking_cleaner_hourly_pence(new.booking_id)::numeric');
  end loop;
  select pg_get_functiondef('public.set_cleaning_payment_allocation()'::regprocedure) into v_source;
  execute replace(v_source,'''cleaner_hourly_pence'',(v_terms->>''cleanerHourlyPence'')::integer',
    '''cleaner_hourly_pence'',public.effective_booking_cleaner_hourly_pence(new.booking_id)');
end
$migration$;

commit;
