-- Rejected incomplete applications also expire; the shared customer account stays.
begin;
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

create or replace function public.run_data_retention(p_dry_run boolean default true)
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
            where data_retention_file_tasks.status in ('obsolete','done');
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

commit;
