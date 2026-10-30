begin;

alter table public.account_marketing_consents
  add column wording text,
  add column source text,
  add column request_ip inet,
  add column reference_id uuid;
create unique index marketing_consent_reference
  on public.account_marketing_consents(user_id, source, reference_id)
  where reference_id is not null;

-- Minimal suppression survives erasure of the ordinary contact profile. It is
-- private and cannot itself be used as a marketing contact list.
create table public.marketing_suppressions (
  email_fingerprint text primary key,
  suppressed_at timestamptz not null default now()
);
alter table public.marketing_suppressions enable row level security;
revoke all on public.marketing_suppressions from public, anon, authenticated;
grant all on public.marketing_suppressions to service_role;

create function public.record_final_marketing_consent(
  p_user uuid, p_source text, p_ip text default null, p_reference uuid default null
) returns void language plpgsql security definer set search_path=public as $fn$
declare v_email text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required';
  end if;
  if p_source not in ('checkout','professional_registration') then
    raise exception 'Invalid consent source';
  end if;
  select email into v_email from public.profiles
    where id=p_user and account_deleted_at is null;
  if v_email is null then raise exception 'Account unavailable'; end if;
  if p_source='checkout' and not exists (
    select 1 from public.booking_checkout_legal_consents
      where id=p_reference and user_id=p_user
  ) then raise exception 'Checkout evidence unavailable'; end if;
  insert into public.account_profile_details(user_id,marketing_emails)
    values (p_user,true)
    on conflict(user_id) do update set marketing_emails=true;
  insert into public.account_marketing_consents
    (user_id,opted_in,wording_version,wording,source,request_ip,reference_id)
  values (p_user,true,'final-pack-1.0',
    'Send me offers and news by email. I can unsubscribe at any time.',
    p_source,p_ip::inet,p_reference)
  on conflict(user_id,source,reference_id) where reference_id is not null do nothing;
  delete from public.marketing_suppressions
    where email_fingerprint=encode(sha256(convert_to(lower(btrim(v_email)),'UTF8')),'hex');
end;
$fn$;
revoke all on function public.record_final_marketing_consent(uuid,text,text,uuid)
  from public,anon,authenticated;
grant execute on function public.record_final_marketing_consent(uuid,text,text,uuid) to service_role;

create function public.suppress_unsubscribed_marketing()
returns trigger language plpgsql security definer set search_path=public as $fn$
declare v_email text;
begin
  if old.marketing_emails and not new.marketing_emails then
    select email into v_email from public.profiles where id=new.user_id;
    if v_email is not null then
      insert into public.marketing_suppressions(email_fingerprint)
        values (encode(sha256(convert_to(lower(btrim(v_email)),'UTF8')),'hex'))
        on conflict(email_fingerprint) do nothing;
    end if;
  end if;
  return new;
end;
$fn$;
revoke all on function public.suppress_unsubscribed_marketing() from public,anon,authenticated;
create trigger suppress_unsubscribed_marketing after update of marketing_emails
  on public.account_profile_details for each row execute function public.suppress_unsubscribed_marketing();

create or replace function public.marketing_email_permitted(p_user_id uuid)
returns boolean language sql stable security definer set search_path=public as $fn$
  select coalesce((select d.marketing_emails and d.marketing_consent_at is not null
    and not exists(select 1 from public.marketing_suppressions s
      where s.email_fingerprint=encode(sha256(convert_to(lower(btrim(p.email)),'UTF8')),'hex'))
    from public.account_profile_details d join public.profiles p on p.id=d.user_id
    where d.user_id=p_user_id and p.account_deleted_at is null),false);
$fn$;

-- These are confirmed database facts, not amounts supplied by the browser.
-- Older email payloads already frozen for retry are deliberately not rewritten.
create or replace function public._booking_legal_contract(p_consent uuid)
returns jsonb language sql stable security definer set search_path=public as $fn$
  select jsonb_build_object(
    'id',c.id,'acceptedAt',c.accepted_at,'documents',c.documents,'evidence',c.evidence,
    'bookings',(select jsonb_agg(jsonb_build_object(
      'id',x.id,'service',x.service,'scheduledAt',x.scheduled_at,
      'hours',x.hours,'totalPaidPence',x.paid
    ) order by x.scheduled_at,x.id) from (
      select distinct b.id,b.scheduled_at,coalesce(p.name,'Cleaning') service,
        coalesce((select sum((line->>'reservedMinutes')::numeric)/60
          from public.booking_visit_billing bill
          cross join lateral jsonb_array_elements(bill.line_items) line
          where bill.booking_id=b.id and line->>'id'='cleaning'),
          b.duration_minutes::numeric/60) hours,
        coalesce((select sum(ch.amount_pence-ch.refunded_pence)
          from public.booking_visit_charges ch where ch.booking_id=b.id),0) paid
      from public.account_legal_acceptances a
      join public.bookings b on b.id=a.booking_id
      left join public.packages p on p.id=b.package_id
      where a.checkout_legal_consent_id=c.id
    ) x)
  ) from public.booking_checkout_legal_consents c
    where c.id=p_consent and c.evidence is not null;
$fn$;

commit;
notify pgrst, 'reload schema';
