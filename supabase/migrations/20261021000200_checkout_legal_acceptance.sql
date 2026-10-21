-- Phase A is backward-compatible with the existing professional-signup writer.
-- Phase B activates checkout after the new web code is deployed.
begin;
create table public.booking_checkout_legal_consents (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 documents jsonb not null,
 accepted_at timestamptz not null default now()
);
alter table public.booking_checkout_legal_consents enable row level security;
revoke all on public.booking_checkout_legal_consents from public,anon,authenticated;
grant select,insert,delete on public.booking_checkout_legal_consents to service_role;
alter table public.booking_checkout_time_choices add column legal_consent_id uuid unique references public.booking_checkout_legal_consents(id);
alter table public.booking_checkout_time_choices add column legal_consent_required boolean not null default false,
 add constraint checkout_legal_evidence_required check(not legal_consent_required or legal_consent_id is not null);
alter table public.account_legal_acceptances
 add column booking_id uuid references public.bookings(id) on delete cascade,
 add column checkout_legal_consent_id uuid references public.booking_checkout_legal_consents(id),
 add column document_title text,
 add column content_hash text;
create unique index account_legal_acceptances_booking_unique
 on public.account_legal_acceptances(user_id,document_slug,version,booking_id) nulls not distinct;
create index account_legal_acceptances_booking_idx on public.account_legal_acceptances(booking_id) where booking_id is not null;

create function public.checkout_legal_consent_ready()
returns boolean language sql stable security definer set search_path=public as $$
 select not exists(select 1 from pg_constraint c
  where c.conrelid='public.account_legal_acceptances'::regclass and c.contype='u'
   and (select array_agg(a.attname::text order by k.ordinality) from unnest(c.conkey) with ordinality k(attnum,ordinality)
    join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum)=array['user_id','document_slug','version']);
$$;
revoke all on function public.checkout_legal_consent_ready() from public;
grant execute on function public.checkout_legal_consent_ready() to anon,authenticated,service_role;

create function public.prepare_booking_legal_consent(p_user uuid,p_documents jsonb,p_fallbacks jsonb default '[]')
returns uuid language plpgsql security definer set search_path=public as $$
declare doc public.legal_documents; submitted jsonb; fallback jsonb; snapshot jsonb:='[]'; result uuid; v_slug text; has_published boolean;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
 if not public.checkout_legal_consent_ready() then raise exception 'Checkout consent installation incomplete'; end if;
 if jsonb_typeof(p_documents) is distinct from 'array' or jsonb_array_length(p_documents)<>3 then raise exception 'Invalid acceptance'; end if;
 if not exists(select 1 from public.profiles where id=p_user and account_deleted_at is null) then raise exception 'Account unavailable'; end if;
 foreach v_slug in array array['terms','cancellation-refund','privacy'] loop
  select * into doc from public.legal_documents d where d.slug=v_slug and d.published and nullif(d.content_html,'') is not null for share;
  has_published:=found;
  if (select count(*) from jsonb_array_elements(p_documents) item where item->>'slug'=v_slug)<>1 then raise exception 'Invalid acceptance'; end if;
  select item into submitted from jsonb_array_elements(p_documents) item where item->>'slug'=v_slug;
  if has_published then
  if coalesce((submitted->>'isFallback')::boolean,false) or submitted->>'version' is distinct from doc.version or (submitted->>'updatedAt')::timestamptz is distinct from doc.updated_at
   then raise exception 'Booking policies changed; accept the latest documents' using errcode='40001'; end if;
  snapshot:=snapshot||jsonb_build_array(jsonb_build_object('slug',doc.slug,'title',doc.title,'version',doc.version,'updatedAt',doc.updated_at,'contentHash',md5(doc.content_html)));
  else
   -- These defaults come from the trusted server's built-in public page, never
   -- from browser input. Missing/unpublished policy rows are NOT created here.
   select item into fallback from jsonb_array_elements(p_fallbacks) item where item->>'slug'=v_slug;
   if fallback is null or submitted->>'version' is distinct from fallback->>'version'
    or not coalesce((submitted->>'isFallback')::boolean,false) or submitted->>'updatedAt' is not null
    then raise exception 'Booking policy source changed' using errcode='40001'; end if;
   snapshot:=snapshot||jsonb_build_array(fallback);
  end if;
 end loop;
 insert into public.booking_checkout_legal_consents(user_id,documents) values(p_user,snapshot) returning id into result;
 return result;
end;
$$;
revoke all on function public.prepare_booking_legal_consent(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.prepare_booking_legal_consent(uuid,jsonb,jsonb) to service_role;

create function public.attach_booking_legal_acceptances()
returns trigger language plpgsql security definer set search_path=public as $$
declare checkout text:=new.checkout_session_id; consent uuid; evidence public.booking_checkout_legal_consents;
begin
 -- Later regular visits inherit the SAME checkout evidence, not a new inferred
 -- acceptance. All records commit atomically with the series/booking inserts.
 if checkout is null and new.regular_series_id is not null then
  select checkout_session_id into checkout from public.regular_booking_series where id=new.regular_series_id;
 end if;
 if checkout is null then return new; end if;
 select legal_consent_id into consent from public.booking_checkout_time_choices where checkout_session_id=checkout and customer_id=new.customer_id;
 if consent is null then return new; end if; -- Existing/pre-release checkouts.
 select * into strict evidence from public.booking_checkout_legal_consents where id=consent and user_id=new.customer_id;
 insert into public.account_legal_acceptances(user_id,document_slug,version,accepted_at,booking_id,checkout_legal_consent_id,document_title,content_hash)
 select new.customer_id,item->>'slug',item->>'version',evidence.accepted_at,new.id,evidence.id,item->>'title',item->>'contentHash'
 from jsonb_array_elements(evidence.documents) item
 on conflict(user_id,document_slug,version,booking_id) do nothing;
 return new;
end;
$$;
revoke all on function public.attach_booking_legal_acceptances() from public,anon,authenticated,service_role;
create trigger attach_booking_legal_acceptances after insert on public.bookings for each row execute function public.attach_booking_legal_acceptances();

create function public.admin_booking_legal_acceptances(p_booking_ids uuid[])
returns table(booking_id uuid,user_id uuid,document_slug text,document_title text,version text,accepted_at timestamptz)
language plpgsql security definer set search_path=public as $$
begin
 if not public.is_admin() then raise exception 'Admin access required'; end if;
 if cardinality(p_booking_ids)>150 then raise exception 'Too many bookings'; end if;
 return query select a.booking_id,a.user_id,a.document_slug,a.document_title,a.version,a.accepted_at
  from public.account_legal_acceptances a where a.booking_id=any(p_booking_ids) order by a.booking_id,a.document_slug;
end;
$$;
revoke all on function public.admin_booking_legal_acceptances(uuid[]) from public,anon;
grant execute on function public.admin_booking_legal_acceptances(uuid[]) to authenticated;
commit;
