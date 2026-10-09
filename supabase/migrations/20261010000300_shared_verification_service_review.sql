begin;

-- A verified share code is valid evidence, alongside the completed GOV.UK check.
create or replace function public.require_provider_reapproval_for_core_document()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_provider_id uuid;
  v_requires_reapproval boolean := false;
begin
  if tg_op = 'UPDATE' and (
    new.provider_id is distinct from old.provider_id
    or new.document_type is distinct from old.document_type
  ) then
    raise exception 'Verification document identity cannot be changed'
      using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' then
    v_provider_id := old.provider_id;
    v_requires_reapproval := old.document_type in ('right_to_work', 'photo_id');
  else
    v_provider_id := new.provider_id;
    if new.document_type in ('right_to_work', 'photo_id') then
      v_requires_reapproval := new.status <> 'verified'
        or (new.document_storage_path is null and not (
          new.document_type = 'right_to_work'
          and coalesce(new.reference, '') ~ '^[A-Z0-9]{9}$'
          and new.gov_uk_checked_on is not null
        ))
        or new.uploaded_at is null
        or (new.expires_at is not null and new.expires_at < current_date)
        or (new.next_check_at is not null and new.next_check_at < current_date);
      if tg_op = 'UPDATE' then
        v_requires_reapproval := v_requires_reapproval
          or new.document_storage_path is distinct from old.document_storage_path
          or (new.document_type = 'right_to_work' and new.reference is distinct from old.reference);
      end if;
    end if;
  end if;

  if v_requires_reapproval then
    update public.providers
    set vetting_status = 'pending', show_on_our_pros = false
    where id = v_provider_id and vetting_status = 'approved';
  end if;
  return null;
end
$fn$;

-- Replacing a shared check opens review for all approved services. It must never
-- strand a globally pending professional behind an already-approved service card.
create function public.reopen_services_for_shared_review()
returns trigger
language plpgsql security definer set search_path = public
as $function$
declare
  service text;
begin
  if old.vetting_status = 'approved' and new.vetting_status = 'pending' then
    for service in select entry.key from jsonb_each_text(new.service_approvals) as entry
      where entry.value = 'approved'
    loop
      new.service_approvals := new.service_approvals || jsonb_build_object(service, 'pending');
      insert into public.provider_service_events
        (provider_id, service, previous_status, status, reason, reviewed_by)
      values (new.id, service, 'approved', 'pending', 'Shared verification requires review', auth.uid());
    end loop;
  end if;
  return new;
end;
$function$;

create trigger reopen_services_for_shared_review
  before update of vetting_status on public.providers
  for each row execute function public.reopen_services_for_shared_review();
revoke all on function public.reopen_services_for_shared_review()
  from public, anon, authenticated, service_role;

-- Ratings disclose aggregates only. Private comments remain private. Handyman
-- service listings also require current insurance and an offered task rate.

-- Public aggregates expose only approved services and genuine completed work.
-- No private evidence, customer identities or private review text is disclosed.
create or replace view public.professional_service_ratings
with (security_barrier = true)
as
  select provider.id as provider_id,
         'cleaning'::text as service,
         avg(review.rating)::numeric as rating_avg,
         count(review.id)::integer as rating_count
  from public.providers as provider
  join public.public_eligible_provider_ids() as eligible on eligible.id = provider.id
  left join public.bookings as booking
    on booking.provider_id = provider.id and booking.status::text = 'completed'
  left join public.reviews as review
    on review.booking_id = booking.id
    and review.reviewer = 'client'
  where provider.show_on_our_pros
    and provider.vetting_status = 'approved'
    and not provider.is_suspended
    and 'cleaning' = any(provider.services)
    and provider.service_approvals ->> 'cleaning' = 'approved'
  group by provider.id

  union all

  select provider.id as provider_id,
         'handyman'::text as service,
         avg(review.rating)::numeric as rating_avg,
         count(review.job_id)::integer as rating_count
  from public.providers as provider
  join public.public_eligible_provider_ids() as eligible on eligible.id = provider.id
  left join public.handyman_jobs as job
    on job.provider_id = provider.id and job.status = 'completed'
  left join public.handyman_reviews as review on review.job_id = job.id
  where provider.show_on_our_pros
    and provider.vetting_status = 'approved'
    and not provider.is_suspended
    and 'handyman' = any(provider.services)
    and provider.service_approvals ->> 'handyman' = 'approved'
    and exists (
      select 1 from public.provider_verification_items as item
      join storage.objects as file on file.bucket_id = 'provider-verification'
        and file.name = item.document_storage_path
      where item.provider_id = provider.id
        and item.document_type = 'public_liability_insurance'
        and item.status = 'verified' and item.uploaded_at is not null
        and item.expires_at >= current_date
    )
    and exists (
      select 1 from public.provider_task_rates as rate where rate.provider_id = provider.id
    )
  group by provider.id;

revoke all on public.professional_service_ratings from public;
grant select on public.professional_service_ratings to anon, authenticated, service_role;


commit;
