-- AUTHORISED PRODUCTION ONLY: uiqcsihgqaktpjumyeap.
-- User approved actual production deletion on 26 October 2026.
-- Every assertion precedes COMMIT; any failure rolls deletion and enablement back.
begin isolation level repeatable read;
set local lock_timeout='10s';
set local statement_timeout='55s';

-- Take table locks BEFORE the first data snapshot: new cases, holds and
-- booking changes cannot race this bounded verification transaction.
lock table public.account_incidents, public.bookings,
  public.booking_checkout_time_choices, public.customer_addresses,
  public.data_retention_control, public.data_retention_holds,
  public.handyman_disputes, public.profiles, public.providers,
  public.regular_booking_series, public.review_cases
in share row exclusive mode;
select pg_advisory_xact_lock(181946,2601);

create temporary table retention_activation_result(result jsonb) on commit drop;
create temporary table retention_activation_candidates on commit drop as
  select c.* from public.retention_candidates() c
  where not public.retention_has_hold(c.scope);

do $guard$
begin
  if not exists(select 1 from public.data_retention_control where id
    and not enabled and storage_origin='https://uiqcsihgqaktpjumyeap.supabase.co') then
    raise exception 'Expected disabled PRODUCTION control missing; stop';
  end if;
  if (select count(*) from retention_activation_candidates)<>7
    or exists(select 1 from retention_activation_candidates
      where category<>'access_instructions' or jsonb_array_length(files)<>0) then
    raise exception 'Approved 7-record scope changed; stop';
  end if;
  if exists(select 1 from retention_activation_candidates c
    join public.bookings b on b.id::text=c.entity_id
    where b.status::text not in('completed','cancelled')
      or b.scheduled_at>now() or public.retention_contract_end(b.id)>now()
      or public.retention_has_hold(jsonb_build_object('booking',b.id))) then
    raise exception 'An active, future or protected booking entered the deletion scope';
  end if;
  if exists(select 1 from public.data_retention_file_tasks where status in('pending','processing')) then
    raise exception 'Unexpected pending file work; stop';
  end if;
  if (select count(*) from public.profiles where lower(email)='syedmouad+admin@gmail.com'
    and role::text='admin' and account_deleted_at is null)<>1 then
    raise exception 'Expected production administrator missing or ambiguous';
  end if;
end
$guard$;

-- Store fingerprints only, never copies of private address/access values.
create temporary table retention_activation_bookings on commit drop as
select b.id, md5(to_jsonb(b)::text) as whole_hash,
  md5((to_jsonb(b)-array['access_instructions','household_notes','updated_at'])::text) as other_hash,
  exists(select 1 from retention_activation_candidates c where c.entity_id=b.id::text) as eligible,
  public.retention_has_hold(jsonb_build_object('booking',b.id)) as held,
  b.status::text not in('completed','cancelled') as active,
  b.scheduled_at>now() as future
from public.bookings b;

create temporary table retention_activation_addresses on commit drop as
select a.id, md5(to_jsonb(a)::text) as whole_hash,
  md5((to_jsonb(a)-array['access_instructions','updated_at'])::text) as other_hash,
  not public.retention_has_hold(jsonb_build_object('user',a.user_id))
  and not exists(select 1 from public.bookings b where b.customer_id=a.user_id
    and b.status::text not in('completed','cancelled'))
  and exists(select 1 from retention_activation_candidates c
    join public.bookings b on b.id::text=c.entity_id
    where b.customer_id=a.user_id and a.updated_at<=public.retention_contract_end(b.id)) as eligible
from public.customer_addresses a;

create temporary table retention_activation_checkouts on commit drop as
select c.checkout_session_id, md5(to_jsonb(c)::text) as whole_hash,
  md5(((to_jsonb(c)-array['household_notes','booking_preferences','cleaning_extras','updated_at']) || jsonb_build_object(
  'preferences_without_access',case jsonb_typeof(c.booking_preferences)
    when 'array' then coalesce((select jsonb_agg(case jsonb_typeof(value) when 'object' then value-'accessInstructions' else value end) from jsonb_array_elements(c.booking_preferences)),'[]'::jsonb)
    when 'object' then c.booking_preferences-'accessInstructions' else c.booking_preferences end,
  'extras_without_notes',case jsonb_typeof(c.cleaning_extras)
    when 'array' then coalesce((select jsonb_agg(case jsonb_typeof(value) when 'object' then value-'notes' else value end) from jsonb_array_elements(c.cleaning_extras)),'[]'::jsonb)
    else c.cleaning_extras end))::text) as other_hash,
  exists(select 1 from retention_activation_candidates candidate
    join public.bookings b on b.id::text=candidate.entity_id
    left join public.regular_booking_series series on series.id=b.regular_series_id
    where c.customer_id=b.customer_id
      and c.checkout_session_id=coalesce(series.checkout_session_id,b.checkout_session_id))
  and not exists(select 1 from public.bookings b
    left join public.regular_booking_series series on series.id=b.regular_series_id
    where c.checkout_session_id=coalesce(series.checkout_session_id,b.checkout_session_id)
      and (b.status::text not in('completed','cancelled')
        or public.retention_has_hold(jsonb_build_object('booking',b.id)))) as eligible
from public.booking_checkout_time_choices c;

create temporary table retention_activation_tables(
  table_oid oid primary key, row_count bigint, fingerprint text
) on commit drop;
do $snapshot$
declare item record; total bigint; stamp text;
begin
  for item in select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where (n.nspname='public' or (n.nspname='storage' and c.relname='objects')) and c.relkind in('r','p') and not c.relispartition
      and c.relname not in('bookings','customer_addresses','booking_checkout_time_choices',
        'data_retention_control','data_retention_runs')
  loop
    execute format('select count(*),md5(coalesce(string_agg(stamp, '''' order by stamp),'''')) from (select md5(to_jsonb(row_data)::text) stamp from %s row_data) row_fingerprints',item.oid::regclass)
      into total,stamp;
    insert into retention_activation_tables values(item.oid,total,stamp);
  end loop;
end
$snapshot$;

-- Invoke the same private function used by the scheduled worker. This sets
-- a database request role, not a user token or login session.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update public.data_retention_control set enabled=true,enabled_at=clock_timestamp(),
  enabled_by=(select id from public.profiles where lower(email)='syedmouad+admin@gmail.com'
    and role::text='admin' and account_deleted_at is null)
where id;

insert into retention_activation_result(result)
select jsonb_build_object('first_run',public.run_data_retention(false));

do $verify_first$
declare result jsonb;
begin
  select r.result->'first_run' into result from retention_activation_result r;
  if result->>'dryRun'<>'false' or (result->>'completed')::integer<>7
    or (result->>'access_instructions')::integer<>7
    or (result->>'failed')::integer<>0 or (result->>'queued_files')::integer<>0 then
    raise exception 'First run did not clean exactly the approved 7 records';
  end if;
  if exists(select 1 from retention_activation_candidates c
    left join public.bookings b on b.id::text=c.entity_id
    where b.id is null or b.access_instructions is not null or b.household_notes is not null) then
    raise exception 'An approved access record was not cleared';
  end if;
end
$verify_first$;

update retention_activation_result set result=result||
  jsonb_build_object('second_run',public.run_data_retention(false));

do $verify_all$
declare result jsonb; item record; total bigint; stamp text;
  changed_addresses integer; changed_checkouts integer; checks jsonb;
begin
  select r.result into result from retention_activation_result r;
  if (result->'second_run'->>'candidates')::integer<>0
    or (result->'second_run'->>'completed')::integer<>0
    or (result->'second_run'->>'failed')::integer<>0
    or (result->'second_run'->>'queued_files')::integer<>0
    or result->'second_run'->>'dryRun'<>'false' then
    raise exception 'Second run was not an empty, successful real run';
  end if;
  if exists(select 1 from retention_activation_bookings old
    full join public.bookings b on b.id=old.id
    where old.id is null or b.id is null
      or (not old.eligible and md5(to_jsonb(b)::text)<>old.whole_hash)
      or (old.eligible and md5((to_jsonb(b)-array['access_instructions','household_notes','updated_at'])::text)<>old.other_hash)) then
    raise exception 'A non-approved booking field or protected booking changed';
  end if;
  if exists(select 1 from retention_activation_addresses old
    full join public.customer_addresses a on a.id=old.id
    where old.id is null or a.id is null
      or (not old.eligible and md5(to_jsonb(a)::text)<>old.whole_hash)
      or (old.eligible and md5((to_jsonb(a)-array['access_instructions','updated_at'])::text)<>old.other_hash)) then
    raise exception 'A protected address or non-access address field changed';
  end if;
  if exists(select 1 from retention_activation_checkouts old
    full join public.booking_checkout_time_choices c using(checkout_session_id)
    where old.checkout_session_id is null or c.checkout_session_id is null
      or (not old.eligible and md5(to_jsonb(c)::text)<>old.whole_hash)
      or (old.eligible and md5(((to_jsonb(c)-array['household_notes','booking_preferences','cleaning_extras','updated_at']) || jsonb_build_object(
  'preferences_without_access',case jsonb_typeof(c.booking_preferences)
    when 'array' then coalesce((select jsonb_agg(case jsonb_typeof(value) when 'object' then value-'accessInstructions' else value end) from jsonb_array_elements(c.booking_preferences)),'[]'::jsonb)
    when 'object' then c.booking_preferences-'accessInstructions' else c.booking_preferences end,
  'extras_without_notes',case jsonb_typeof(c.cleaning_extras)
    when 'array' then coalesce((select jsonb_agg(case jsonb_typeof(value) when 'object' then value-'notes' else value end) from jsonb_array_elements(c.cleaning_extras)),'[]'::jsonb)
    else c.cleaning_extras end))::text)<>old.other_hash)) then
    raise exception 'A protected checkout or non-access checkout field changed';
  end if;
  for item in select * from retention_activation_tables loop
    execute format('select count(*),md5(coalesce(string_agg(stamp, '''' order by stamp),'''')) from (select md5(to_jsonb(row_data)::text) stamp from %s row_data) row_fingerprints',item.table_oid::regclass)
      into total,stamp;
    if total<>item.row_count or stamp<>item.fingerprint then
      raise exception 'Unexpected domain data change in %',item.table_oid::regclass;
    end if;
  end loop;
  select count(*) into changed_addresses from retention_activation_addresses old
    join public.customer_addresses a using(id) where md5(to_jsonb(a)::text)<>old.whole_hash;
  select count(*) into changed_checkouts from retention_activation_checkouts old
    join public.booking_checkout_time_choices c using(checkout_session_id) where md5(to_jsonb(c)::text)<>old.whole_hash;
  checks:=jsonb_build_object('approved_bookings_cleared',7,
    'protected_bookings_unchanged',(select count(*) from retention_activation_bookings where held),
    'active_bookings_unchanged',(select count(*) from retention_activation_bookings where active),
    'future_bookings_unchanged',(select count(*) from retention_activation_bookings where future),
    'all_other_bookings_unchanged',(select count(*) from retention_activation_bookings where not eligible),
    'other_domain_tables_unchanged',(select count(*) from retention_activation_tables),
    'eligible_address_copies_changed',changed_addresses,
    'eligible_checkout_copies_changed',changed_checkouts,
    'protected_addresses_and_checkouts_unchanged',true,
    'only_approved_access_fields_changed',true,
    'second_run_deleted_nothing',true);
  update retention_activation_result r set result=r.result||jsonb_build_object('verification',checks);
  update public.data_retention_runs set summary=summary||(
    select jsonb_object_agg('verified_'||key,
      case when jsonb_typeof(value)='boolean'
        then to_jsonb(case when value='true'::jsonb then 1 else 0 end)
        else value end)
    from jsonb_each(checks)
  )
    where id=(result->'first_run'->>'runId')::uuid;
end
$verify_all$;

-- Apply only after approval of Production preview counts and deletion.
-- This does not enable deletion itself. The approved activation transaction
-- installs this helper together with its guarded control change.
create or replace function public.invoke_production_data_retention()
returns bigint language plpgsql security definer
set search_path=public,vault,net as $fn$
declare
  secret text;
  deletion_enabled boolean;
begin
  select enabled into strict deletion_enabled
  from public.data_retention_control
  where id and storage_origin='https://uiqcsihgqaktpjumyeap.supabase.co';

  if exists(select 1 from vault.secrets
    where name='opulence_staging_web_push_cron') then
    raise exception 'Production project marker required';
  end if;

  select decrypted_secret into strict secret
  from vault.decrypted_secrets where name='opulence_cron_secret';
  if coalesce(secret,'')='' then
    raise exception 'Production cron credential unavailable';
  end if;

  return net.http_get(
    url:='https://www.opulencebliss.com/api/cron/data-retention'
      || case when deletion_enabled then '' else '?dry=1' end,
    headers:=jsonb_build_object('Authorization','Bearer '||secret),
    timeout_milliseconds:=55000
  );
end;
$fn$;
revoke all on function public.invoke_production_data_retention()
from public,anon,authenticated,service_role;

-- A single aggregate result is also saved in the ordinary admin-visible log.
select result||jsonb_build_object('enabled',true,'project','uiqcsihgqaktpjumyeap',
  'daily_schedule',(select schedule from cron.job where jobname='opulence-production-data-retention')) as activation_verification
from retention_activation_result;
commit;

select jsonb_build_object('project','uiqcsihgqaktpjumyeap',
  'enabled',(select enabled from public.data_retention_control where id),
  'daily_schedule',(select schedule from cron.job where jobname='opulence-production-data-retention'),
  'scheduler_active',(select active from cron.job where jobname='opulence-production-data-retention'),
  'real_runs',(select jsonb_agg(jsonb_build_object('id',id,'dry_run',dry_run,'summary',summary,'started_at',started_at,'finished_at',finished_at) order by started_at)
    from public.data_retention_runs where not dry_run and started_at>=(select enabled_at from public.data_retention_control where id)),
  'eligible_remaining',(select count(*) from public.retention_candidates() c where not public.retention_has_hold(c.scope))) as committed_verification;


