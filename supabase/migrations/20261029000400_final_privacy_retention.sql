-- No immediate sweep. The existing logged daily job remains the only runner.
begin;
alter table public.data_retention_control
  add column financial_year_end_month smallint,
  add column financial_year_end_day smallint,
  add constraint retention_financial_year_end_valid check (
    (financial_year_end_month is null and financial_year_end_day is null)
    or (financial_year_end_month between 1 and 12 and financial_year_end_day between 1 and 31)
  );
alter table public.profiles add column retention_account_anonymised_at timestamptz;
alter table public.providers add column retention_details_cleared_at timestamptz;
alter table public.partner_interests add column partner_left_at timestamptz;

-- The Partner engine is not launched. Future referral/reward writers must put
-- their business evidence here; the retention clock and hold linkage are ready.
create table public.referral_reward_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  booking_id uuid references public.bookings(id),
  record_kind text not null check(record_kind in ('referral','reward')),
  record jsonb not null,
  recorded_at timestamptz not null default now(),
  closed_at timestamptz
);
alter table public.referral_reward_records enable row level security;
revoke all on public.referral_reward_records from public,anon,authenticated;
grant all on public.referral_reward_records to service_role;
create trigger referral_reward_retention_lock before insert or update or delete
  on public.referral_reward_records for each row execute function public.serialise_retention_holds();

create function public.retention_financial_cutoff(p_date timestamptz)
returns timestamptz language plpgsql stable security definer set search_path=public as $fn$
declare m integer; d integer; y integer; ending date; last_day integer;
begin
  select financial_year_end_month,financial_year_end_day into m,d
    from public.data_retention_control where id;
  -- Do not guess the company's accounting year. Unknown means retain.
  if m is null or d is null or p_date is null then return null; end if;
  y:=extract(year from p_date at time zone 'Europe/London');
  last_day:=extract(day from make_date(y,m,1)+interval '1 month - 1 day');
  ending:=make_date(y,m,least(d,last_day));
  if (p_date at time zone 'Europe/London')::date>ending then
    y:=y+1;
    last_day:=extract(day from make_date(y,m,1)+interval '1 month - 1 day');
    ending:=make_date(y,m,least(d,last_day));
  end if;
  return ((ending+1)::timestamp+interval '6 years') at time zone 'Europe/London';
end;
$fn$;
revoke all on function public.retention_financial_cutoff(timestamptz) from public,anon,authenticated;

create function public.retention_booking_financial_due(p_booking uuid)
returns timestamptz language sql stable security definer set search_path=public as $fn$
  select case when bool_and(b.status::text in ('completed','cancelled')) then
    greatest(max(public.retention_contract_end(b.id))+interval '6 years',
      public.retention_financial_cutoff(greatest(max(b.retention_ended_at),max(b.scheduled_at),
        max((select max(coalesce((to_jsonb(p)->>'created_at')::timestamptz,b.scheduled_at)) from public.payments p where p.booking_id=b.id)),
        max((select max(c.created_at) from public.booking_visit_charges c where c.booking_id=b.id)))))
    end
  from public.bookings root join public.bookings b
    on b.id=root.id or (root.regular_series_id is not null and b.regular_series_id=root.regular_series_id)
  where root.id=p_booking
    and (select financial_year_end_month is not null from public.data_retention_control where id);
$fn$;
revoke all on function public.retention_booking_financial_due(uuid) from public,anon,authenticated;

-- Retain the reviewed baseline adapters and their protections. New wrappers
-- keep the original OIDs/grants used by the scheduler and file queue.
do $baseline$
declare source text;
begin
  select pg_get_functiondef('public.retention_candidates()'::regprocedure) into source;
  execute regexp_replace(source,'public\.retention_candidates\(\)', 'public.retention_candidates_before_final_pack()');
  select pg_get_functiondef('public.apply_retention_candidate(text,text,jsonb)'::regprocedure) into source;
  execute regexp_replace(source,'public\.apply_retention_candidate\(', 'public.apply_retention_candidate_before_final_pack(');
end;
$baseline$;
revoke all on function public.retention_candidates_before_final_pack() from public,anon,authenticated,service_role;
revoke all on function public.apply_retention_candidate_before_final_pack(text,text,jsonb) from public,anon,authenticated,service_role;

do $holds$
declare source text;
begin
  select pg_get_functiondef('public.retention_has_hold(jsonb)'::regprocedure) into source;
  execute regexp_replace(source,'public\.retention_has_hold\(', 'public.retention_has_hold_before_final_pack(');
end;
$holds$;
revoke all on function public.retention_has_hold_before_final_pack(jsonb) from public,anon,authenticated,service_role;
create or replace function public.retention_has_hold(p_scope jsonb)
returns boolean language sql stable security definer set search_path=public as $fn$
  select public.retention_has_hold_before_final_pack(p_scope)
    or (coalesce(p_scope->>'retentionClass','')='business_records' and exists(
      select 1 from public.referral_reward_records r where
        (r.user_id=(p_scope->>'user')::uuid or r.booking_id=(p_scope->>'booking')::uuid
          or r.user_id=(select customer_id from public.bookings where id=(p_scope->>'booking')::uuid)
          or r.user_id=(select profile_id from public.providers where id=(p_scope->>'provider')::uuid))
        and (r.closed_at is null or r.closed_at>now()-interval '6 years')
    ));
$fn$;

create function public.retention_professional_is_inactive(p_provider uuid)
returns boolean language sql stable security definer set search_path=public as $fn$
  select not exists(select 1 from public.bookings where provider_id=p_provider and status::text not in ('completed','cancelled'))
    and not exists(select 1 from public.handyman_jobs where provider_id=p_provider and status not in ('completed','cancelled'));
$fn$;
revoke all on function public.retention_professional_is_inactive(uuid) from public,anon,authenticated;

create or replace function public.retention_candidates()
returns table(category text,entity_id text,scope jsonb,files jsonb)
language sql stable security definer set search_path=public,storage as $fn$
  select c.* from public.retention_candidates_before_final_pack() c
  where (c.category<>'messages' or not exists(
    select 1 from public.booking_messages m where m.booking_id=(c.scope->>'booking')::uuid
      and m.created_at>now()-interval '2 years'))
  and (c.category<>'business_records' or case
    when c.scope ? 'booking' then public.retention_booking_financial_due((c.scope->>'booking')::uuid)<=now()
    when c.scope ? 'handyman' then exists(select 1 from public.handyman_jobs j
      where j.id=(c.scope->>'handyman')::uuid
        and public.retention_financial_cutoff(greatest(j.retention_ended_at,j.updated_at))<=now())
    when c.scope->>'type'='closed_account' then
      (select financial_year_end_month is not null from public.data_retention_control where id)
      and not exists(select 1 from public.bookings b left join public.providers p on p.id=b.provider_id
        where (b.customer_id=(c.scope->>'user')::uuid or p.profile_id=(c.scope->>'user')::uuid)
          and (public.retention_booking_financial_due(b.id) is null or public.retention_booking_financial_due(b.id)>now()))
      and not exists(select 1 from public.handyman_jobs j left join public.providers p on p.id=j.provider_id
        where (j.customer_id=(c.scope->>'user')::uuid or p.profile_id=(c.scope->>'user')::uuid)
          and (public.retention_financial_cutoff(greatest(j.retention_ended_at,j.updated_at)) is null
            or public.retention_financial_cutoff(greatest(j.retention_ended_at,j.updated_at))>now()))
    else true end)
  union all
  select 'customer_accounts',p.id::text,jsonb_build_object('user',p.id),
    coalesce((select jsonb_agg(jsonb_build_object('bucket',o.bucket_id,'path',o.name))
      from storage.objects o where o.bucket_id='profile-photos' and starts_with(o.name,p.id::text||'/')),'[]'::jsonb)
    from public.profiles p where p.role::text<>'admin'
      and p.account_deleted_at<=now()-interval '12 months' and p.retention_account_anonymised_at is null
      and not exists(select 1 from public.providers w where w.profile_id=p.id and w.retention_ever_approved)
      and not exists(select 1 from public.bookings b where b.customer_id=p.id and b.status::text not in ('completed','cancelled'))
      and not exists(select 1 from public.handyman_jobs j where j.customer_id=p.id and j.status not in ('completed','cancelled'))
  union all
  select case when v.document_type in ('photo_id','right_to_work','proof_of_address')
      then 'identity_right_to_work' else 'trade_insurance' end,
    v.id::text,jsonb_build_object('provider',v.provider_id),
    case when v.document_storage_path is not null then jsonb_build_array(jsonb_build_object(
      'bucket','provider-verification','path',v.document_storage_path)) else '[]'::jsonb end
    from public.provider_verification_items v join public.providers p on p.id=v.provider_id
    where p.retention_left_at<=now()-interval '2 years'
      and public.retention_professional_is_inactive(p.id)
      and v.document_type in ('photo_id','right_to_work','proof_of_address','public_liability_insurance','trade_certificate','gas_safe_registration','electrical_registration')
  union all
  select 'cleaner_records',p.id::text,jsonb_build_object('provider',p.id),'[]'::jsonb
    from public.providers p where p.retention_left_at<=now()-interval '6 years'
      and p.retention_details_cleared_at is null and public.retention_professional_is_inactive(p.id)
      and not exists(select 1 from public.bookings b where b.provider_id=p.id
        and (public.retention_booking_financial_due(b.id) is null or public.retention_booking_financial_due(b.id)>now()))
  union all
  select 'partner_records',p.id::text,jsonb_build_object('partnerInterest',p.id),'[]'::jsonb
    from public.partner_interests p where p.partner_registered_at is not null
      and p.partner_left_at<=now()-interval '6 years'
  union all
  select 'referral_rewards',r.id::text,jsonb_strip_nulls(jsonb_build_object('user',r.user_id,'booking',r.booking_id)),'[]'::jsonb
    from public.referral_reward_records r where r.closed_at<=now()-interval '6 years';
$fn$;

create or replace function public.apply_retention_candidate(p_category text,p_entity text,p_scope jsonb)
returns void language plpgsql security definer set search_path=public as $fn$
begin
  if not public.retention_delete_authorised() then raise exception 'Retention transaction required'; end if;
  if public.retention_has_hold(p_scope) then raise exception 'Record is protected'; end if;
  if not exists(select 1 from public.retention_candidates() c
    where c.category=p_category and c.entity_id=p_entity and c.scope=p_scope) then
    raise exception 'Retention candidate changed';
  end if;
  case p_category
    when 'customer_accounts' then
      -- Keep immutable financial/acceptance evidence for its separate clock.
      -- Remove only ordinary closed-account profile/contact/address data.
      delete from public.customer_addresses where user_id=p_entity::uuid;
      delete from public.account_profile_details where user_id=p_entity::uuid;
      update public.profiles set full_name='Closed account',phone=null,
        email='closed-'||id::text||'@deleted.invalid',retention_account_anonymised_at=now()
        where id=p_entity::uuid and account_deleted_at is not null;
    when 'identity_right_to_work','trade_insurance' then
      delete from public.provider_verification_items where id=p_entity::uuid;
    when 'cleaner_records' then
      delete from public.provider_profile_settings where provider_id=p_entity::uuid;
      delete from public.provider_onboarding_details where provider_id=p_entity::uuid;
      update public.providers set bio=null,photo_url=null,display_name='Closed professional',
        insurance_ref=null,cert_ref=null,show_on_our_pros=false,retention_details_cleared_at=now()
        where id=p_entity::uuid;
    when 'partner_records' then
      delete from public.partner_interests where id=p_entity::uuid and partner_left_at<=now()-interval '6 years';
    when 'referral_rewards' then
      delete from public.referral_reward_records where id=p_entity::uuid and closed_at<=now()-interval '6 years';
    else perform public.apply_retention_candidate_before_final_pack(p_category,p_entity,p_scope);
  end case;
end;
$fn$;
commit;
notify pgrst, 'reload schema';
