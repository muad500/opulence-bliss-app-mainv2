begin;

-- The Auth identity, existing customer profile and professional record stay put.
-- Professional statuses and booked pay remain owned by their existing engines.
create table public.partner_role_memberships (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  status text not null default 'applied' check (
    status in ('applied', 'email_verified', 'approved', 'active', 'suspended', 'closed', 'declined')
  ),
  reward_route text check (reward_route in ('gift_card', 'cleaner_payout')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);
alter table public.partner_role_memberships enable row level security;
revoke all on public.partner_role_memberships from public, anon, authenticated;
grant select on public.partner_role_memberships to authenticated;
grant all on public.partner_role_memberships to service_role;
create policy partner_role_self_read on public.partner_role_memberships
  for select to authenticated using (user_id = (select auth.uid()));
create policy partner_role_manager_read on public.partner_role_memberships
  for select to authenticated using ((select public.is_admin()));

create table public.account_role_pay_sources (
  role text primary key check (role in ('customer', 'cleaner', 'handyman', 'partner')),
  pay_source text not null,
  reward_route text check (reward_route in ('none', 'booking_credit', 'cleaner_payout', 'gift_card',
    'decision_required'))
);
insert into public.account_role_pay_sources values
  ('customer', 'customer_receipts', 'booking_credit'),
  ('cleaner', 'existing_cleaning_booking_pay_snapshot', 'cleaner_payout'),
  ('handyman', 'existing_accepted_quote_pay_snapshot', 'none'),
  ('partner', 'future_partner_reward_ledger', 'gift_card');
alter table public.account_role_pay_sources enable row level security;
revoke all on public.account_role_pay_sources from public, anon, authenticated;
grant select on public.account_role_pay_sources to authenticated;
grant all on public.account_role_pay_sources to service_role;
create policy signed_in_role_pay_sources on public.account_role_pay_sources
  for select to authenticated using (true);
comment on table public.account_role_pay_sources is
  'Integration pointers only. No rate, charge, settlement, credit or reward calculation is changed here.';

create function public.guard_partner_role_combination()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare person uuid;
begin
  if tg_table_name = 'providers' then person := new.profile_id;
  else person := new.user_id; end if;
  -- Serialize both directions: a Partner cannot race adding the handyman role.
  perform 1 from public.profiles where id = person for update;
  if tg_table_name = 'providers' then
    if 'handyman' = any(new.services) and exists (
      select 1 from public.partner_role_memberships where user_id = person
        and status not in ('closed', 'declined')
    ) then raise exception 'The Partner and property maintenance roles cannot be combined yet'; end if;
  elsif new.status not in ('closed', 'declined') then
    if exists (select 1 from public.providers where profile_id = person and 'handyman' = any(services)) then
      raise exception 'Property maintenance accounts cannot hold the Partner role yet';
    end if;
    if (tg_op = 'INSERT' or (new.status in ('approved', 'active') and new.status is distinct from old.status))
      and exists (select 1 from public.providers p where p.profile_id = person and 'cleaning' =
        any(p.services)
      and not (p.vetting_status::text = 'approved' and p.is_suspended = false and p.service_approvals ->>
        'cleaning' = 'approved')) then
      raise exception 'The cleaning role must be Active before adding the Partner role';
    end if;
    if new.reward_route = 'cleaner_payout' and not exists (
      select 1 from public.providers where profile_id = person and 'cleaning' = any(services)
    ) then raise exception 'A cleaner payout route requires a cleaning role'; end if;
  end if;
  return new;
end;
$fn$;
create trigger partner_role_combination before insert or update on public.partner_role_memberships
  for each row execute function public.guard_partner_role_combination();
create trigger professional_partner_combination before insert or update of services, profile_id on
  public.providers
  for each row execute function public.guard_partner_role_combination();
revoke all on function public.guard_partner_role_combination() from public, anon, authenticated, service_role;

create function public.my_account_roles()
returns table(role text, status text, pay_source text, reward_route text)
language plpgsql stable security definer set search_path = public as $fn$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles where id = auth.uid() and account_deleted_at is null
  ) then raise exception 'Sign in to your account' using errcode = 'insufficient_privilege'; end if;
  return query
    select 'customer', 'active', s.pay_source, s.reward_route
    from public.account_role_pay_sources s where s.role = 'customer'
    union all
    select case when entry.key = 'cleaning' then 'cleaner' else 'handyman' end,
      case when p.is_suspended then 'suspended'
        when entry.value = 'approved' and p.vetting_status::text = 'approved' then 'active'
        when entry.value = 'pending' then 'applied'
        when entry.value = 'rejected' then 'not_progressed'
        else entry.value end,
      s.pay_source, s.reward_route
    from public.providers p
    cross join lateral jsonb_each_text(p.service_approvals) entry
    join public.account_role_pay_sources s on s.role = case when entry.key = 'cleaning' then 'cleaner'
      else 'handyman' end
    where p.profile_id = auth.uid() and entry.key in ('cleaning', 'handyman')
    union all
    select 'partner', m.status, s.pay_source,
      coalesce(m.reward_route, case when exists (
        select 1 from public.providers where profile_id = auth.uid() and 'cleaning' = any(services)
      ) then 'decision_required' else s.reward_route end)
    from public.partner_role_memberships m
    join public.account_role_pay_sources s on s.role = 'partner'
    where m.user_id = auth.uid();
end;
$fn$;
revoke all on function public.my_account_roles() from public, anon;
grant execute on function public.my_account_roles() to authenticated;

-- Role-level policy bindings share immutable acceptance evidence, not copies of
-- the published text. Cleaner Terms are added only when supplied and published.
create table public.account_role_document_bindings (
  role text not null references public.account_role_pay_sources(role),
  document_slug text not null,
  primary key (role, document_slug)
);
insert into public.account_role_document_bindings values
  ('customer', 'terms'), ('customer', 'cancellation-refund'), ('customer', 'privacy'),
  ('cleaner', 'professional-partner-agreement'), ('cleaner', 'cleaner-terms'),
  ('cleaner', 'cleaner-cancellation'), ('cleaner', 'privacy'), ('cleaner', 'safeguarding'), ('cleaner',
    'dbs-data'),
  ('handyman', 'handyman-professional-terms'), ('handyman', 'privacy'), ('handyman', 'safeguarding'),
    ('handyman', 'dbs-data'),
  ('partner', 'partner-programme'), ('partner', 'privacy');
alter table public.account_role_document_bindings enable row level security;
revoke all on public.account_role_document_bindings from public, anon, authenticated;
grant select on public.account_role_document_bindings to authenticated;
grant all on public.account_role_document_bindings to service_role;
create policy own_role_document_bindings on public.account_role_document_bindings
  for select to authenticated using (exists (
    select 1 from public.my_account_roles() r where r.role = account_role_document_bindings.role
  ));

commit;
notify pgrst, 'reload schema';
