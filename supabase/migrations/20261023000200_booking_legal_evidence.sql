-- Additive: install before the new checkout writer. Existing checkout sessions,
-- acceptances and the old three-argument writer keep their original behaviour.
begin;

alter table public.booking_checkout_legal_consents
  add column evidence jsonb,
  add constraint booking_legal_evidence_object check (evidence is null or jsonb_typeof(evidence) = 'object');

create function public.prepare_booking_legal_consent_v2(
  p_user uuid, p_documents jsonb, p_fallbacks jsonb, p_snapshots jsonb, p_evidence jsonb
) returns uuid language plpgsql security definer set search_path = public as $fn$
declare
  doc public.legal_documents; submitted jsonb; fallback jsonb; snapshot jsonb;
  snapshots jsonb := '[]'; v_slug text; result uuid; account jsonb; box jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  if not public.checkout_legal_consent_ready() then raise exception 'Checkout consent installation incomplete'; end if;
  if jsonb_typeof(p_documents) is distinct from 'array' or jsonb_array_length(p_documents) <> 3
     or jsonb_typeof(p_snapshots) is distinct from 'array' or jsonb_array_length(p_snapshots) <> 3
     or jsonb_typeof(p_evidence) is distinct from 'object' or p_evidence->>'schemaVersion' is distinct from '1'
     or jsonb_typeof(p_evidence->'checkboxes') is distinct from 'array'
     or jsonb_array_length(p_evidence->'checkboxes') not between 1 and 3
     or jsonb_typeof(p_evidence->'request') is distinct from 'object'
     or octet_length(p_evidence::text) > 12000 then raise exception 'Invalid acceptance evidence'; end if;
  if (select count(*) from jsonb_array_elements(p_evidence->'checkboxes') x where x->>'key'='booking_policies') <> 1
     or (select count(distinct x->>'key') from jsonb_array_elements(p_evidence->'checkboxes') x) <> jsonb_array_length(p_evidence->'checkboxes')
     then raise exception 'Invalid checkbox evidence'; end if;
  for box in select value from jsonb_array_elements(p_evidence->'checkboxes') loop
    if box->>'key' not in ('booking_policies','early_start','saved_card')
       or box->'checked' is distinct from 'true'::jsonb
       or coalesce(length(box->>'text'),0) not between 10 and 2000
       then raise exception 'Invalid checkbox evidence'; end if;
  end loop;
  select jsonb_build_object('userId',p.id,'name',p.full_name,'email',u.email) into account
    from public.profiles p join auth.users u on u.id=p.id
    where p.id=p_user and p.account_deleted_at is null and u.email is not null;
  if account is null then raise exception 'Account unavailable'; end if;

  foreach v_slug in array array['terms','cancellation-refund','privacy'] loop
    if (select count(*) from jsonb_array_elements(p_documents) x where x->>'slug'=v_slug) <> 1
       or (select count(*) from jsonb_array_elements(p_snapshots) x where x->>'slug'=v_slug) <> 1
       then raise exception 'Invalid acceptance'; end if;
    select value into submitted from jsonb_array_elements(p_documents) where value->>'slug'=v_slug;
    select value into snapshot from jsonb_array_elements(p_snapshots) where value->>'slug'=v_slug;
    select * into doc from public.legal_documents d where d.slug=v_slug and d.published and nullif(d.content_html,'') is not null for share;
    if found then
      if coalesce((submitted->>'isFallback')::boolean,false)
         or submitted->>'version' is distinct from doc.version
         or (submitted->>'updatedAt')::timestamptz is distinct from doc.updated_at
         or snapshot->>'sourceContentHtml' is distinct from doc.content_html
         then raise exception 'Booking policies changed; accept the latest documents' using errcode='40001'; end if;
    else
      select value into fallback from jsonb_array_elements(p_fallbacks) where value->>'slug'=v_slug;
      if fallback is null or submitted->>'version' is distinct from fallback->>'version'
         or not coalesce((submitted->>'isFallback')::boolean,false) or submitted->>'updatedAt' is not null
         or md5(snapshot->>'sourceContentHtml') is distinct from fallback->>'contentHash'
         then raise exception 'Booking policy source changed' using errcode='40001'; end if;
    end if;
    if snapshot->>'version' is distinct from submitted->>'version'
       or (snapshot->>'updatedAt')::timestamptz is distinct from (submitted->>'updatedAt')::timestamptz
       or snapshot->'isFallback' is distinct from coalesce(submitted->'isFallback','false'::jsonb)
       or md5(snapshot->>'sourceContentHtml') is distinct from snapshot->>'contentHash'
       or md5(snapshot->>'contentHtml') is distinct from snapshot->>'displayContentHash'
       or coalesce(length(snapshot->>'title'),0) not between 1 and 200
       or coalesce(octet_length(snapshot->>'contentHtml'),0) not between 1 and 500000
       or coalesce(octet_length(snapshot->>'sourceContentHtml'),0) not between 1 and 500000
       then raise exception 'Invalid policy snapshot'; end if;
    snapshots := snapshots || jsonb_build_array(snapshot);
  end loop;
  insert into public.booking_checkout_legal_consents(user_id,documents,evidence)
    values(p_user,snapshots,p_evidence || jsonb_build_object('account',account)) returning id into result;
  return result;
end $fn$;
revoke all on function public.prepare_booking_legal_consent_v2(uuid,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.prepare_booking_legal_consent_v2(uuid,jsonb,jsonb,jsonb,jsonb) to service_role;

create function public.checkout_legal_evidence_ready()
returns boolean language sql stable security definer set search_path=public as $fn$
  select public.checkout_legal_consent_ready()
    and to_regprocedure('public.prepare_booking_legal_consent_v2(uuid,jsonb,jsonb,jsonb,jsonb)') is not null;
$fn$;
revoke all on function public.checkout_legal_evidence_ready() from public;
grant execute on function public.checkout_legal_evidence_ready() to anon,authenticated,service_role;

-- Corrections require a new acceptance; nobody can rewrite existing evidence.
-- Deletion remains reserved to service-role retention/account-erasure tooling.
create function public.deny_booking_legal_evidence_update()
returns trigger language plpgsql set search_path=public as $fn$
begin
  raise exception 'Booking legal evidence is immutable' using errcode='insufficient_privilege';
end $fn$;
revoke all on function public.deny_booking_legal_evidence_update() from public,anon,authenticated,service_role;
create trigger booking_legal_evidence_immutable before update on public.booking_checkout_legal_consents
  for each row execute function public.deny_booking_legal_evidence_update();
create trigger booking_acceptance_immutable before update on public.account_legal_acceptances
  for each row when (old.booking_id is not null) execute function public.deny_booking_legal_evidence_update();

create function public._booking_legal_contract(p_consent uuid)
returns jsonb language sql stable security definer set search_path=public as $fn$
  select jsonb_build_object('id',c.id,'acceptedAt',c.accepted_at,'documents',c.documents,'evidence',c.evidence,
    'bookings',(select jsonb_agg(jsonb_build_object('id',x.id,'service',x.service,'scheduledAt',x.scheduled_at) order by x.scheduled_at,x.id)
      from (select distinct b.id,b.scheduled_at,coalesce(p.name,'Cleaning') service
        from public.account_legal_acceptances a join public.bookings b on b.id=a.booking_id
        left join public.packages p on p.id=b.package_id where a.checkout_legal_consent_id=c.id) x))
  from public.booking_checkout_legal_consents c where c.id=p_consent and c.evidence is not null;
$fn$;
revoke all on function public._booking_legal_contract(uuid) from public,anon,authenticated,service_role;

create function public.booking_legal_contract(p_booking uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $fn$
declare consent uuid;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode='insufficient_privilege'; end if;
  select a.checkout_legal_consent_id into consent from public.account_legal_acceptances a
    join public.bookings b on b.id=a.booking_id
    where b.id=p_booking and a.document_slug='terms'
      and (b.customer_id=auth.uid() or public.is_admin());
  if consent is null then return null; end if;
  return public._booking_legal_contract(consent);
end $fn$;
revoke all on function public.booking_legal_contract(uuid) from public,anon;
grant execute on function public.booking_legal_contract(uuid) to authenticated;

-- One essential contract email per checkout, including a regular series.
-- It uses its own queue so optional reminder/SMS preferences cannot suppress it.
create table public.booking_legal_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  consent_id uuid not null unique references public.booking_checkout_legal_consents(id) on delete cascade,
  primary_booking_id uuid not null references public.bookings(id) on delete cascade,
  email text not null,
  status text not null default 'pending' check(status in ('pending','processing','sent','failed','needs_review')),
  attempts integer not null default 0,
  due_at timestamptz not null default now(),
  claimed_at timestamptz,
  claim_token uuid,
  first_attempt_at timestamptz,
  sent_at timestamptz,
  payload jsonb,
  last_error text
);
create index booking_legal_email_due on public.booking_legal_email_deliveries(due_at) where status in ('pending','processing');
alter table public.booking_legal_email_deliveries enable row level security;
revoke all on public.booking_legal_email_deliveries from public,anon,authenticated,service_role;

create function public.queue_booking_legal_email()
returns trigger language plpgsql security definer set search_path=public as $fn$
declare destination text;
begin
  select c.evidence->'account'->>'email' into destination from public.booking_checkout_legal_consents c
    where c.id=new.checkout_legal_consent_id and c.evidence is not null;
  if destination is not null then
    insert into public.booking_legal_email_deliveries(consent_id,primary_booking_id,email)
      values(new.checkout_legal_consent_id,new.booking_id,destination) on conflict(consent_id) do nothing;
  end if;
  return new;
end $fn$;
revoke all on function public.queue_booking_legal_email() from public,anon,authenticated,service_role;
create trigger booking_legal_contract_email after insert on public.account_legal_acceptances
  for each row when (new.booking_id is not null and new.document_slug='terms') execute function public.queue_booking_legal_email();

create function public.claim_booking_legal_emails(p_email_ready boolean)
returns table(id uuid,claim_token uuid,email text,contract jsonb,payload jsonb)
language plpgsql security definer set search_path=public as $fn$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  if not p_email_ready then return; end if;
  -- Resend's idempotency window is 24 hours. Uncertain older attempts need a
  -- delivery check by staff rather than a possible second email.
  update public.booking_legal_email_deliveries d set status='needs_review',claim_token=null,last_error='Check provider delivery before retrying an older attempt'
    where d.status in ('pending','processing') and d.first_attempt_at < now()-interval '23 hours';
  update public.booking_legal_email_deliveries d set status='failed',claim_token=null,last_error='Delivery lease expired after final attempt'
    where d.status='processing' and d.attempts>=8 and d.claimed_at < now()-interval '5 minutes';
  return query with candidates as (
    select d.id from public.booking_legal_email_deliveries d where d.attempts<8 and d.due_at<=now()
      and (d.status='pending' or (d.status='processing' and d.claimed_at<now()-interval '5 minutes'))
      order by d.due_at,d.id limit 5 for update skip locked
  ), claimed as (
    update public.booking_legal_email_deliveries d set status='processing',claimed_at=now(),claim_token=gen_random_uuid(),attempts=d.attempts+1
      from candidates c where c.id=d.id returning d.*
  ) select c.id,c.claim_token,c.email,public._booking_legal_contract(c.consent_id),c.payload from claimed c;
end $fn$;
revoke all on function public.claim_booking_legal_emails(boolean) from public,anon,authenticated;
grant execute on function public.claim_booking_legal_emails(boolean) to service_role;

create function public.store_booking_legal_email_payload(p_id uuid,p_token uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare result jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>8000000 then raise exception 'Invalid email payload'; end if;
  update public.booking_legal_email_deliveries d set payload=coalesce(d.payload,p_payload),first_attempt_at=coalesce(d.first_attempt_at,now())
    where d.id=p_id and d.claim_token=p_token and d.status='processing'
      and p_payload->'to'=jsonb_build_array(d.email)
    returning d.payload into result;
  if result is null then raise exception 'Delivery lease changed'; end if;
  return result;
end $fn$;
revoke all on function public.store_booking_legal_email_payload(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.store_booking_legal_email_payload(uuid,uuid,jsonb) to service_role;

create function public.finish_booking_legal_email(p_id uuid,p_token uuid,p_ok boolean,p_error text default null)
returns boolean language plpgsql security definer set search_path=public as $fn$
declare changed integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  update public.booking_legal_email_deliveries d set
    status=case when p_ok then 'sent' when d.attempts>=8 then 'failed' else 'pending' end,
    sent_at=case when p_ok then now() else null end,
    due_at=case when p_ok then d.due_at else now()+make_interval(mins=>least(d.attempts*d.attempts,60)) end,
    last_error=left(p_error,300),claim_token=null
    where d.id=p_id and d.claim_token=p_token and d.status='processing';
  get diagnostics changed=row_count;
  return changed=1;
end $fn$;
revoke all on function public.finish_booking_legal_email(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.finish_booking_legal_email(uuid,uuid,boolean,text) to service_role;

create function public.admin_booking_legal_email_status(p_booking uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $fn$
declare result jsonb;
begin
  if not public.is_admin() then raise exception 'Admin access required' using errcode='insufficient_privilege'; end if;
  select jsonb_build_object('status',d.status,'attempts',d.attempts,'sentAt',d.sent_at,'lastError',d.last_error) into result
    from public.booking_legal_email_deliveries d join public.account_legal_acceptances a on a.checkout_legal_consent_id=d.consent_id
    where a.booking_id=p_booking and a.document_slug='terms';
  return result;
end $fn$;
revoke all on function public.admin_booking_legal_email_status(uuid) from public,anon;
grant execute on function public.admin_booking_legal_email_status(uuid) to authenticated;

commit;
