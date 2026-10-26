-- No deletion on migration. Explicit enablement follows a reviewed dry run.
begin;

create table public.data_retention_control (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  storage_origin text check (storage_origin in (
    'https://comwdjprdedmsnxtvuuk.supabase.co',
    'https://uiqcsihgqaktpjumyeap.supabase.co'
  )),
  enabled_at timestamptz,
  enabled_by uuid references public.profiles(id)
);
insert into public.data_retention_control(id) values (true);

create table public.data_retention_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  dry_run boolean not null,
  transaction_id bigint not null default txid_current(),
  summary jsonb not null default '{}'
);
create table public.data_retention_holds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  booking_id uuid references public.bookings(id),
  handyman_job_id uuid references public.handyman_jobs(id),
  enquiry_id uuid references public.handyman_quote_requests(id),
  reason text not null check (length(btrim(reason)) between 10 and 1000),
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_by uuid references public.profiles(id),
  resolved_by uuid references public.profiles(id),
  resolution_reason text,
  check (num_nonnulls(user_id, booking_id, handyman_job_id, enquiry_id) = 1)
);
create table public.data_retention_file_tasks (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  entity_id text not null,
  scope jsonb not null,
  files jsonb not null,
  status text not null default 'pending' check (status in ('pending','processing','done','obsolete')),
  attempts integer not null default 0,
  claim_token uuid,
  leased_until timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  last_error text,
  unique(category, entity_id)
);
create index retention_files_pending on public.data_retention_file_tasks(created_at)
  where status in ('pending','processing');

do $permissions$
declare t text;
begin
  foreach t in array array['data_retention_control','data_retention_runs','data_retention_holds','data_retention_file_tasks'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public,anon,authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end;
$permissions$;

alter table public.providers add column retention_left_at timestamptz,
  add column retention_rejected_at timestamptz,
  add column retention_ever_approved boolean not null default false;
alter table public.bookings add column retention_ended_at timestamptz;
alter table public.handyman_jobs add column retention_ended_at timestamptz;

-- Unknown historical rejection dates start their clock now, never at signup.
update public.providers p set
  retention_left_at = u.account_deleted_at,
  retention_ever_approved = p.vetting_status::text = 'approved'
    or p.service_approvals::text like '%approved%'
    or exists(select 1 from public.bookings b where b.provider_id=p.id and b.status::text='completed'),
  retention_rejected_at = case when p.vetting_status::text='rejected' then now() end
from public.profiles u where u.id=p.profile_id;
update public.bookings set retention_ended_at=scheduled_at + make_interval(mins=>coalesce(duration_minutes,120))
  where status::text in ('completed','cancelled');
update public.handyman_jobs set retention_ended_at=coalesce(ended_at,updated_at,scheduled_at)
  where status in ('completed','cancelled');

create function public.track_retention_lifecycle()
returns trigger language plpgsql security definer set search_path=public as $fn$
begin
  if tg_table_name='profiles' then
    if new.account_deleted_at is not null then
      update public.providers set retention_left_at=new.account_deleted_at where profile_id=new.id;
    end if;
  elsif tg_table_name='providers' then
    new.retention_ever_approved := old.retention_ever_approved or new.vetting_status::text='approved'
      or new.service_approvals::text like '%approved%';
    if new.vetting_status::text='rejected' and old.vetting_status::text<>'rejected' then
      new.retention_rejected_at:=now();
    elsif new.vetting_status::text<>'rejected' then
      new.retention_rejected_at:=null;
    end if;
  else
    if new.status::text in ('completed','cancelled') and old.status::text not in ('completed','cancelled') then
      new.retention_ended_at:=now();
    elsif new.status::text not in ('completed','cancelled') then
      new.retention_ended_at:=null;
    end if;
  end if;
  return new;
end;
$fn$;
create trigger retention_profile_closure after update of account_deleted_at on public.profiles
  for each row execute function public.track_retention_lifecycle();
create trigger retention_professional_lifecycle before update on public.providers
  for each row execute function public.track_retention_lifecycle();
create trigger retention_booking_end before update of status on public.bookings
  for each row execute function public.track_retention_lifecycle();
create trigger retention_handyman_end before update of status on public.handyman_jobs
  for each row execute function public.track_retention_lifecycle();

-- One contract ends only when every visit in that regular series is terminal.
create function public.retention_contract_end(p_booking uuid)
returns timestamptz language sql stable security definer set search_path=public as $fn$
  select case when bool_and(b.status::text in ('completed','cancelled')) then max(b.retention_ended_at) end
  from public.bookings root join public.bookings b
    on b.id=root.id or (root.regular_series_id is not null and b.regular_series_id=root.regular_series_id)
  where root.id=p_booking;
$fn$;

-- Conservative association: a person's open case protects their records and
-- every linked booking. A case on one series visit protects the whole series.
create function public.retention_has_hold(p_scope jsonb)
returns boolean language sql stable security definer set search_path=public as $fn$
  with scope_users as (
    select (p_scope->>'user')::uuid id where p_scope ? 'user'
    union select profile_id from public.providers where id=(p_scope->>'provider')::uuid
    union select customer_id from public.bookings where id=(p_scope->>'booking')::uuid
    union select p.profile_id from public.bookings b join public.providers p on p.id=b.provider_id where b.id=(p_scope->>'booking')::uuid
    union select customer_id from public.handyman_jobs where id=(p_scope->>'handyman')::uuid
    union select p.profile_id from public.handyman_jobs j join public.providers p on p.id=j.provider_id where j.id=(p_scope->>'handyman')::uuid
    union select customer_id from public.handyman_quote_requests where id=(p_scope->>'enquiry')::uuid
  ), scope_bookings as (
    select b.id from public.bookings b left join public.providers p on p.id=b.provider_id
    where b.id=(p_scope->>'booking')::uuid or b.customer_id in(select id from scope_users)
      or p.profile_id in(select id from scope_users)
      or b.regular_series_id=(select regular_series_id from public.bookings where id=(p_scope->>'booking')::uuid)
  ), scope_jobs as (
    select j.id from public.handyman_jobs j left join public.providers p on p.id=j.provider_id
    where j.id=(p_scope->>'handyman')::uuid or j.customer_id in(select id from scope_users)
      or p.profile_id in(select id from scope_users)
  )
  select exists(select 1 from public.review_cases where status<>'resolved' and booking_id in(select id from scope_bookings))
    or exists(select 1 from public.account_incidents where status<>'resolved'
      and (reporter_id in(select id from scope_users) or booking_id in(select id from scope_bookings)))
    or exists(select 1 from public.handyman_disputes where status<>'resolved' and job_id in(select id from scope_jobs))
    or exists(select 1 from public.data_retention_holds where resolved_at is null and (
      user_id in(select id from scope_users) or booking_id in(select id from scope_bookings)
      or handyman_job_id in(select id from scope_jobs) or enquiry_id=(p_scope->>'enquiry')::uuid));
$fn$;

create function public.serialise_retention_holds()
returns trigger language plpgsql security definer set search_path=public as $fn$
begin
  perform pg_advisory_xact_lock(181946,2601);
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$fn$;
create trigger retention_case_lock before insert or update or delete on public.review_cases
  for each row execute function public.serialise_retention_holds();
create trigger retention_incident_lock before insert or update or delete on public.account_incidents
  for each row execute function public.serialise_retention_holds();
create trigger retention_dispute_lock before insert or update or delete on public.handyman_disputes
  for each row execute function public.serialise_retention_holds();
create trigger retention_manual_hold_lock before insert or update or delete on public.data_retention_holds
  for each row execute function public.serialise_retention_holds();

create function public.retention_candidates()
returns table(category text,entity_id text,scope jsonb,files jsonb)
language sql stable security definer set search_path=public,storage as $fn$
  select 'emergency_contacts',p.id::text,jsonb_build_object('provider',p.id),'[]'::jsonb
    from public.providers p join public.provider_profile_settings s on s.provider_id=p.id
    where p.retention_left_at<=now()-interval '6 months'
      and (s.emergency_contact_name is not null or s.emergency_contact_phone is not null)
  union all
  select 'dbs_outcomes',d.provider_id::text,jsonb_build_object('provider',d.provider_id),'[]'::jsonb
    from public.provider_dbs_checks d join public.providers p on p.id=d.provider_id
    join public.profiles u on u.id=p.profile_id
    where u.account_deleted_at<=now()-interval '6 months' and d.certificate_storage_path is null
  union all
  select 'dbs_copies',d.provider_id::text,jsonb_build_object('provider',d.provider_id),
    jsonb_build_array(jsonb_build_object('bucket','provider-dbs','path',d.certificate_storage_path))
    from public.provider_dbs_checks d where d.certificate_storage_path is not null
      and coalesce(d.uploaded_at,d.submitted_at)<=now()-interval '6 months'
  union all
  select 'dbs_copies',o.id::text,jsonb_build_object('provider',(split_part(o.name,'/',1))::uuid),
    jsonb_build_array(jsonb_build_object('bucket',o.bucket_id,'path',o.name))
    from storage.objects o where o.bucket_id='provider-dbs' and o.created_at<=now()-interval '6 months'
      and split_part(o.name,'/',1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and not exists(select 1 from public.provider_dbs_checks d where d.certificate_storage_path=o.name)
  union all
  select 'check_ins',c.id::text,jsonb_build_object('booking',c.booking_id,'type','checkin'),'[]'::jsonb
    from public.check_ins c join public.bookings b on b.id=c.booking_id
    where c.created_at<=now()-interval '2 years' and b.status::text in('completed','cancelled')
  union all
  select 'check_ins',c.id::text,jsonb_build_object('booking',c.booking_id,'type','challenge'),'[]'::jsonb
    from public.check_in_challenges c join public.bookings b on b.id=c.booking_id
    where c.created_at<=now()-interval '2 years' and b.status::text in('completed','cancelled')
  union all
  select 'check_ins',c.id::text,jsonb_build_object('booking',c.booking_id,'type','challenge_event'),'[]'::jsonb
    from public.check_in_challenge_events c join public.bookings b on b.id=c.booking_id
    where c.created_at<=now()-interval '2 years' and b.status::text in('completed','cancelled')
  union all
  select 'messages',m.id::text,jsonb_build_object('booking',m.booking_id),
    coalesce((select jsonb_agg(jsonb_build_object('bucket','booking-attachments','path',a.path))
      from public.booking_message_attachments a where a.message_id=m.id),'[]'::jsonb)
    from public.booking_messages m join public.bookings b on b.id=m.booking_id
    where m.created_at<=now()-interval '2 years' and b.status::text in('completed','cancelled')
  union all
  select 'job_photos',a.message_id::text,jsonb_build_object('booking',b.id,'type','chat'),
    jsonb_build_array(jsonb_build_object('bucket','booking-attachments','path',a.path))
    from public.booking_message_attachments a join public.booking_messages m on m.id=a.message_id
    join public.bookings b on b.id=m.booking_id
    where b.status::text in('completed','cancelled') and b.retention_ended_at<=now()-interval '12 months'
  union all
  select 'job_photos',f.id::text,jsonb_build_object('handyman',j.id,'type','handyman'),
    jsonb_build_array(jsonb_build_object('bucket','handyman-job-files','path',f.storage_path))
    from public.handyman_files f join public.handyman_jobs j on j.id=f.job_id
    where f.kind='photo' and j.status in('completed','cancelled') and j.retention_ended_at<=now()-interval '12 months'
  union all
  select 'unsuccessful_applicants',p.id::text,jsonb_build_object('provider',p.id),
    coalesce((select jsonb_agg(jsonb_build_object('bucket',o.bucket_id,'path',o.name)) from storage.objects o
      where o.bucket_id in('provider-verification','provider-dbs') and starts_with(o.name,p.id::text||'/')),'[]'::jsonb)
    from public.providers p where p.vetting_status::text='rejected' and not p.retention_ever_approved
      and p.retention_rejected_at<=now()-interval '6 months'
      and exists(select 1 from public.provider_onboarding_details d where d.provider_id=p.id)
      and not exists(select 1 from public.bookings b where b.provider_id=p.id)
      and not exists(select 1 from public.handyman_jobs j where j.provider_id=p.id)
  union all
  select 'enquiries',q.id::text,jsonb_build_object('enquiry',q.id),
    coalesce((select jsonb_agg(jsonb_build_object('bucket','property-maintenance-quotes','path',photo->>'path'))
      from jsonb_array_elements(q.photos) photo where photo ? 'path'),'[]'::jsonb)
    from public.handyman_quote_requests q where q.created_at<=now()-interval '12 months'
      and q.status<>'accepted'
  union all
  select 'incidents',i.id::text,jsonb_strip_nulls(jsonb_build_object('user',i.reporter_id,'booking',i.booking_id,'type','incident')),'[]'::jsonb
    from public.account_incidents i where i.status='resolved' and i.reviewed_at<=now()-interval '6 years'
  union all
  select 'incidents',c.id::text,jsonb_build_object('booking',c.booking_id,'type','case'),'[]'::jsonb
    from public.review_cases c where c.status='resolved' and c.resolved_at<=now()-interval '6 years'
  union all
  select 'incidents',h.id::text,jsonb_strip_nulls(jsonb_build_object('user',h.user_id,'booking',h.booking_id,
    'handyman',h.handyman_job_id,'enquiry',h.enquiry_id,'type','hold')),'[]'::jsonb
    from public.data_retention_holds h where h.resolved_at<=now()-interval '6 years'
  union all
  select 'business_records',b.id::text,jsonb_build_object('booking',b.id),
    coalesce((select jsonb_agg(jsonb_build_object('bucket','booking-attachments','path',a.path))
      from public.booking_message_attachments a join public.booking_messages m on m.id=a.message_id
      join public.bookings linked on linked.id=m.booking_id
      where linked.id=b.id or (b.regular_series_id is not null and linked.regular_series_id=b.regular_series_id)),'[]'::jsonb)
    from public.bookings b where public.retention_contract_end(b.id)<=now()-interval '6 years'
  union all
  select 'business_records',j.id::text,jsonb_build_object('handyman',j.id),
    coalesce((select jsonb_agg(jsonb_build_object('bucket','handyman-job-files','path',f.storage_path))
      from public.handyman_files f where f.job_id=j.id),'[]'::jsonb)
    from public.handyman_jobs j where j.status in('completed','cancelled') and j.retention_ended_at<=now()-interval '6 years'
  union all
  select 'access_instructions',b.id::text,jsonb_build_object('booking',b.id),'[]'::jsonb
    from public.bookings b where public.retention_contract_end(b.id)<=now()
      and (b.access_instructions is not null or b.household_notes is not null)
$fn$;

-- Only the running, owner-executed retention transaction may remove immutable
-- historical records. Authenticated users cannot opt into this exception.
create function public.retention_delete_authorised()
returns boolean language sql stable set search_path=public as $fn$
  select current_user=pg_get_userbyid((select relowner from pg_class where oid='public.data_retention_runs'::regclass))
    and exists(select 1 from public.data_retention_runs where id=nullif(current_setting('opulence.retention_run',true),'')::uuid
      and transaction_id=txid_current() and not dry_run and finished_at is null);
$fn$;

-- Remove a closed business aggregate in FK order, including receipts, outboxes
-- and saved legal evidence. No Stripe calls. No other customer's rows.
create function public.retention_delete_tree(p_roots jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $fn$
declare item record; fk record; child record; pk text[]; predicate text;
  remaining integer; progress integer; removed integer; previous integer;
begin
  if not public.retention_delete_authorised() then raise exception 'Retention transaction required'; end if;
  create temporary table if not exists retention_delete_rows(
    table_oid oid, key jsonb, expanded boolean not null default false, primary key(table_oid,key)
  ) on commit drop;
  truncate pg_temp.retention_delete_rows;
  insert into pg_temp.retention_delete_rows(table_oid,key)
    select (r->>'table')::regclass,r->'key' from jsonb_array_elements(p_roots) r on conflict do nothing;
  loop
    select * into item from pg_temp.retention_delete_rows where not expanded limit 1;
    exit when not found;
    for fk in select c.conrelid,c.conkey,c.confkey from pg_constraint c
      join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
      where c.contype='f' and c.confrelid=item.table_oid and n.nspname='public'
    loop
      select array_agg(a.attname order by u.ord) into pk from pg_index i
        cross join lateral unnest(i.indkey) with ordinality u(attnum,ord)
        join pg_attribute a on a.attrelid=i.indrelid and a.attnum=u.attnum
        where i.indrelid=fk.conrelid and i.indisprimary;
      if pk is null then raise exception 'Dependent table needs a retention adapter'; end if;
      select string_agg(format('child.%I = parent.%I',ca.attname,pa.attname),' and ' order by u.ord) into predicate
        from unnest(fk.conkey,fk.confkey) with ordinality u(child_num,parent_num,ord)
        join pg_attribute ca on ca.attrelid=fk.conrelid and ca.attnum=u.child_num
        join pg_attribute pa on pa.attrelid=item.table_oid and pa.attnum=u.parent_num;
      for child in execute format('select to_jsonb(child) value from %s child join %s parent on %s where to_jsonb(parent) @> $1',fk.conrelid::regclass,item.table_oid::regclass,predicate) using item.key
      loop
        insert into pg_temp.retention_delete_rows(table_oid,key)
          select fk.conrelid,jsonb_object_agg(k,child.value->k) from unnest(pk) k
          on conflict do nothing;
      end loop;
    end loop;
    update pg_temp.retention_delete_rows set expanded=true where table_oid=item.table_oid and key=item.key;
  end loop;
  -- Retrying table-level deletes handles self references in one statement and
  -- never disables constraints or triggers. A cycle fails closed and is logged.
  loop
    progress:=0;
    select count(*) into previous from pg_temp.retention_delete_rows;
    exit when previous=0;
    for item in select distinct table_oid from pg_temp.retention_delete_rows loop
      begin
        execute format('delete from %s target where exists(select 1 from pg_temp.retention_delete_rows q where q.table_oid=$1 and to_jsonb(target) @> q.key)',item.table_oid::regclass) using item.table_oid;
        get diagnostics removed=row_count;
        delete from pg_temp.retention_delete_rows where table_oid=item.table_oid;
        progress:=progress+removed;
      exception when foreign_key_violation then null;
      end;
    end loop;
    select count(*) into remaining from pg_temp.retention_delete_rows;
    if remaining>=previous and progress=0 then raise exception 'Business aggregate retention needs attention'; end if;
  end loop;
end;
$fn$;

create function public.retention_delete_business(p_booking uuid,p_handyman boolean default false)
returns void language plpgsql security definer set search_path=public,pg_temp as $fn$
declare item record; fk record; child record; pk text[]; predicate text;
  series uuid; consent uuid; roots jsonb:='[]'::jsonb;
begin
  if not public.retention_delete_authorised() then raise exception 'Retention transaction required'; end if;
  if p_handyman then
    if not exists(select 1 from public.handyman_jobs where id=p_booking and status in('completed','cancelled')
      and retention_ended_at<=now()-interval '6 years')
      or public.retention_has_hold(jsonb_build_object('handyman',p_booking)) then raise exception 'Business record must be retained'; end if;
  elsif public.retention_contract_end(p_booking)>now()-interval '6 years'
    or public.retention_contract_end(p_booking) is null
    or public.retention_has_hold(jsonb_build_object('booking',p_booking)) then raise exception 'Business record must be retained'; end if;
  if p_handyman then
    -- Break only the expired aggregate's quote-selection cycle. FK checks and
    -- financial triggers otherwise remain active throughout deletion.
    update public.handyman_jobs set selected_quote_id=null,pending_quote_id=null where id=p_booking;
    roots:=roots||jsonb_build_array(jsonb_build_object('table','public.handyman_jobs','key',jsonb_build_object('id',p_booking)));
  else
    select regular_series_id into series from public.bookings where id=p_booking;
    if series is null then
    roots:=roots||jsonb_build_array(jsonb_build_object('table','public.bookings','key',jsonb_build_object('id',p_booking)));
    else
    roots:=roots||jsonb_build_array(jsonb_build_object('table','public.regular_booking_series','key',jsonb_build_object('id',series)));
    end if;
  end if;
  -- Legal consent is a parent, not a child of a booking. Remove it only when
  -- every linked booking is expired and unprotected; never another live series.
  for consent in select distinct a.checkout_legal_consent_id from public.account_legal_acceptances a
    join public.bookings b on b.id=a.booking_id where (b.id=p_booking or (series is not null and b.regular_series_id=series))
      and a.checkout_legal_consent_id is not null
  loop
    if not exists(select 1 from public.account_legal_acceptances a join public.bookings b on b.id=a.booking_id
      where a.checkout_legal_consent_id=consent and (public.retention_contract_end(b.id) is null
        or public.retention_contract_end(b.id)>now()-interval '6 years' or public.retention_has_hold(jsonb_build_object('booking',b.id)))) then
      roots:=roots||jsonb_build_array(jsonb_build_object('table','public.booking_checkout_legal_consents','key',jsonb_build_object('id',consent)));
    end if;
  end loop;
  perform public.retention_delete_tree(roots);
end;
$fn$;

-- Preserve each existing trigger's ordinary checks. Add DELETE-only authority
-- to the immutable trigger functions that can block retention. No blanket
-- session_replication_role changes, disabled triggers or FK bypasses.
do $immutable_retention$
declare f record; source text; patched text;
begin
  for f in select distinct p.oid,p.prosrc from pg_proc p join pg_trigger t on t.tgfoid=p.oid
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and not t.tgisinternal and (t.tgtype & 8)=8
      and p.prosrc ~* 'raise.*exception' and (p.proname like '%immutable%'
        or p.prosrc ~* 'immutable|cannot be.*deleted|cannot.*delete|cannot.*removed')
  loop
    source:=pg_get_functiondef(f.oid);
    patched:=regexp_replace(source,'\mBEGIN\M',E'BEGIN\n  IF TG_OP = ''DELETE'' AND public.retention_delete_authorised() THEN RETURN OLD; END IF;', 'i');
    if patched=source then raise exception 'Immutable retention guard could not be installed'; end if;
    execute patched;
  end loop;
end;
$immutable_retention$;

create function public.apply_retention_candidate(p_category text,p_entity text,p_scope jsonb)
returns void language plpgsql security definer set search_path=public as $fn$
declare person uuid; stamp timestamptz;
begin
  if not public.retention_delete_authorised() then raise exception 'Retention transaction required'; end if;
  if public.retention_has_hold(p_scope) then raise exception 'Record is protected'; end if;
  case p_category
    when 'emergency_contacts' then
      update public.provider_profile_settings set emergency_contact_name=null,emergency_contact_phone=null
        where provider_id=p_entity::uuid;
    when 'dbs_outcomes' then
      delete from public.provider_dbs_checks where provider_id=p_entity::uuid;
      update public.providers set dbs_verified=false where id=p_entity::uuid;
    when 'dbs_copies' then
      update public.provider_dbs_checks set certificate_storage_path=null,certificate_original_name=null,
        certificate_mime_type=null,certificate_deleted_at=now()
        where certificate_storage_path in(select value->>'path' from public.data_retention_file_tasks t cross join lateral jsonb_array_elements(t.files) value
          where t.category=p_category and t.entity_id=p_entity);
    when 'check_ins' then
      perform public.retention_delete_tree(jsonb_build_array(jsonb_build_object('table',
        case p_scope->>'type' when 'challenge' then 'public.check_in_challenges'
          when 'challenge_event' then 'public.check_in_challenge_events' else 'public.check_ins' end,
        'key',jsonb_build_object('id',p_entity::uuid))));
    when 'messages' then
      perform public.retention_delete_tree(jsonb_build_array(jsonb_build_object('table','public.booking_messages','key',jsonb_build_object('id',p_entity::bigint))));
    when 'job_photos' then
      if p_scope->>'type'='chat' then delete from public.booking_message_attachments where message_id=p_entity::bigint;
      else delete from public.handyman_files where id=p_entity::uuid; end if;
    when 'unsuccessful_applicants' then
      -- Shared customer login, saved cards and customer bookings are unaffected.
      delete from public.provider_verification_items where provider_id=p_entity::uuid;
      delete from public.provider_dbs_checks where provider_id=p_entity::uuid;
      delete from public.provider_onboarding_details where provider_id=p_entity::uuid;
      delete from public.provider_profile_settings where provider_id=p_entity::uuid;
      delete from public.provider_availability where provider_id=p_entity::uuid;
      delete from public.provider_time_off where provider_id=p_entity::uuid;
      delete from public.provider_task_rates where provider_id=p_entity::uuid;
      update public.providers set bio=null,photo_url=null,display_name='Expired application',insurance_ref=null,cert_ref=null,show_on_our_pros=false
        where id=p_entity::uuid;
    when 'enquiries' then delete from public.handyman_quote_requests where id=p_entity::uuid;
    when 'incidents' then
      perform public.retention_delete_tree(jsonb_build_array(jsonb_build_object('table',
        case p_scope->>'type' when 'incident' then 'public.account_incidents'
          when 'hold' then 'public.data_retention_holds' else 'public.review_cases' end,
        'key',jsonb_build_object('id',p_entity::uuid))));
    when 'business_records' then perform public.retention_delete_business(p_entity::uuid,p_scope ? 'handyman');
    when 'access_instructions' then
      select customer_id,public.retention_contract_end(id) into person,stamp from public.bookings where id=p_entity::uuid;
      update public.bookings set access_instructions=null,household_notes=null where id=p_entity::uuid;
      -- Do not erase an address's newly entered instructions or instructions
      -- still needed by another active booking/series.
      if not exists(select 1 from public.bookings where customer_id=person and status::text not in('completed','cancelled')) then
        update public.customer_addresses set access_instructions=null where user_id=person and updated_at<=stamp;
      end if;
      update public.booking_checkout_time_choices c set household_notes=null,
        booking_preferences=case jsonb_typeof(c.booking_preferences)
          when 'array' then coalesce((select jsonb_agg(value-'accessInstructions') from jsonb_array_elements(c.booking_preferences)),'[]'::jsonb)
          else c.booking_preferences-'accessInstructions' end,
        cleaning_extras=coalesce((select jsonb_agg(value-'notes')
          from jsonb_array_elements(c.cleaning_extras)),'[]'::jsonb)
        where c.customer_id=person and c.checkout_session_id=(select coalesce(s.checkout_session_id,b.checkout_session_id)
          from public.bookings b left join public.regular_booking_series s on s.id=b.regular_series_id where b.id=p_entity::uuid);
    else raise exception 'Unknown retention category';
  end case;
end;
$fn$;

create function public.run_data_retention(p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare run_id uuid; item record; counts jsonb:='{}'; held integer:=0; failed integer:=0; queued integer:=0; completed integer:=0; candidate_count integer:=0;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  if not pg_try_advisory_xact_lock(181946,2601) then return jsonb_build_object('busy',true); end if;
  p_dry_run:=p_dry_run or not (select enabled from public.data_retention_control where id);
  insert into public.data_retention_runs(dry_run) values(p_dry_run) returning id into run_id;
  perform set_config('opulence.retention_run',run_id::text,true);
  -- Bound each run. The daily scheduler safely resumes any larger backlog.
  select count(*) into held from public.retention_candidates() c where public.retention_has_hold(c.scope);
  for item in select * from public.retention_candidates() c
    where not public.retention_has_hold(c.scope)
      and not exists(select 1 from public.data_retention_file_tasks t
        where t.category=c.category and t.entity_id=c.entity_id and t.status in('pending','processing'))
    order by category,entity_id limit 500 loop
    candidate_count:=candidate_count+1;
    counts:=jsonb_set(counts,array[item.category],to_jsonb(coalesce((counts->>item.category)::integer,0)+1));
    if p_dry_run then continue; end if;
    begin
      if jsonb_array_length(item.files)>0 then
        insert into public.data_retention_file_tasks(category,entity_id,scope,files)
          values(item.category,item.entity_id,item.scope,item.files)
          on conflict(category,entity_id) do update set scope=excluded.scope,files=excluded.files,status='pending',completed_at=null
            where data_retention_file_tasks.status='obsolete';
        queued:=queued+1;
      else
        perform public.apply_retention_candidate(item.category,item.entity_id,item.scope);
        completed:=completed+1;
      end if;
    exception when others then
      -- Neither the raw SQL error nor record contents enter the audit log.
      failed:=failed+1;
    end;
  end loop;
  counts:=counts||jsonb_build_object('candidates',candidate_count,'held',held,'failed',failed,'queued_files',queued,'completed',completed);
  update public.data_retention_runs set summary=counts,finished_at=clock_timestamp() where id=run_id;
  return counts||jsonb_build_object('runId',run_id,'dryRun',p_dry_run);
end;
$fn$;

create function public.claim_retention_file_tasks(p_limit integer default 40)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare result jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  if not (select enabled from public.data_retention_control where id) then return '[]'::jsonb; end if;
  with selected as (
    select t.id from public.data_retention_file_tasks t where (t.status='pending'
      or (t.status='processing' and t.leased_until<now()))
      and not public.retention_has_hold(t.scope) order by t.attempts,t.created_at
      limit greatest(1,least(p_limit,40)) for update skip locked
  ), claimed as (
    update public.data_retention_file_tasks t set status='processing',claim_token=gen_random_uuid(),
      leased_until=now()+interval '5 minutes',attempts=attempts+1 from selected s where t.id=s.id returning t.*
  ) select coalesce(jsonb_agg(jsonb_build_object('id',id,'claimToken',claim_token,'files',files)),'[]'::jsonb) into result from claimed;
  return result;
end;
$fn$;

create function public.retention_file_task_allowed(p_id uuid,p_token uuid)
returns boolean language plpgsql security definer set search_path=public as $fn$
declare task public.data_retention_file_tasks; current_files jsonb; current_scope jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  perform pg_advisory_xact_lock(181946,2601);
  select * into task from public.data_retention_file_tasks where id=p_id for update;
  if not found or task.status<>'processing' or task.claim_token<>p_token or task.leased_until<=now()
    or not (select enabled from public.data_retention_control where id) then return false; end if;
  select c.files,c.scope into current_files,current_scope from public.retention_candidates() c
    where c.category=task.category and c.entity_id=task.entity_id;
  if not found or not (current_files <@ task.files) or current_scope<>task.scope then
    update public.data_retention_file_tasks set status='obsolete',claim_token=null,leased_until=null where id=p_id;
    return false;
  end if;
  if public.retention_has_hold(task.scope) then
    update public.data_retention_file_tasks set status='pending',claim_token=null,leased_until=null where id=p_id;
    return false;
  end if;
  return true;
end;
$fn$;

create function public.finish_retention_file_task(p_id uuid,p_token uuid,p_success boolean)
returns void language plpgsql security definer set search_path=public as $fn$
declare task public.data_retention_file_tasks; run_id uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  perform pg_advisory_xact_lock(181946,2601);
  select * into task from public.data_retention_file_tasks where id=p_id for update;
  if not found or task.status<>'processing' or task.claim_token<>p_token then raise exception 'File task lease changed'; end if;
  if not p_success then
    update public.data_retention_file_tasks set status='pending',claim_token=null,leased_until=null,last_error='Storage cleanup failed; retry required' where id=p_id;
    return;
  end if;
  if public.retention_has_hold(task.scope) then
    update public.data_retention_file_tasks set status='pending',claim_token=null,leased_until=null,last_error='Hold opened during cleanup; metadata retained' where id=p_id;
    return;
  end if;
  insert into public.data_retention_runs(dry_run) values(false) returning id into run_id;
  perform set_config('opulence.retention_run',run_id::text,true);
  perform public.apply_retention_candidate(task.category,task.entity_id,task.scope);
  update public.data_retention_file_tasks set status='done',completed_at=now(),claim_token=null,leased_until=null,last_error=null,files='[]'::jsonb where id=p_id;
  update public.data_retention_runs set finished_at=clock_timestamp(),summary=jsonb_build_object('files_completed',1) where id=run_id;
end;
$fn$;

-- A synchronous Storage request keeps the same transaction lock as case/hold
-- creation. The cron worker never performs an unprotected DELETE between RPCs.
-- The existing inbound service credential is forwarded to this project's
-- fixed Storage origin only; it is never saved or returned.
create function public.retention_remove_storage_files(p_files jsonb)
returns boolean language plpgsql security definer
set search_path=public,extensions as $fn$
declare origin text; headers jsonb; group_item record; response_status integer;
begin
  select storage_origin into origin from public.data_retention_control where id;
  headers:=nullif(current_setting('request.headers',true),'')::jsonb;
  if origin is null or coalesce(headers->>'authorization','')='' or coalesce(headers->>'apikey','')='' then
    return false;
  end if;
  for group_item in select value->>'bucket' bucket,jsonb_agg(value->>'path') paths
    from jsonb_array_elements(p_files) group by value->>'bucket'
  loop
    if group_item.bucket not in('provider-dbs','provider-verification','booking-attachments','handyman-job-files','property-maintenance-quotes') then
      return false;
    end if;
    execute $http$
      select (extensions.http(row('DELETE',$1,
        array[extensions.http_header('Authorization',$2),extensions.http_header('apikey',$3)],
        'application/json',$4)::extensions.http_request)).status
    $http$ into response_status using origin||'/storage/v1/object/'||group_item.bucket,
      headers->>'authorization',headers->>'apikey',jsonb_build_object('prefixes',group_item.paths)::text;
    if response_status not between 200 and 299 then return false; end if;
  end loop;
  return true;
exception when others then return false;
end;
$fn$;

create function public.remove_retention_file_task(p_id uuid,p_token uuid)
returns text language plpgsql security definer set search_path=public as $fn$
declare files jsonb; success boolean;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  perform pg_advisory_xact_lock(181946,2601);
  if not public.retention_file_task_allowed(p_id,p_token) then return 'held_or_obsolete'; end if;
  select t.files into files from public.data_retention_file_tasks t where id=p_id;
  success:=public.retention_remove_storage_files(files);
  perform public.finish_retention_file_task(p_id,p_token,success);
  return case when success then 'done' else 'retry' end;
end;
$fn$;

create function public.data_retention_admin_report()
returns jsonb language sql stable security definer set search_path=public as $fn$
  select jsonb_build_object('enabled',(select enabled from public.data_retention_control where id),
    'runs',coalesce((select jsonb_agg(to_jsonb(r)-'transaction_id') from(select * from public.data_retention_runs order by started_at desc limit 60) r),'[]'::jsonb),
    'pendingFiles',(select count(*) from public.data_retention_file_tasks where status in('pending','processing')),
    'failedFiles',(select count(*) from public.data_retention_file_tasks where last_error is not null and status='pending'),
    'holds',(select count(*) from public.data_retention_holds where resolved_at is null),
    'openHolds',coalesce((select jsonb_agg(to_jsonb(h)) from public.data_retention_holds h where resolved_at is null),'[]'::jsonb));
$fn$;

create function public.admin_manage_retention_hold(p_actor uuid,p_hold uuid,p_kind text,p_record uuid,p_reason text)
returns uuid language plpgsql security definer set search_path=public as $fn$
declare result uuid;
begin
  if auth.role() is distinct from 'service_role'
    or not exists(select 1 from public.profiles where id=p_actor and role::text='admin' and account_deleted_at is null)
    then raise exception 'Active staff required'; end if;
  if length(btrim(coalesce(p_reason,''))) not between 10 and 1000 then raise exception 'Reason required'; end if;
  perform pg_advisory_xact_lock(181946,2601);
  if p_hold is not null then
    update public.data_retention_holds set resolved_at=now(),resolved_by=p_actor,resolution_reason=btrim(p_reason)
      where id=p_hold and resolved_at is null returning id into result;
    if result is null then raise exception 'Open hold not found'; end if;
    return result;
  end if;
  if p_kind not in('user','booking','handyman','enquiry') or p_record is null then raise exception 'Record required'; end if;
  insert into public.data_retention_holds(user_id,booking_id,handyman_job_id,enquiry_id,reason,created_by)
    values(case when p_kind='user' then p_record end,case when p_kind='booking' then p_record end,
      case when p_kind='handyman' then p_record end,case when p_kind='enquiry' then p_record end,btrim(p_reason),p_actor)
    returning id into result;
  return result;
end;
$fn$;

-- Private helpers are deliberately not general-purpose deletion endpoints.
do $function_permissions$
declare f record;
begin
  for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and (p.proname like '%retention%' or p.proname='track_retention_lifecycle')
  loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
    if f.proname in('run_data_retention','claim_retention_file_tasks','remove_retention_file_task','data_retention_admin_report','admin_manage_retention_hold') then
      execute format('grant execute on function %s to service_role',f.signature);
    end if;
  end loop;
end;
$function_permissions$;

commit;
