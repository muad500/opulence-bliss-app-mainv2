begin;

create table public.professional_export_audits (
  id bigint generated always as identity primary key,
  actor_id uuid not null references public.profiles(id),
  starts_on date not null,
  ends_before date not null,
  professional_count integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.professional_export_audits enable row level security;
revoke all on public.professional_export_audits from public,anon,authenticated;
grant select,insert,update on public.professional_export_audits to service_role;
grant usage,select on sequence public.professional_export_audits_id_seq to service_role;

-- This is an internal cash-basis reconciliation export, never an automatic
-- HMRC submission. The staff MFA check happens before this service-only RPC.
create function public.professional_earnings_export(p_from date,p_to date,p_after uuid default null)
returns table(provider_id uuid,legal_name text,address text,postcode text,date_of_birth date,
  utr_number text,net_paid_pence bigint,transfer_count bigint,missing_details text)
language plpgsql stable security definer set search_path=public as $fn$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  if p_from is null or p_to is null or p_to<=p_from or p_to-p_from>366 then
    raise exception 'Export no more than one year';
  end if;
  return query
  with paid as (
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
