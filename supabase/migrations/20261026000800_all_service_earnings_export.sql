begin;

-- Reporting only. Include recorded property-maintenance transfers without
-- changing marketplace code, switches, jobs or financial operations.
create or replace function public.professional_earnings_export(p_from date,p_to date,p_after uuid default null)
returns table(provider_id uuid,legal_name text,address text,postcode text,date_of_birth date,
  utr_number text,net_paid_pence bigint,transfer_count bigint,missing_details text)
language plpgsql stable security definer set search_path=public as $fn$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  if p_from is null or p_to is null or p_to<=p_from or p_to-p_from>366 then
    raise exception 'Export no more than one year';
  end if;
  return query
  with cleaning_paid as (
    select payout.provider_id,
      sum(case when exists(select 1 from public.cleaning_payout_parts part where part.payout_id=payout.id)
        then (select sum(part.amount_pence-part.reversed_pence) from public.cleaning_payout_parts part where part.payout_id=payout.id)
        else round(payout.amount*100) end)::bigint as net,
      count(*) as transfers
    from public.payouts payout
    where payout.status::text='paid'
      and coalesce((select min(e.created_at) from public.payout_events e where e.payout_id=payout.id and e.to_status='paid'),payout.created_at)
        >= (p_from::timestamp at time zone 'Europe/London')
      and coalesce((select min(e.created_at) from public.payout_events e where e.payout_id=payout.id and e.to_status='paid'),payout.created_at)
        < (p_to::timestamp at time zone 'Europe/London')
    group by payout.provider_id
  ), quote_paid as (
    select job.provider_id,
      sum(op.amount_pence-coalesce((select sum(reversal.amount_pence)
        from public.handyman_quote_operations reversal
        where reversal.source_id=op.id and reversal.kind='reversal'
          and reversal.status='succeeded'),0))::bigint as net,
      count(*) as transfers
    from public.handyman_quote_operations op
      join public.handyman_jobs job on job.id=op.job_id
    where op.kind='transfer' and op.status='succeeded'
      and op.updated_at>=(p_from::timestamp at time zone 'Europe/London')
      and op.updated_at<(p_to::timestamp at time zone 'Europe/London')
      and job.provider_id is not null
      and not exists(select 1 from public.payouts duplicate
        where duplicate.stripe_transfer_ref=op.stripe_ref)
    group by job.provider_id
  ), legacy_maintenance_paid as (
    select job.provider_id,sum((job.bill->>'provider')::bigint)::bigint as net,
      count(*) as transfers
    from public.handyman_jobs job
    where not job.quote_mode and job.transfer_ref is not null
      and job.provider_id is not null
      and coalesce(job.retention_ended_at,job.updated_at)>=(p_from::timestamp at time zone 'Europe/London')
      and coalesce(job.retention_ended_at,job.updated_at)<(p_to::timestamp at time zone 'Europe/London')
      and not exists(select 1 from public.payouts duplicate
        where duplicate.stripe_transfer_ref=job.transfer_ref)
    group by job.provider_id
  ), paid as (
    select totals.provider_id,sum(totals.net)::bigint as net,
      sum(totals.transfers)::bigint as transfers
    from (select * from cleaning_paid union all select * from quote_paid
      union all select * from legacy_maintenance_paid) totals
    group by totals.provider_id
  )
  select pro.id,profile.full_name,profile.address,coalesce(settings.home_postcode,profile.postcode),
    application.date_of_birth,application.utr_number,paid.net,paid.transfers,
    concat_ws('; ',case when nullif(trim(profile.full_name),'') is null then 'legal name missing' end,
      case when nullif(trim(profile.address),'') is null then 'address missing' end,
      case when nullif(trim(coalesce(settings.home_postcode,profile.postcode)),'') is null then 'postcode missing' end,
      case when application.date_of_birth is null then 'date of birth missing' end,
      case when nullif(application.utr_number,'') is null then 'UTR missing' end)
  from paid join public.providers pro on pro.id=paid.provider_id
    join public.profiles profile on profile.id=pro.profile_id
    left join public.provider_profile_settings settings on settings.provider_id=pro.id
    left join public.provider_onboarding_details application on application.provider_id=pro.id
  where p_after is null or pro.id>p_after
  order by pro.id limit 500;
end
$fn$;
revoke all on function public.professional_earnings_export(date,date,uuid) from public,anon,authenticated;
grant execute on function public.professional_earnings_export(date,date,uuid) to service_role;

commit;
