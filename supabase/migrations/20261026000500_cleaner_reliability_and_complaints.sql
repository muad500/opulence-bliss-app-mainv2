begin;

-- One record for a withdrawal, even if a worker retries the action. Offer
-- declines and customer/system cancellations are deliberately excluded.
create table public.cleaner_reliability_events (
  id bigint generated always as identity primary key,
  provider_id uuid not null references public.providers(id),
  booking_id uuid not null references public.bookings(id),
  kind text not null check (kind in ('cancellation', 'no_show_report')),
  occurred_at timestamptz not null default now(),
  month_start date not null,
  source_event_id bigint references public.booking_events(id),
  review_case_id uuid references public.review_cases(id),
  unique (provider_id, booking_id, kind)
);
create index cleaner_reliability_month on public.cleaner_reliability_events
  (provider_id, month_start, kind);
create table public.cleaner_cancellation_alerts (
  provider_id uuid not null references public.providers(id),
  month_start date not null,
  created_at timestamptz not null default now(),
  primary key (provider_id, month_start)
);
alter table public.cleaner_reliability_events enable row level security;
alter table public.cleaner_cancellation_alerts enable row level security;
revoke all on public.cleaner_reliability_events, public.cleaner_cancellation_alerts
  from public, anon, authenticated;
grant select on public.cleaner_reliability_events to authenticated;
grant all on public.cleaner_reliability_events, public.cleaner_cancellation_alerts to service_role;
grant usage, select on sequence public.cleaner_reliability_events_id_seq to service_role;
create policy "own reliability record" on public.cleaner_reliability_events
  for select to authenticated using (provider_id=public.current_provider_id() or public.is_admin());

create function public.record_cleaner_reliability()
returns trigger language plpgsql security definer set search_path=public as $fn$
declare
  v_provider uuid;
  v_booking uuid;
  v_kind text;
  v_at timestamptz := new.created_at;
  v_month date;
  v_count integer;
  v_source bigint;
  v_case uuid;
begin
  if tg_table_name='booking_events' then
    if new.actor_kind<>'provider' or new.from_status not in ('scheduled','needs_review')
      or new.to_status not in ('offered','cancelled') then return new; end if;
    select id into v_provider from public.providers where profile_id=new.actor_id;
    v_booking:=new.booking_id;
    v_kind:='cancellation';
    v_source:=new.id;
  else
    if new.category<>'worker_no_show' then return new; end if;
    select provider_id into v_provider from public.bookings where id=new.booking_id
      and scheduled_at<=now()
      and not exists(select 1 from public.check_ins where booking_id=new.booking_id and arrived_at is not null);
    v_booking:=new.booking_id;
    v_kind:='no_show_report';
    v_case:=new.id;
  end if;
  if v_provider is null then return new; end if;
  v_month:=date_trunc('month',v_at at time zone 'Europe/London')::date;
  -- Serialise a worker's counters. Concurrent third/fourth cancellations
  -- cannot produce duplicate alerts or lose a count.
  perform 1 from public.providers where id=v_provider for update;
  insert into public.cleaner_reliability_events
    (provider_id,booking_id,kind,month_start,source_event_id,review_case_id,occurred_at)
  values(v_provider,v_booking,v_kind,v_month,v_source,v_case,v_at)
  on conflict(provider_id,booking_id,kind) do nothing;
  if not found then return new; end if;
  if v_kind='cancellation' then
    select count(*) into v_count from public.cleaner_reliability_events
      where provider_id=v_provider and month_start=v_month and kind='cancellation';
    if v_count>=3 then
      insert into public.cleaner_cancellation_alerts(provider_id,month_start)
      values(v_provider,v_month) on conflict do nothing;
      if found then
        insert into public.notifications(user_id,title,body,href)
        select id,'Cleaner cancellation limit reached',
          'A professional has cancelled three accepted visits this month. Review their reliability record.',
          '/admin/worker-operations?provider='||v_provider
        from public.profiles where role::text='admin' and account_deleted_at is null;
      end if;
    end if;
  else
    insert into public.notifications(user_id,title,body,href)
    select id,'Cleaner no-show reported',
      'A missed visit needs review. This report is a flag, not a confirmed finding.',
      '/admin/worker-operations?provider='||v_provider
    from public.profiles where role::text='admin' and account_deleted_at is null;
  end if;
  return new;
end
$fn$;
revoke all on function public.record_cleaner_reliability() from public,anon,authenticated,service_role;
create trigger cleaner_cancellation_counter after insert on public.booking_events
  for each row execute function public.record_cleaner_reliability();
create trigger cleaner_no_show_flag after insert on public.review_cases
  for each row execute function public.record_cleaner_reliability();

-- Include existing withdrawals this month, without sending retrospective
-- alerts or changing anyone's approval or checks.
insert into public.cleaner_reliability_events
  (provider_id,booking_id,kind,month_start,source_event_id,occurred_at)
select distinct on (p.id,e.booking_id) p.id,e.booking_id,'cancellation',
  date_trunc('month',e.created_at at time zone 'Europe/London')::date,e.id,e.created_at
from public.booking_events e join public.providers p on p.profile_id=e.actor_id
where e.actor_kind='provider' and e.from_status in ('scheduled','needs_review')
  and e.to_status in ('offered','cancelled')
  and e.created_at>=date_trunc('month',now() at time zone 'Europe/London') at time zone 'Europe/London'
order by p.id,e.booking_id,e.id
on conflict do nothing;

-- Use the existing private incident log, so complaints inherit its retention
-- lock and resolution rules rather than forming an unprotected parallel log.
alter table public.account_incidents
  add column log_kind text not null default 'incident'
    check(log_kind in ('incident','complaint','breach')),
  add column subject_provider_id uuid references public.providers(id);
create index account_incidents_subject on public.account_incidents(subject_provider_id,status);
create table public.account_incident_history (
  id bigint generated always as identity primary key,
  incident_id uuid not null references public.account_incidents(id),
  actor_id uuid not null references public.profiles(id),
  status text not null,
  note text,
  created_at timestamptz not null default now()
);
alter table public.account_incident_history enable row level security;
revoke all on public.account_incident_history from public,anon,authenticated;
grant select on public.account_incident_history to service_role;
create function public.audit_incident_review()
returns trigger language plpgsql security definer set search_path=public as $fn$
begin
  insert into public.account_incident_history(incident_id,actor_id,status,note)
  values(new.id,coalesce(new.reviewed_by,new.reporter_id),new.status,new.resolution_note);
  return new;
end
$fn$;
revoke all on function public.audit_incident_review() from public,anon,authenticated,service_role;
create trigger incident_review_history after insert or update of status,resolution_note
  on public.account_incidents for each row execute function public.audit_incident_review();

-- Add subject professionals to the existing conservative protection scope.
do $migration$
declare v_source text;
begin
  select pg_get_functiondef('public.retention_has_hold(jsonb)'::regprocedure) into v_source;
  if strpos(v_source,'reporter_id in(select id from scope_users) or booking_id')=0 then
    raise exception 'Retention scope changed; review before applying';
  end if;
  execute replace(v_source,
    'reporter_id in(select id from scope_users) or booking_id',
    'reporter_id in(select id from scope_users) or subject_provider_id in (select id from public.providers where profile_id in(select id from scope_users)) or booking_id');
  select pg_get_functiondef('public.retention_has_hold(jsonb)'::regprocedure) into v_source;
  if strpos(v_source,'reporter_id=(p_scope->>''user'')::uuid')>0 then
    execute replace(v_source,'reporter_id=(p_scope->>''user'')::uuid',
      'reporter_id=(p_scope->>''user'')::uuid or subject_provider_id in (select id from public.providers where profile_id=(p_scope->>''user'')::uuid)');
  end if;
end
$migration$;

commit;
