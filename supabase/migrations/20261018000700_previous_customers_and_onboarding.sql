begin;

create table public.professional_setup_invitations (
  provider_id uuid primary key references public.providers(id) on delete cascade,
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  setup_completed_at timestamptz
);
alter table public.professional_setup_invitations enable row level security;
revoke all on public.professional_setup_invitations from public, anon, authenticated;
grant all on public.professional_setup_invitations to service_role;
grant select on public.professional_setup_invitations to authenticated;
create policy staff_see_setup_invitations on public.professional_setup_invitations
for select to authenticated using (public.is_admin());

create table public.previous_customer_reviews (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  customer_name text not null check (length(customer_name) between 1 and 100),
  email text not null,
  service_label text not null check (length(service_label) between 1 and 120),
  rating integer check (rating between 1 and 5),
  comment text check (length(comment) between 1 and 2000),
  submitted_at timestamptz,
  status text not null default 'invited' check (status in ('invited', 'pending', 'approved', 'rejected')),
  created_by uuid not null references public.profiles(id),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  expires_at timestamptz not null default now() + interval '30 days',
  created_at timestamptz not null default now(),
  check (status = 'invited' or (rating is not null and comment is not null and submitted_at is not null))
);
alter table public.previous_customer_reviews enable row level security;
revoke all on public.previous_customer_reviews from public, anon, authenticated;
grant all on public.previous_customer_reviews to service_role;
grant select on public.previous_customer_reviews to authenticated;
create policy staff_see_previous_customer_reviews on public.previous_customer_reviews
for select to authenticated using (public.is_admin());

create function public.lock_previous_customer_review()
returns trigger language plpgsql set search_path = public
as $function$
begin
  if old.submitted_at is not null and (
    new.customer_name is distinct from old.customer_name
    or new.email is distinct from old.email or new.service_label is distinct from old.service_label
    or new.rating is distinct from old.rating or new.comment is distinct from old.comment
    or new.submitted_at is distinct from old.submitted_at or new.token_hash is distinct from old.token_hash
  ) then raise exception 'Submitted previous-customer reviews cannot be edited'; end if;
  return new;
end;
$function$;
create trigger immutable_previous_customer_review before update on public.previous_customer_reviews
for each row execute function public.lock_previous_customer_review();

create function public.submit_previous_customer_review(p_token text, p_rating integer, p_comment text)
returns boolean language plpgsql security definer set search_path = public
as $function$
declare result uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;
  if p_token !~ '^[a-f0-9]{64}$' or p_rating not between 1 and 5
    or length(btrim(p_comment)) not between 1 and 2000 then return false; end if;
  update public.previous_customer_reviews set rating = p_rating, comment = btrim(p_comment),
    submitted_at = now(), status = 'pending'
  where token_hash = p_token and status = 'invited' and expires_at > now()
  returning id into result;
  if result is null then return false; end if;
  insert into public.notifications(user_id, title, body, href)
  select id, 'Previous customer review awaiting approval', 'A past customer has submitted an immutable review for moderation.', '/admin/reviews#previous-customers'
  from public.profiles where role = 'admin';
  return true;
end;
$function$;

create function public.moderate_previous_customer_review(p_id uuid, p_status text)
returns boolean language plpgsql security definer set search_path = public
as $function$
declare result uuid;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_status not in ('approved', 'rejected') then raise exception 'Invalid decision'; end if;
  update public.previous_customer_reviews set status = p_status, reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_id and status = 'pending' returning id into result;
  return result is not null;
end;
$function$;

-- These reviews are deliberately separate from all booking-review rating aggregates.
create function public.previous_customer_review_feed()
returns table(id uuid, customer_name text, service_label text, rating integer, comment text, submitted_at timestamptz)
language sql stable security definer set search_path = public
as $function$
  select id, customer_name, service_label, rating, comment, submitted_at
  from public.previous_customer_reviews where status = 'approved'
  order by submitted_at desc limit 60;
$function$;

revoke all on function public.lock_previous_customer_review(),
 public.submit_previous_customer_review(text,integer,text), public.moderate_previous_customer_review(uuid,text),
 public.previous_customer_review_feed() from public, anon, authenticated, service_role;
grant execute on function public.submit_previous_customer_review(text,integer,text) to service_role;
grant execute on function public.moderate_previous_customer_review(uuid,text) to authenticated;
grant execute on function public.previous_customer_review_feed() to anon, authenticated;

create function public.require_invited_professional_setup()
returns trigger language plpgsql security definer set search_path=public as $function$
begin
  if (new.vetting_status = 'approved' or new.service_approvals::text like '%approved%')
    and exists (select 1 from public.professional_setup_invitations where provider_id=new.id and setup_completed_at is null)
  then raise exception 'The recipient must complete their professional application before approval'; end if;
  return new;
end;
$function$;
create trigger require_invited_professional_setup before update of vetting_status,service_approvals on public.providers
for each row execute function public.require_invited_professional_setup();
revoke all on function public.require_invited_professional_setup() from public,anon,authenticated,service_role;

-- An administrator-created placeholder is never eligible until its recipient completes setup.
alter function public.provider_service_approved(uuid,text) rename to provider_service_approved_before_invitation_setup;
create function public.provider_service_approved(p_provider uuid, p_service text)
returns boolean language sql stable security definer set search_path = public
as $function$
  select public.provider_service_approved_before_invitation_setup(p_provider, p_service)
    and not exists (select 1 from public.professional_setup_invitations
      where provider_id = p_provider and setup_completed_at is null);
$function$;
revoke all on function public.provider_service_approved_before_invitation_setup(uuid,text)
 from public, anon, authenticated, service_role;
revoke all on function public.provider_service_approved(uuid,text) from public, anon, authenticated, service_role;
grant execute on function public.provider_service_approved(uuid,text) to authenticated, service_role;

commit;
notify pgrst, 'reload schema';
