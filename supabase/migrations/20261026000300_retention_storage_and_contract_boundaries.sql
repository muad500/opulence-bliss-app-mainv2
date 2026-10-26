-- Complete Storage authorisation and give accepted quote contracts an explicit end.
begin;
alter table public.handyman_quote_requests
  add column retention_was_contract boolean not null default false,
  add column retention_ended_at timestamptz;
update public.handyman_quote_requests set retention_was_contract=true where status in('accepted','closed');
-- A historical closed enquiry might have become a contract. Retain it until
-- its end is recorded; never invent an old end date and purge it prematurely.
create function public.track_quote_retention_end()
returns trigger language plpgsql security definer set search_path=public as $fn$
begin
  new.retention_was_contract:=old.retention_was_contract or new.status='accepted';
  if new.status='closed' and old.status<>'closed' and new.retention_was_contract then
    new.retention_ended_at:=now();
  elsif new.status<>'closed' then new.retention_ended_at:=null;
  end if;
  return new;
end;
$fn$;
revoke all on function public.track_quote_retention_end() from public,anon,authenticated,service_role;
create trigger retention_quote_contract_end before update of status on public.handyman_quote_requests
  for each row execute function public.track_quote_retention_end();
create or replace function public.retention_remove_storage_files(p_files jsonb)
returns boolean language plpgsql security definer
set search_path=public,extensions as $fn$
declare origin text; headers jsonb; api_key text; group_item record; response_status integer;
begin
  select storage_origin into origin from public.data_retention_control where id;
  headers:=nullif(current_setting('request.headers',true),'')::jsonb;
  -- Supabase's gateway may strip apikey before PostgREST. The existing
  -- service Bearer credential is also a valid Storage API key. Never persist it.
  api_key:=coalesce(nullif(headers->>'apikey',''),regexp_replace(headers->>'authorization','^Bearer[[:space:]]+','','i'));
  if origin is null or coalesce(headers->>'authorization','')='' or coalesce(api_key,'')='' then
    return false;
  end if;
  for group_item in select value->>'bucket' bucket,jsonb_agg(value->>'path') paths
    from jsonb_array_elements(p_files) group by value->>'bucket'
  loop
    if group_item.bucket not in('provider-dbs','provider-verification','booking-attachments','handyman-job-files','property-maintenance-quotes','profile-photos') then
      return false;
    end if;
    execute $http$
      select (extensions.http(row('DELETE',$1,
        array[extensions.http_header('Authorization',$2),extensions.http_header('apikey',$3)],
        'application/json',$4)::extensions.http_request)).status
    $http$ into response_status using origin||'/storage/v1/object/'||group_item.bucket,
      headers->>'authorization',api_key,jsonb_build_object('prefixes',group_item.paths)::text;
    if response_status not between 200 and 299 then return false; end if;
  end loop;
  return true;
exception when others then return false;
end;
$fn$;

create or replace function public.retention_has_hold(p_scope jsonb)
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
  ), business_bookings as (
    select b.id from public.bookings b left join public.providers p on p.id=b.provider_id
    where b.id=(p_scope->>'booking')::uuid
      or b.regular_series_id=(select regular_series_id from public.bookings where id=(p_scope->>'booking')::uuid)
      or (p_scope ? 'user' and (b.customer_id=(p_scope->>'user')::uuid or p.profile_id=(p_scope->>'user')::uuid))
  ), business_jobs as (
    select j.id from public.handyman_jobs j left join public.providers p on p.id=j.provider_id
    where j.id=(p_scope->>'handyman')::uuid
      or (p_scope ? 'user' and (j.customer_id=(p_scope->>'user')::uuid or p.profile_id=(p_scope->>'user')::uuid))
  )
  select exists(select 1 from public.review_cases where status<>'resolved' and booking_id in(select id from scope_bookings))
    or exists(select 1 from public.account_incidents where status<>'resolved'
      and (reporter_id in(select id from scope_users) or booking_id in(select id from scope_bookings)))
    or exists(select 1 from public.handyman_disputes where status<>'resolved' and job_id in(select id from scope_jobs))
    or (coalesce(p_scope->>'retentionClass','')='business_records' and (
      exists(select 1 from public.review_cases where booking_id in(select id from business_bookings)
        and (status<>'resolved' or resolved_at is null or resolved_at>now()-interval '6 years'))
      or exists(select 1 from public.account_incidents where (reporter_id=(p_scope->>'user')::uuid
        or booking_id in(select id from business_bookings)) and (status<>'resolved' or reviewed_at is null or reviewed_at>now()-interval '6 years'))
      or exists(select 1 from public.handyman_disputes where job_id in(select id from business_jobs) and (status<>'resolved' or resolved_at is null or resolved_at>now()-interval '6 years'))
      or exists(select 1 from public.data_retention_holds where (user_id=(p_scope->>'user')::uuid
        or booking_id in(select id from business_bookings) or handyman_job_id in(select id from business_jobs)
        or enquiry_id=(p_scope->>'enquiry')::uuid) and (resolved_at is null or resolved_at>now()-interval '6 years'))
    ))
    or exists(select 1 from public.data_retention_holds where resolved_at is null and (
      user_id in(select id from scope_users) or booking_id in(select id from scope_bookings)
      or handyman_job_id in(select id from scope_jobs) or enquiry_id=(p_scope->>'enquiry')::uuid));
$fn$;

create or replace function public.retention_candidates()
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
      and (exists(select 1 from public.provider_onboarding_details d where d.provider_id=p.id)
        or exists(select 1 from public.provider_profile_settings s where s.provider_id=p.id)
        or exists(select 1 from public.provider_verification_items v where v.provider_id=p.id)
        or exists(select 1 from public.provider_dbs_checks d where d.provider_id=p.id)
        or p.bio is not null or p.photo_url is not null)
      and not exists(select 1 from public.bookings b where b.provider_id=p.id)
      and not exists(select 1 from public.handyman_jobs j where j.provider_id=p.id)
  union all
  select 'enquiries',q.id::text,jsonb_build_object('enquiry',q.id),
    coalesce((select jsonb_agg(jsonb_build_object('bucket','property-maintenance-quotes','path',photo->>'path'))
      from jsonb_array_elements(q.photos) photo where photo ? 'path'),'[]'::jsonb)
    from public.handyman_quote_requests q where q.created_at<=now()-interval '12 months'
      and not q.retention_was_contract and q.status<>'accepted'
  union all
  select 'incidents',i.id::text,jsonb_strip_nulls(jsonb_build_object('user',i.reporter_id,'booking',i.booking_id,'type','incident')),'[]'::jsonb
    from public.account_incidents i where i.status='resolved' and i.reviewed_at<=now()-interval '6 years'
  union all
  select 'incidents',c.id::text,jsonb_build_object('booking',c.booking_id,'type','case'),'[]'::jsonb
    from public.review_cases c where c.status='resolved' and c.resolved_at<=now()-interval '6 years'
  union all
  select 'incidents',d.id::text,jsonb_build_object('handyman',d.job_id,'type','dispute'),'[]'::jsonb
    from public.handyman_disputes d where d.status='resolved' and d.resolved_at<=now()-interval '6 years'
  union all
  select 'incidents',h.id::text,jsonb_strip_nulls(jsonb_build_object('user',h.user_id,'booking',h.booking_id,
    'handyman',h.handyman_job_id,'enquiry',h.enquiry_id,'type','hold')),'[]'::jsonb
    from public.data_retention_holds h where h.resolved_at<=now()-interval '6 years'
  union all
  select 'business_records',b.id::text,jsonb_build_object('booking',b.id,'retentionClass','business_records'),
    coalesce((select jsonb_agg(jsonb_build_object('bucket','booking-attachments','path',a.path))
      from public.booking_message_attachments a join public.booking_messages m on m.id=a.message_id
      join public.bookings linked on linked.id=m.booking_id
      where linked.id=b.id or (b.regular_series_id is not null and linked.regular_series_id=b.regular_series_id)),'[]'::jsonb)
    from public.bookings b where public.retention_contract_end(b.id)<=now()-interval '6 years'
  union all
  select 'business_records',j.id::text,jsonb_build_object('handyman',j.id,'retentionClass','business_records'),
    coalesce((select jsonb_agg(jsonb_build_object('bucket','handyman-job-files','path',f.storage_path))
      from public.handyman_files f where f.job_id=j.id),'[]'::jsonb)
    from public.handyman_jobs j where j.status in('completed','cancelled') and j.retention_ended_at<=now()-interval '6 years'
  union all
  select 'access_instructions',b.id::text,jsonb_build_object('booking',b.id),'[]'::jsonb
    from public.bookings b where public.retention_contract_end(b.id)<=now()
      and (b.access_instructions is not null or b.household_notes is not null)
  union all
  select 'business_records',q.id::text,jsonb_build_object('enquiry',q.id,'type','quote_contract','retentionClass','business_records'),
    coalesce((select jsonb_agg(jsonb_build_object('bucket','property-maintenance-quotes','path',photo->>'path'))
      from jsonb_array_elements(q.photos) photo where photo ? 'path'),'[]'::jsonb)
    from public.handyman_quote_requests q where q.retention_was_contract
      and q.status='closed' and q.retention_ended_at<=now()-interval '6 years'
  union all
  select 'business_records',u.id::text,jsonb_build_object('user',u.id,'type','closed_account','retentionClass','business_records'),
    coalesce((select jsonb_agg(jsonb_build_object('bucket',o.bucket_id,'path',o.name)) from storage.objects o where
      (o.bucket_id in('profile-photos','property-maintenance-quotes') and starts_with(o.name,u.id::text||'/'))
      or (o.bucket_id in('provider-dbs','provider-verification') and exists(select 1 from public.providers p
        where p.profile_id=u.id and starts_with(o.name,p.id::text||'/')))
      or (o.bucket_id='booking-attachments' and exists(select 1 from public.bookings b left join public.providers p on p.id=b.provider_id
        where (b.customer_id=u.id or p.profile_id=u.id) and starts_with(o.name,b.id::text||'/')))
      or (o.bucket_id='handyman-job-files' and exists(select 1 from public.handyman_jobs j left join public.providers p on p.id=j.provider_id
        where (j.customer_id=u.id or p.profile_id=u.id) and starts_with(o.name,j.id::text||'/')))),'[]'::jsonb)
    from public.profiles u where u.role::text<>'admin' and u.account_deleted_at<=now()-interval '6 years'
      and not exists(select 1 from public.bookings b left join public.providers p on p.id=b.provider_id
        where (b.customer_id=u.id or p.profile_id=u.id) and (public.retention_contract_end(b.id) is null
          or public.retention_contract_end(b.id)>now()-interval '6 years'))
      and not exists(select 1 from public.handyman_jobs j left join public.providers p on p.id=j.provider_id
        where (j.customer_id=u.id or p.profile_id=u.id) and (j.status not in('completed','cancelled')
          or j.retention_ended_at is null or j.retention_ended_at>now()-interval '6 years'))
      and not exists(select 1 from public.handyman_quote_requests q where q.customer_id=u.id and q.retention_was_contract
        and (q.retention_ended_at is null or q.retention_ended_at>now()-interval '6 years'))
$fn$;

create or replace function public.apply_retention_candidate(p_category text,p_entity text,p_scope jsonb)
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
          when 'hold' then 'public.data_retention_holds' when 'dispute' then 'public.handyman_disputes' else 'public.review_cases' end,
        'key',jsonb_build_object('id',p_entity::uuid))));
    when 'business_records' then
      if p_scope->>'type'='quote_contract' then
        perform public.retention_delete_tree(jsonb_build_array(jsonb_build_object('table','public.handyman_quote_requests','key',jsonb_build_object('id',p_entity::uuid))));
      elsif p_scope->>'type'='closed_account' then
        perform public.retention_delete_tree(jsonb_build_array(jsonb_build_object('table','public.profiles','key',jsonb_build_object('id',p_entity::uuid))));
      else perform public.retention_delete_business(p_entity::uuid,p_scope ? 'handyman'); end if;
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

commit;
