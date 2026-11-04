begin;

-- Expansion phase: install the safe projection before deploying updated
-- customer readers. The following migration closes the legacy table policy
-- only after all staging clients have moved to the safe projection.

-- Definer view, with an explicit whitelist, rather than a security-invoker view
-- that would be empty after the private-table restriction. Never add stored
-- display_name, profile_id, contact, payout, document or suspension notes here.
create view public.customer_provider_cards with (security_barrier = true) as
select p.id, p.customer_first_name, p.photo_url,
  p.public_rating_avg, p.public_rating_count,
  p.public_rating_avg as rating_avg, p.public_rating_count as rating_count,
  -- Preserve the old UI shape without disclosing stored biographical fields.
  -- Customer identity cards now expose only first name, photo and ratings.
  null::text as bio, null::integer as years_experience, array[]::text[] as services,
  p.vetting_status, p.dbs_verified, p.is_suspended, p.show_on_our_pros
from public.providers p
where exists (select 1 from public.public_eligible_provider_ids() eligible where eligible.id=p.id)
  or (auth.uid() is not null and public.account_is_active() and (
    p.profile_id=auth.uid()
    or public.can_review_professional()
    or exists(select 1 from public.bookings b where b.provider_id=p.id and b.customer_id=auth.uid())
    or exists(select 1 from public.customer_favourite_providers f where f.provider_id=p.id and f.user_id=auth.uid())
  ));
revoke all on public.customer_provider_cards from public,anon,authenticated;
grant select on public.customer_provider_cards to anon,authenticated,service_role;

-- Computed PostgREST relationship keeps the private providers relation out of
-- customer booking embeds, without changing staff/worker joins on that table.
create function public.customer_provider_card(public.bookings)
returns setof public.customer_provider_cards rows 1
language sql stable set search_path = '' as $function$
  select p.* from public.customer_provider_cards p where p.id=($1).provider_id;
$function$;
revoke all on function public.customer_provider_card(public.bookings) from public;
grant execute on function public.customer_provider_card(public.bookings) to anon,authenticated,service_role;

notify pgrst, 'reload schema';
commit;
