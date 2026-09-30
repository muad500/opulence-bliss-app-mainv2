begin;
alter table public.profiles add column if not exists account_deleted_at timestamptz;
create table if not exists public.account_erasure_jobs(
  request_id uuid primary key references public.account_deletion_requests(id),
  user_id uuid not null, provider_id uuid, files jsonb not null default '[]',
  completed_at timestamptz, created_at timestamptz not null default now()
);
alter table public.account_erasure_jobs enable row level security;
revoke all on public.account_erasure_jobs from public,anon,authenticated;
grant all on public.account_erasure_jobs to service_role;

create or replace function public.account_is_active()
returns boolean language sql stable security definer set search_path=public as $fn$
  select not exists(select 1 from public.profiles where id=auth.uid() and account_deleted_at is not null);
$fn$;
revoke all on function public.account_is_active() from public,anon;
grant execute on function public.account_is_active() to authenticated,service_role;
-- Existing access rules continue to determine ownership. This extra restrictive
-- rule also blocks still-valid JWTs after their account has been erased.
do $policies$
declare item record;
begin
  for item in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relrowsecurity
  loop
    execute format('drop policy if exists erased_accounts_have_no_access on public.%I',item.relname);
    execute format('create policy erased_accounts_have_no_access on public.%I as restrictive for all to authenticated using ((select public.account_is_active())) with check ((select public.account_is_active()))',item.relname);
  end loop;
end $policies$;

create or replace function public.block_erased_account_booking()
returns trigger language plpgsql security definer set search_path=public as $fn$
begin
  if new.customer_id is null then return new; end if;
  perform 1 from public.profiles where id=new.customer_id and account_deleted_at is null for share;
  if not found then raise exception 'Customer account is unavailable'; end if;
  if new.provider_id is not null and exists(select 1 from public.providers p join public.profiles u on u.id=p.profile_id
    where p.id=new.provider_id and u.account_deleted_at is not null) then raise exception 'Professional account is unavailable'; end if;
  return new;
end $fn$;
drop trigger if exists block_erased_account_booking on public.bookings;
create trigger block_erased_account_booking before insert on public.bookings for each row execute function public.block_erased_account_booking();
revoke all on function public.block_erased_account_booking() from public,anon,authenticated,service_role;

create or replace function public.prepare_account_erasure(p_request_id uuid,p_retention_note text)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare request public.account_deletion_requests; target uuid; professional uuid; files jsonb; existing_job public.account_erasure_jobs;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  select * into request from public.account_deletion_requests where id=p_request_id for update;
  if not found or request.status <> 'in_review' or request.user_id is null then raise exception 'Request must be in review'; end if;
  if length(btrim(coalesce(p_retention_note,''))) < 10 then raise exception 'Explain which transaction and legal records must be retained'; end if;
  target := request.user_id;
  perform 1 from public.profiles where id=target and role::text<>'admin' for update;
  if not found then raise exception 'Account cannot be erased by this workflow'; end if;
  select * into existing_job from public.account_erasure_jobs where request_id=p_request_id;
  if found then return jsonb_build_object('userId',existing_job.user_id,'files',existing_job.files); end if;
  select id into professional from public.providers where profile_id=target for update;
  -- Lock every relevant booking, so acceptance and erasure cannot race.
  perform 1 from public.bookings where customer_id=target or provider_id=professional for update;
  if exists(select 1 from public.bookings where (customer_id=target or provider_id=professional) and status::text not in ('completed','cancelled')) then
    raise exception 'Resolve all unfinished bookings before erasing this account';
  end if;
  if exists(select 1 from public.payments pay join public.bookings b on b.id=pay.booking_id
    where (b.customer_id=target or b.provider_id=professional) and pay.status not in ('succeeded','cancelled','refunded','partially_refunded'))
    or exists(select 1 from public.payouts po join public.bookings b on b.id=po.booking_id
      where (b.customer_id=target or b.provider_id=professional) and po.status not in ('paid','reversed')) then
    raise exception 'Resolve outstanding payments, refunds or payouts before erasing this account';
  end if;
  if exists(select 1 from public.review_cases c join public.bookings b on b.id=c.booking_id
    where (b.customer_id=target or b.provider_id=professional) and c.status<>'resolved') then
    raise exception 'Resolve open booking cases before erasing this account';
  end if;
  if exists(select 1 from public.booking_checkout_time_choices where customer_id=target and created_at>now()-interval '24 hours') then
    raise exception 'A checkout is still open. Resolve or wait for it to expire before erasure';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('bucket',bucket_id,'path',name)),'[]') into files
  from storage.objects where (bucket_id='profile-photos' and starts_with(name,target::text || '/'))
    or (professional is not null and bucket_id in ('provider-verification','provider-dbs') and starts_with(name,professional::text || '/'));
  insert into public.account_erasure_jobs(request_id,user_id,provider_id,files) values(p_request_id,target,professional,files);
  update public.profiles set account_deleted_at=now(),full_name='Deleted account',email=target::text || '@deleted.invalid',phone=null,address=null,postcode=null where id=target;
  delete from public.account_profile_details where user_id=target;
  delete from public.customer_addresses where user_id=target;
  delete from public.customer_favourite_providers where user_id=target or provider_id=professional;
  delete from public.notifications where user_id=target;
  delete from public.customer_service_interest where customer_id=target;
  delete from public.booking_checkout_time_choices where customer_id=target;
  if professional is not null then
    update public.providers set display_name='Deleted professional',bio=null,photo_url=null,show_on_our_pros=false,is_suspended=true,vetting_status='rejected' where id=professional;
    delete from public.provider_profile_settings where provider_id=professional;
    delete from public.provider_availability where provider_id=professional;
    delete from public.provider_time_off where provider_id=professional;
    delete from public.provider_task_rates where provider_id=professional;
    delete from public.provider_onboarding_details where provider_id=professional;
    delete from public.provider_verification_items where provider_id=professional;
    delete from public.provider_dbs_checks where provider_id=professional;
  end if;
  -- Closed accounting, agreement and case records remain for the retention
  -- reason recorded by the administrator. Stripe financial records stay there.
  update public.account_deletion_requests set resolution_note=p_retention_note where id=p_request_id;
  return jsonb_build_object('userId',target,'files',files);
end $fn$;
revoke all on function public.prepare_account_erasure(uuid,text) from public,anon,authenticated;
grant execute on function public.prepare_account_erasure(uuid,text) to service_role;
-- Block a stale authenticated JWT even inside a security-definer mutation.
create or replace function public.reject_erased_account_mutation()
returns trigger language plpgsql security definer set search_path=public as $fn$
begin
  if auth.role()='authenticated' and not public.account_is_active() then
    raise exception 'Account is no longer active' using errcode='insufficient_privilege';
  end if;
  if TG_OP='DELETE' then return old; end if;
  return new;
end $fn$;
revoke all on function public.reject_erased_account_mutation() from public,anon,authenticated,service_role;
do $guards$
declare item record;
begin
  for item in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r'
  loop
    execute format('drop trigger if exists reject_erased_account_mutation on public.%I',item.relname);
    execute format('create trigger reject_erased_account_mutation before insert or update or delete on public.%I for each row execute function public.reject_erased_account_mutation()',item.relname);
  end loop;
end $guards$;
commit;
