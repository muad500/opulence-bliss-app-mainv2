begin;

-- Testimonials remain visible separately; the score has a booking record for
-- every rating. Private ratings contribute anonymously, never their words.
create or replace function public.public_review_summary(p_service_type text default 'cleaning')
returns table(rating_avg numeric,rating_count integer)
language sql stable security definer set search_path=public as $fn$
 select avg(r.rating)::numeric(3,2),count(*)::integer
 from public.reviews r join public.bookings b on b.id=r.booking_id
 join public.packages pk on pk.id=b.package_id
 where r.reviewer='client' and pk.service_type=p_service_type;
$fn$;
revoke all on function public.public_review_summary(text) from public;
grant execute on function public.public_review_summary(text) to anon,authenticated;

alter table public.account_profile_details
 add column if not exists last_account_mode text not null default 'client' check(last_account_mode in('client','professional')),
 add column if not exists marketing_consent_at timestamptz;
create table public.account_marketing_consents(
 id bigint generated always as identity primary key,
 user_id uuid not null references public.profiles(id) on delete cascade,
 opted_in boolean not null,
 recorded_at timestamptz not null default now(),
 wording_version text not null default 'offers-and-news-v1'
);
alter table public.account_marketing_consents enable row level security;
grant select on public.account_marketing_consents to authenticated;
grant all on public.account_marketing_consents to service_role;
grant usage,select on sequence public.account_marketing_consents_id_seq to service_role;
create policy "read own marketing consent" on public.account_marketing_consents for select to authenticated using(user_id=auth.uid());
create or replace function public.record_marketing_choice()
returns trigger language plpgsql security definer set search_path=public as $fn$
begin
 if (tg_op='INSERT' and new.marketing_emails) or
    (tg_op='UPDATE' and new.marketing_emails is distinct from old.marketing_emails) then
   new.marketing_consent_at:=case when new.marketing_emails then now() else null end;
   insert into public.account_marketing_consents(user_id,opted_in) values(new.user_id,new.marketing_emails);
 elsif tg_op='UPDATE' then new.marketing_consent_at:=old.marketing_consent_at;
 else new.marketing_consent_at:=null;
 end if;
 return new;
end $fn$;
create trigger record_marketing_choice before insert or update on public.account_profile_details for each row execute function public.record_marketing_choice();
revoke all on function public.record_marketing_choice() from public,anon,authenticated;
-- A pre-existing preference without a dated record is not permission to send.
create or replace function public.marketing_email_permitted(p_user_id uuid)
returns boolean language sql stable security definer set search_path=public as $fn$
 select coalesce((select marketing_emails and marketing_consent_at is not null from public.account_profile_details where user_id=p_user_id),false);
$fn$;
revoke all on function public.marketing_email_permitted(uuid) from public,anon,authenticated;
grant execute on function public.marketing_email_permitted(uuid) to service_role;
commit;
