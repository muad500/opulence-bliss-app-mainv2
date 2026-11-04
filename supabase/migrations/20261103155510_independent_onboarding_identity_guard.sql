begin;

-- The inviter is an onboarding participant even if somebody else inspected
-- the documents. Identity/application edits also invalidate the first review.
create or replace function public.professional_reviewed_documents(p_provider uuid,p_staff uuid)
returns boolean language sql stable security definer set search_path=public as $fn$
  select exists(select 1 from public.provider_dbs_checks where provider_id=p_provider and reviewed_by=p_staff)
    or exists(select 1 from public.provider_verification_items where provider_id=p_provider and reviewed_by=p_staff)
    or exists(select 1 from public.professional_setup_invitations where provider_id=p_provider and created_by=p_staff);
$fn$;

create or replace function public.professional_approval_fingerprint(p_provider uuid)
returns text language sql stable security definer set search_path=public as $fn$
  select md5(jsonb_build_object(
    'profile',p.profile_id,'services',p.services,
    'identity',(select jsonb_build_object('name',full_name,'address',address,'phone',phone,'deleted',account_deleted_at)
      from public.profiles where id=p.profile_id),
    'application',(select to_jsonb(a) from public.provider_onboarding_details a where a.provider_id=p.id),
    'onboarder',(select created_by from public.professional_setup_invitations where provider_id=p.id),
    'dbs',(select to_jsonb(d) from public.provider_dbs_checks d where d.provider_id=p.id),
    'documents',(select coalesce(jsonb_agg(to_jsonb(v) order by v.document_type),'[]'::jsonb)
      from public.provider_verification_items v where v.provider_id=p.id),
    'files',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'updated_at',o.updated_at) order by o.name),'[]'::jsonb)
      from storage.objects o where o.bucket_id='provider-verification' and exists(
        select 1 from public.provider_verification_items v where v.provider_id=p.id and v.document_storage_path=o.name))
  )::text) from public.providers p where p.id=p_provider;
$fn$;
revoke all on function public.professional_reviewed_documents(uuid,uuid),public.professional_approval_fingerprint(uuid)
  from public,anon,authenticated,service_role;

commit;
