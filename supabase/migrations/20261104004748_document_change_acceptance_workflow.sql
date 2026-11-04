begin;

-- Preparing a change is not publishing it. Only a separately approved legal
-- release can replace public.legal_documents; this migration changes no text.
create table public.document_change_plans (
  id uuid primary key default gen_random_uuid(),
  document_slug text not null,
  version text not null,
  title text not null,
  summary text not null check (length(summary) between 10 and 5000),
  source_content_html text not null,
  content_hash text not null,
  pdf_path text not null,
  pdf_sha256 text not null check (pdf_sha256 ~ '^[a-f0-9]{64}$'),
  effective_at timestamptz not null,
  announced_at timestamptz not null default clock_timestamp(),
  announced_by uuid not null references public.profiles(id),
  unique (document_slug, version)
);
create table public.document_change_recipients (
  plan_id uuid not null references public.document_change_plans(id),
  user_id uuid not null references public.profiles(id) on delete cascade,
  recipient text not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  claim_token uuid,
  leased_until timestamptz,
  sent_at timestamptz,
  last_error text,
  primary key (plan_id, user_id)
);
create table public.role_document_change_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  account_acceptance_id bigint not null references public.account_legal_acceptances(id) on delete cascade,
  role text not null references public.account_role_pay_sources(role),
  plan_id uuid not null references public.document_change_plans(id),
  accepted_at timestamptz not null default clock_timestamp(),
  evidence jsonb not null,
  unique (user_id, role, plan_id)
);
create index document_notice_pending on public.document_change_recipients(next_attempt_at)
  where status in ('pending', 'processing');
create index role_acceptance_lookup on public.role_document_change_acceptances(user_id, role, plan_id);

alter table public.document_change_plans enable row level security;
alter table public.document_change_recipients enable row level security;
alter table public.role_document_change_acceptances enable row level security;
revoke all on public.document_change_plans, public.document_change_recipients,
  public.role_document_change_acceptances from public, anon, authenticated;
grant select on public.document_change_plans, public.document_change_recipients,
  public.role_document_change_acceptances to authenticated, service_role;
create policy change_plans_manager on public.document_change_plans for select to authenticated using
  ((select public.is_admin()));
create policy change_delivery_manager on public.document_change_recipients for select to authenticated
  using ((select public.is_admin()));
create policy role_acceptance_self on public.role_document_change_acceptances for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create trigger document_plan_immutable before update or delete on public.document_change_plans
  for each row execute function public.booking_events_immutable();
-- The existing account-evidence retention gate owns the last-contract-end +
-- six-year clock and legal holds. Cascades are permitted only in that job.
create trigger role_acceptance_immutable before update or delete on public.role_document_change_acceptances
  for each row execute function public.guard_acceptance_evidence_mutation();

create function public.announce_document_change(p_document jsonb, p_summary text, p_effective_at timestamptz)
returns uuid language plpgsql security definer set search_path = public as $fn$
declare result uuid; customers boolean;
begin
  if not public.is_admin() then raise exception 'Manager authenticator sign-in required' using errcode =
    'insufficient_privilege'; end if;
  if (not exists (select 1 from public.account_role_document_bindings where document_slug = p_document
    ->> 'slug')
      and not exists (select 1 from public.legal_documents where slug = p_document ->> 'slug'))
    or coalesce(length(p_document ->> 'version'), 0) not between 1 and 50
    or coalesce(length(p_document ->> 'title'), 0) not between 3 and 120
    or coalesce(length(p_document ->> 'sourceContentHtml'), 0) not between 80 and 500000
    or coalesce(p_document ->> 'pdfSha256', '') !~ '^[a-f0-9]{64}$'
    or coalesce(p_document ->> 'pdfPath', '') !~ '^\d{4}-\d{2}-\d{2}/[a-z0-9-]+\.pdf$'
    or length(btrim(coalesce(p_summary, ''))) not between 10 and 5000
    or p_effective_at is null or p_effective_at <= clock_timestamp()
  then raise exception 'Supply the approved document snapshot, PDF, summary and future effective date';
    end if;
  if exists (select 1 from public.legal_documents where slug = p_document ->> 'slug' and version =
    p_document ->> 'version' and published) then
    raise exception 'A notice cannot be backdated for an already published version'; end if;
  customers := exists (select 1 from public.account_role_document_bindings where document_slug =
    p_document ->> 'slug' and role = 'customer')
    or exists (select 1 from public.legal_documents where slug = p_document ->> 'slug' and audience in
      ('customers', 'everyone'));
  if customers and p_effective_at < clock_timestamp() + interval '30 days' then
    raise exception 'Give customers at least 30 days written notice before a change'; end if;
  insert into public.document_change_plans(document_slug, version, title, summary, source_content_html,
    content_hash,
    pdf_path, pdf_sha256, effective_at, announced_by)
    values (p_document ->> 'slug', p_document ->> 'version', p_document ->> 'title', btrim(p_summary),
      p_document ->> 'sourceContentHtml',
      md5(p_document ->> 'sourceContentHtml'), p_document ->> 'pdfPath', p_document ->> 'pdfSha256',
        p_effective_at, auth.uid()) returning id into result;
  if customers then
    insert into public.document_change_recipients(plan_id, user_id, recipient)
      select result, p.id, u.email from public.profiles p join auth.users u on u.id = p.id
      where p.account_deleted_at is null and p.role::text <> 'admin' and u.email is not null;
  end if;
  return result;
end;
$fn$;
revoke all on function public.announce_document_change(jsonb, text, timestamptz) from public, anon;
grant execute on function public.announce_document_change(jsonb, text, timestamptz) to authenticated;

create function public.guard_document_change_publication()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare plan public.document_change_plans;
begin
  if not new.published then return new; end if;
  if tg_op = 'UPDATE' and new.version = old.version and new.content_html = old.content_html
    and new.pdf_path is not distinct from old.pdf_path and new.pdf_sha256 is not distinct from old.pdf_sha256
    and new.title is not distinct from old.title and to_jsonb(new) -> 'effective_date' is not distinct
      from to_jsonb(old) -> 'effective_date'
  then return new; end if;
  if tg_op = 'UPDATE' and new.version = old.version then raise exception
    'Changed wording needs a new document version'; end if;
  select * into plan from public.document_change_plans where document_slug = new.slug and version =
    new.version;
  if not found or plan.content_hash <> md5(new.content_html) or plan.pdf_sha256 is distinct from
    new.pdf_sha256
    or plan.pdf_path is distinct from new.pdf_path or plan.title is distinct from new.title then
    raise exception 'Prepare the approved version and its change summary before publishing'; end if;
  if plan.effective_at > clock_timestamp() then raise exception
    'The notified effective date has not arrived'; end if;
  if exists (select 1 from public.document_change_recipients r where r.plan_id = plan.id
    and (r.status <> 'sent' or r.sent_at is null or r.sent_at + interval '30 days' > clock_timestamp())) then
    raise exception 'Customer written notice has not completed its 30-day period'; end if;
  return new;
end;
$fn$;
create trigger legal_change_notice_gate before insert or update on public.legal_documents
  for each row execute function public.guard_document_change_publication();
revoke all on function public.guard_document_change_publication() from public, anon, authenticated,
  service_role;

create function public.pending_role_document_changes(p_user uuid, p_role text)
returns setof public.document_change_plans
language sql stable security definer set search_path = public as $fn$
  select change.* from public.document_change_plans change
  join public.account_role_document_bindings binding on binding.document_slug = change.document_slug and
    binding.role = p_role
  join public.legal_documents current_document on current_document.slug = change.document_slug
    and current_document.published and current_document.version = change.version and
      md5(current_document.content_html) = change.content_hash
  where change.effective_at <= now() and not exists (
    select 1 from public.role_document_change_acceptances a where a.user_id = p_user and a.role = p_role
      and a.plan_id = change.id
  ) and not exists (
    select 1 from public.account_legal_acceptances a where a.user_id = p_user and a.document_slug =
      change.document_slug
      and a.version = change.version and (
        (p_role = 'customer' and a.booking_id is not null)
        or (p_role <> 'customer' and a.accepted_at >= change.effective_at
          and coalesce(a.acceptance_evidence -> 'document' ->> 'contentHash', to_jsonb(a) ->>
            'content_hash') = change.content_hash)
      )
  );
$fn$;
revoke all on function public.pending_role_document_changes(uuid, text) from public, anon, authenticated,
  service_role;

create function public.my_role_document_updates(p_role text)
returns table (
  id uuid, document_slug text, version text, title text, summary text,
  source_content_html text, content_hash text, pdf_path text,
  pdf_sha256 text, effective_at timestamptz
)
language plpgsql stable security definer set search_path = public as $fn$
begin
  if not exists (select 1 from public.my_account_roles() where role = p_role) then raise exception
    'Role not found' using errcode = 'insufficient_privilege'; end if;
  return query select p.id, p.document_slug, p.version, p.title, p.summary,
    p.source_content_html, p.content_hash, p.pdf_path, p.pdf_sha256, p.effective_at
    from public.pending_role_document_changes(auth.uid(), p_role) p;
end;
$fn$;
revoke all on function public.my_role_document_updates(text) from public, anon;
grant execute on function public.my_role_document_updates(text) to authenticated;

-- Only the trusted account endpoint can supply the observed request IP.
create function public.accept_role_document_update(p_user uuid, p_role text, p_plan uuid, p_checked
  boolean, p_ip inet, p_user_agent text)
returns void language plpgsql security definer set search_path = public as $fn$
declare plan public.document_change_plans; wording text; evidence jsonb; account_acceptance bigint;
  accepted_at timestamptz := clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted account endpoint required'
    using errcode = 'insufficient_privilege'; end if;
  if p_checked is distinct from true or p_role = 'customer' then raise exception
    'Accept customer changes at the next booking; professionals must tick their acceptance'; end if;
  if not exists (select 1 from public.profiles where id = p_user and account_deleted_at is null) then
    raise exception 'Account unavailable'; end if;
  if p_role in ('cleaner', 'handyman') and not exists (
    select 1 from public.providers where profile_id = p_user and service_approvals ? case when p_role =
      'cleaner' then 'cleaning' else 'handyman' end
  ) then raise exception 'Role not found'; end if;
  if p_role = 'partner' and not exists (select 1 from public.partner_role_memberships where user_id =
    p_user) then raise exception 'Role not found'; end if;
  if p_role not in ('cleaner', 'handyman', 'partner') then raise exception 'Role not found'; end if;
  select * into plan from public.pending_role_document_changes(p_user, p_role) where id = p_plan;
  if not found then
    if exists (select 1 from public.role_document_change_acceptances where user_id = p_user and role =
      p_role and plan_id = p_plan) then return; end if;
    raise exception 'The document version changed; reload before accepting';
  end if;
  wording := 'I have read and accept ' || plan.title || ' (Version ' || plan.version || ').';
  evidence := jsonb_build_object('schemaVersion', 1, 'role', p_role, 'acceptedAt', accepted_at,
    'request', jsonb_build_object('ip', p_ip, 'userAgent', left(p_user_agent, 500)),
    'checkboxes', jsonb_build_array(jsonb_build_object('key', 'document-update', 'text', wording,
      'checked', true)),
    'changeSummary', plan.summary, 'document', jsonb_build_object('slug', plan.document_slug, 'title',
      plan.title, 'version', plan.version,
      'sourceContentHtml', plan.source_content_html, 'contentHash', plan.content_hash, 'pdfSha256',
        plan.pdf_sha256, 'effectiveDate', plan.effective_at));
  insert into public.account_legal_acceptances(user_id, document_slug, version, accepted_at,
    document_title, content_hash, acceptance_evidence)
    values (p_user, plan.document_slug, plan.version, accepted_at, plan.title, plan.content_hash, evidence)
    on conflict (user_id, document_slug, version, booking_id) do nothing;
  select id into strict account_acceptance from public.account_legal_acceptances
    where user_id = p_user and document_slug = plan.document_slug and version = plan.version and
      booking_id is null;
  insert into public.role_document_change_acceptances(user_id, role, plan_id, account_acceptance_id,
    accepted_at, evidence)
    values (p_user, p_role, plan.id, account_acceptance, accepted_at, evidence) on conflict do nothing;
end;
$fn$;
revoke all on function public.accept_role_document_update(uuid, text, uuid, boolean, inet, text) from
  public, anon, authenticated;
grant execute on function public.accept_role_document_update(uuid, text, uuid, boolean, inet, text) to
  service_role;

-- Copy the old implementation without changing the public function's OID;
-- existing RLS policies and cached SQL dependencies must enter the new gate.
do $preserve_service_gate$
declare definition text; copied text;
begin
  select pg_get_functiondef('public.provider_service_approved(uuid,text)'::regprocedure) into definition;
  copied := regexp_replace(definition, '^CREATE OR REPLACE FUNCTION public\.provider_service_approved\(',
    'CREATE OR REPLACE FUNCTION public.provider_service_approved_before_document_updates(');
  if copied = definition then raise exception 'Service approval source changed; inspect before wrapping';
    end if;
  execute copied;
end;
$preserve_service_gate$;
create or replace function public.provider_service_approved(p_provider uuid, p_service text)
returns boolean language sql stable security definer set search_path = public as $fn$
  select public.provider_service_approved_before_document_updates(p_provider, p_service)
    and not exists (select 1 from public.providers provider cross join lateral
      public.pending_role_document_changes(
      provider.profile_id, case when p_service = 'cleaning' then 'cleaner' else 'handyman' end
    ) where provider.id = p_provider);
$fn$;
revoke all on function public.provider_service_approved_before_document_updates(uuid, text) from public,
  anon, authenticated, service_role;
revoke all on function public.provider_service_approved(uuid, text) from public, anon;
grant execute on function public.provider_service_approved(uuid, text) to authenticated, service_role;

create function public.guard_new_cleaning_work_document_updates()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if new.provider_id is not null and exists (
    select 1 from public.providers provider cross join lateral
      public.pending_role_document_changes(provider.profile_id, 'cleaner')
    where provider.id = new.provider_id
  ) then raise exception 'Accept updated professional documents before taking new bookings'; end if;
  return new;
end;
$fn$;
create trigger offer_queue_document_updates before insert on public.booking_offer_queue
  for each row execute function public.guard_new_cleaning_work_document_updates();
create trigger booking_offers_document_updates before insert on public.booking_offers
  for each row execute function public.guard_new_cleaning_work_document_updates();
create trigger assigned_booking_document_updates before insert on public.bookings
  for each row when (new.provider_id is not null) execute function
    public.guard_new_cleaning_work_document_updates();
create trigger accepted_booking_document_updates before update on public.bookings
  for each row when (new.provider_id is not null and new.status::text = 'scheduled' and
    (old.status::text = 'offered' or old.provider_id is distinct from new.provider_id))
  execute function public.guard_new_cleaning_work_document_updates();
revoke all on function public.guard_new_cleaning_work_document_updates() from public, anon,
  authenticated, service_role;

create function public.claim_document_change_emails(p_limit integer default 4)
returns table(plan_id uuid, user_id uuid, recipient text, claim_token uuid, attempts integer, title text,
  version text, summary text, effective_at timestamptz)
language plpgsql security definer set search_path = public as $fn$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  return query with due as (
    select r.plan_id, r.user_id from public.document_change_recipients r
    where (r.status = 'pending' or (r.status = 'processing' and r.leased_until < now()))
      and r.next_attempt_at <= now() and r.attempts < 12
    order by r.next_attempt_at, r.plan_id, r.user_id for update skip locked limit greatest(1,
      least(p_limit, 10))
  ), claimed as (
    update public.document_change_recipients r set status = 'processing', claim_token = gen_random_uuid(),
      leased_until = now() + interval '5 minutes', attempts = r.attempts + 1
    from due where r.plan_id = due.plan_id and r.user_id = due.user_id returning r.*
  ) select c.plan_id, c.user_id, c.recipient, c.claim_token, c.attempts, p.title, p.version, p.summary,
    p.effective_at
    from claimed c join public.document_change_plans p on p.id = c.plan_id;
end;
$fn$;
create function public.finish_document_change_email(p_plan uuid, p_user uuid, p_token uuid, p_sent
  boolean, p_error text default null)
returns boolean language plpgsql security definer set search_path = public as $fn$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  update public.document_change_recipients set status = case when p_sent then 'sent' when attempts >= 12
    then 'failed' else 'pending' end,
    sent_at = case when p_sent then clock_timestamp() else null end, leased_until = null, claim_token = null,
    next_attempt_at = now() + interval '1 minute' * power(2, least(attempts, 6)), last_error = case when
      p_sent then null else left(p_error, 200) end
    where plan_id = p_plan and user_id = p_user and claim_token = p_token and status = 'processing';
  return found;
end;
$fn$;
revoke all on function public.claim_document_change_emails(integer),
  public.finish_document_change_email(uuid, uuid, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.claim_document_change_emails(integer),
  public.finish_document_change_email(uuid, uuid, uuid, boolean, text) to service_role;

create function public.document_change_for_me(p_plan uuid)
returns table (
  id uuid, document_slug text, version text, title text, summary text,
  source_content_html text, content_hash text, pdf_path text,
  pdf_sha256 text, effective_at timestamptz
)
language plpgsql stable security definer set search_path = public as $fn$
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode = 'insufficient_privilege';
    end if;
  return query select plan.id, plan.document_slug, plan.version, plan.title, plan.summary,
    plan.source_content_html, plan.content_hash, plan.pdf_path, plan.pdf_sha256, plan.effective_at
    from public.document_change_plans plan where plan.id = p_plan and (
    exists (select 1 from public.document_change_recipients where plan_id = plan.id and user_id = auth.uid())
    or exists (select 1 from public.my_account_roles() role join public.account_role_document_bindings binding
      on binding.role = role.role where binding.document_slug = plan.document_slug)
  );
end;
$fn$;
revoke all on function public.document_change_for_me(uuid) from public, anon;
grant execute on function public.document_change_for_me(uuid) to authenticated;

-- The accepted current version must still open its approved snapshot, rather
-- than falling back to a registration page bundled with an older legal pack.
create function public.my_role_document_versions(p_role text)
returns table (id uuid, document_slug text, version text)
language plpgsql stable security definer set search_path = public as $fn$
begin
  if not exists (select 1 from public.my_account_roles() r where r.role = p_role) then
    raise exception 'Role not found' using errcode = 'insufficient_privilege';
  end if;
  return query select p.id, p.document_slug, p.version
    from public.document_change_plans p
    join public.account_role_document_bindings b
      on b.document_slug = p.document_slug and b.role = p_role
    join public.legal_documents d on d.slug = p.document_slug
      and d.version = p.version and d.published
      and md5(d.content_html) = p.content_hash
    where p.effective_at <= now();
end;
$fn$;
revoke all on function public.my_role_document_versions(text) from public, anon;
grant execute on function public.my_role_document_versions(text) to authenticated;

create function public.document_change_delivery_summary()
returns table (plan_id uuid, total bigint, sent bigint, pending bigint, failed bigint)
language plpgsql stable security definer set search_path = public as $fn$
begin
  if not public.is_admin() then
    raise exception 'Manager authenticator sign-in required' using errcode = 'insufficient_privilege';
  end if;
  return query select r.plan_id, count(*),
    count(*) filter (where r.status = 'sent'),
    count(*) filter (where r.status in ('pending', 'processing')),
    count(*) filter (where r.status = 'failed')
    from public.document_change_recipients r group by r.plan_id;
end;
$fn$;
revoke all on function public.document_change_delivery_summary() from public, anon;
grant execute on function public.document_change_delivery_summary() to authenticated;

commit;
notify pgrst, 'reload schema';
