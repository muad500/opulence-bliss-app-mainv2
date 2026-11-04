begin;

-- Independent activation, brought forward from the wider staff-role project.
-- Existing approved professionals are not retroactively deactivated.
create table public.professional_approval_reviews (
  provider_id uuid not null references public.providers(id) on delete cascade,
  service text not null check(service in ('cleaning','handyman')),
  evidence_fingerprint text not null,
  first_reviewer uuid not null references public.profiles(id),
  first_reviewed_at timestamptz not null default clock_timestamp(),
  first_reason text not null,
  second_reviewer uuid references public.profiles(id),
  second_reviewed_at timestamptz,
  primary key(provider_id,service),
  check(second_reviewer is null or second_reviewer<>first_reviewer),
  check((second_reviewer is null)=(second_reviewed_at is null))
);
create table public.professional_approval_audit (
  id bigint generated always as identity primary key,
  provider_id uuid not null references public.providers(id) on delete cascade,
  service text not null,
  action text not null check(action in ('first_review','second_signoff','invalidated')),
  actor_id uuid not null references public.profiles(id),
  evidence_fingerprint text not null,
  reason text not null,
  created_at timestamptz not null default clock_timestamp()
);
alter table public.professional_approval_reviews enable row level security;
alter table public.professional_approval_audit enable row level security;
revoke all on public.professional_approval_reviews,public.professional_approval_audit from public,anon,authenticated;
grant select on public.professional_approval_reviews,public.professional_approval_audit to authenticated;
grant select on public.professional_approval_reviews,public.professional_approval_audit to service_role;
create policy approval_reviews_staff on public.professional_approval_reviews for select to authenticated using(public.is_admin());
create policy approval_audit_staff on public.professional_approval_audit for select to authenticated using(public.is_admin());

create function public.professional_approval_fingerprint(p_provider uuid)
returns text language sql stable security definer set search_path=public as $fn$
  select md5(jsonb_build_object(
    'profile',p.profile_id,'services',p.services,
    'dbs',(select to_jsonb(d) from public.provider_dbs_checks d where d.provider_id=p.id),
    'documents',(select coalesce(jsonb_agg(to_jsonb(v) order by v.document_type),'[]'::jsonb)
      from public.provider_verification_items v where v.provider_id=p.id),
    'files',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'updated_at',o.updated_at) order by o.name),'[]'::jsonb)
      from storage.objects o where o.bucket_id='provider-verification' and exists(
        select 1 from public.provider_verification_items v where v.provider_id=p.id and v.document_storage_path=o.name))
  )::text) from public.providers p where p.id=p_provider;
$fn$;

create function public.professional_reviewed_documents(p_provider uuid,p_staff uuid)
returns boolean language sql stable security definer set search_path=public as $fn$
  select exists(select 1 from public.provider_dbs_checks where provider_id=p_provider and reviewed_by=p_staff)
    or exists(select 1 from public.provider_verification_items where provider_id=p_provider and reviewed_by=p_staff);
$fn$;

create function public.professional_approval_review_state(p_provider uuid,p_service text)
returns jsonb language plpgsql stable security definer set search_path=public as $fn$
declare r public.professional_approval_reviews; owner_id uuid;
begin
  if not public.is_admin() then raise exception 'Authenticator staff sign-in required' using errcode='insufficient_privilege'; end if;
  select profile_id into owner_id from public.providers where id=p_provider;
  if not found or p_service not in ('cleaning','handyman') then raise exception 'Application not found'; end if;
  if owner_id=auth.uid() then return jsonb_build_object('phase','blocked','canReview',false,'message','You cannot approve your own account.'); end if;
  select * into r from public.professional_approval_reviews where provider_id=p_provider and service=p_service;
  if not found or r.evidence_fingerprint is distinct from public.professional_approval_fingerprint(p_provider) then
    return jsonb_build_object('phase','first','canReview',true,'message','Record the first review. A different staff member must then sign off.');
  end if;
  if r.second_reviewer is not null then return jsonb_build_object('phase','complete','canReview',false,'message','Independent sign-off recorded.'); end if;
  if r.first_reviewer=auth.uid() or public.professional_reviewed_documents(p_provider,auth.uid()) then
    return jsonb_build_object('phase','second','canReview',false,'message','First review recorded. Another staff member who did not check these documents must sign off.');
  end if;
  return jsonb_build_object('phase','second','canReview',true,'message','First review recorded. Check the application and record the independent second sign-off.');
end $fn$;

alter function public.review_professional_service(uuid,text,text,text) rename to review_professional_service_before_two_person;
create function public.review_professional_service(p_provider uuid,p_service text,p_status text,p_reason text default null)
returns void language plpgsql security definer set search_path=public as $fn$
declare p public.providers; r public.professional_approval_reviews; fingerprint text; block_reason text;
begin
  if not public.is_admin() then raise exception 'Authenticator staff sign-in required' using errcode='insufficient_privilege'; end if;
  select * into p from public.providers where id=p_provider for update;
  if not found or p_service not in ('cleaning','handyman') or not(p.service_approvals ? p_service) then raise exception 'Application not found'; end if;
  if p.profile_id=auth.uid() then raise exception 'You cannot approve or review your own account'; end if;
  if p_status<>'approved' then
    perform public.review_professional_service_before_two_person(p_provider,p_service,p_status,p_reason);
    insert into public.professional_approval_audit(provider_id,service,action,actor_id,evidence_fingerprint,reason)
      select provider_id,service,'invalidated',auth.uid(),evidence_fingerprint,coalesce(nullif(btrim(p_reason),''),'Application reopened')
      from public.professional_approval_reviews where provider_id=p_provider and service=p_service;
    delete from public.professional_approval_reviews where provider_id=p_provider and service=p_service;
    return;
  end if;
  if p.service_approvals->>p_service<>'pending' then raise exception 'Only pending applications can be approved'; end if;
  if p.is_suspended then raise exception 'The shared account is suspended'; end if;
  if length(btrim(coalesce(p_reason,'')))<10 then raise exception 'Record a review reason of at least 10 characters'; end if;
  block_reason:=public.professional_verification_block(p_provider);
  if block_reason is not null then raise exception '%',block_reason; end if;
  if not exists(select 1 from public.provider_verification_items v join storage.objects o
    on o.bucket_id='provider-verification' and o.name=v.document_storage_path
    where v.provider_id=p_provider and v.document_type='photo_id' and v.status='verified' and v.uploaded_at is not null
    and (v.expires_at is null or v.expires_at>=current_date)) then raise exception 'Verify photo ID before approval'; end if;
  if p_service='handyman' and not exists(select 1 from public.provider_verification_items v join storage.objects o
    on o.bucket_id='provider-verification' and o.name=v.document_storage_path
    where v.provider_id=p_provider and v.document_type='trade_certificate' and v.status='verified' and v.uploaded_at is not null
    and (v.expires_at is null or v.expires_at>=current_date)) then raise exception 'Verify training or certification before approval'; end if;
  fingerprint:=public.professional_approval_fingerprint(p_provider);
  select * into r from public.professional_approval_reviews where provider_id=p_provider and service=p_service;
  if not found or r.evidence_fingerprint is distinct from fingerprint then
    if r.provider_id is not null then
      insert into public.professional_approval_audit(provider_id,service,action,actor_id,evidence_fingerprint,reason)
        values(p_provider,p_service,'invalidated',auth.uid(),r.evidence_fingerprint,'Evidence changed; fresh first review required');
    end if;
    insert into public.professional_approval_reviews(provider_id,service,evidence_fingerprint,first_reviewer,first_reason)
      values(p_provider,p_service,fingerprint,auth.uid(),left(btrim(p_reason),500))
      on conflict(provider_id,service) do update set evidence_fingerprint=excluded.evidence_fingerprint,
        first_reviewer=excluded.first_reviewer,first_reviewed_at=clock_timestamp(),first_reason=excluded.first_reason,second_reviewer=null,second_reviewed_at=null;
    insert into public.professional_approval_audit(provider_id,service,action,actor_id,evidence_fingerprint,reason)
      values(p_provider,p_service,'first_review',auth.uid(),fingerprint,left(btrim(p_reason),500));
    return;
  end if;
  if r.first_reviewer=auth.uid() or public.professional_reviewed_documents(p_provider,auth.uid()) then
    raise exception 'A different staff member who did not check the documents must provide second sign-off';
  end if;
  update public.professional_approval_reviews set second_reviewer=auth.uid(),second_reviewed_at=clock_timestamp()
    where provider_id=p_provider and service=p_service;
  perform public.review_professional_service_before_two_person(p_provider,p_service,p_status,p_reason);
  insert into public.professional_approval_audit(provider_id,service,action,actor_id,evidence_fingerprint,reason)
    values(p_provider,p_service,'second_signoff',auth.uid(),fingerprint,left(btrim(p_reason),500));
end $fn$;

-- Also reject direct table updates that would skip the normal approval RPC.
create function public.guard_independent_professional_activation()
returns trigger language plpgsql security definer set search_path=public as $fn$
declare v_service text; prior jsonb:='{}'::jsonb;
begin
  if tg_op='UPDATE' then prior:=coalesce(old.service_approvals,'{}'::jsonb); end if;
  foreach v_service in array array['cleaning','handyman'] loop
    if new.service_approvals->>v_service='approved' and prior->>v_service is distinct from 'approved' then
      if not public.is_admin() or not exists(select 1 from public.professional_approval_reviews r
        where r.provider_id=new.id and r.service=v_service and r.second_reviewer=auth.uid()
        and r.first_reviewer<>auth.uid() and r.evidence_fingerprint=public.professional_approval_fingerprint(new.id)
        and not public.professional_reviewed_documents(new.id,auth.uid())) then
        raise exception 'Independent second sign-off is required before activation';
      end if;
    end if;
  end loop;
  if new.vetting_status::text='approved' and (tg_op='INSERT' or old.vetting_status::text is distinct from 'approved') then
    if not exists(select 1 from public.professional_approval_reviews r where r.provider_id=new.id
      and r.second_reviewer=auth.uid() and r.evidence_fingerprint=public.professional_approval_fingerprint(new.id)) then
      raise exception 'Independent second sign-off is required before activation';
    end if;
  end if;
  return new;
end $fn$;
create trigger independent_professional_activation before insert or update of service_approvals,vetting_status on public.providers
  for each row execute function public.guard_independent_professional_activation();

revoke all on function public.professional_approval_fingerprint(uuid),public.professional_reviewed_documents(uuid,uuid),
  public.professional_approval_review_state(uuid,text),public.review_professional_service_before_two_person(uuid,text,text,text),
  public.review_professional_service(uuid,text,text,text),public.guard_independent_professional_activation()
  from public,anon,authenticated,service_role;
grant execute on function public.professional_approval_review_state(uuid,text),public.review_professional_service(uuid,text,text,text) to authenticated;

commit;
notify pgrst,'reload schema';
