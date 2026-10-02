begin;
alter table public.handyman_quote_requests
  add column preferred_provider_id uuid references public.providers(id),
  add column quoted_hourly_rate_pence integer check(quoted_hourly_rate_pence between 100 and 100000),
  add column estimated_hours numeric(4,1) check(estimated_hours between .5 and 16 and mod(estimated_hours,.5)=0),
  add column estimate_total_pence integer;
alter table public.handyman_quote_requests add constraint handyman_quote_estimate_complete check(
  (preferred_provider_id is null and quoted_hourly_rate_pence is null and estimated_hours is null and estimate_total_pence is null)
  or (preferred_provider_id is not null and quoted_hourly_rate_pence is not null and estimated_hours is not null and estimate_total_pence is not null and estimate_total_pence=round(quoted_hourly_rate_pence*estimated_hours))
);
commit;
