begin;

-- Public aggregates expose only approved services and genuine completed work.
-- No private evidence, customer identities or private review text is disclosed.
create view public.professional_service_ratings
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
    and review.reviewer = 'client' and review.visibility = 'public'
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
  group by provider.id;

revoke all on public.professional_service_ratings from public;
grant select on public.professional_service_ratings to anon, authenticated, service_role;

commit;
