begin;

-- Additive reader prerequisite only. The legacy providers policies and their
-- grants are deliberately left unchanged for the separate restriction phase.
-- Anonymous callers must never execute account/staff helpers directly: Stage 1
-- correctly restricts them. This fixed-path definer returns only row visibility,
-- preserving those helpers' actual account/MFA predicates under the caller JWT.
create function public.customer_provider_card_visible(p_provider uuid)
returns boolean language plpgsql stable security definer set search_path = ''
as $function$
declare caller uuid := auth.uid();
begin
  if exists(select 1 from public.public_eligible_provider_ids() e where e.id=p_provider) then
    return true;
  end if;
  if caller is null then return false; end if;
  if not public.account_is_active() then return false; end if;
  return exists(select 1 from public.providers p where p.id=p_provider and (
    p.profile_id=caller
    or public.can_review_professional()
    or exists(select 1 from public.bookings b where b.provider_id=p.id and b.customer_id=caller)
    or exists(select 1 from public.customer_favourite_providers f where f.provider_id=p.id and f.user_id=caller)
  ));
end;
$function$;
revoke all on function public.customer_provider_card_visible(uuid) from public,anon,authenticated,service_role;
grant execute on function public.customer_provider_card_visible(uuid) to anon,authenticated,service_role;

-- No full stored name, biography, profile/contact/payout identifiers, documents,
-- addresses or staff notes. Keep the previously deployed customer card shape.
create or replace view public.customer_provider_cards with (security_barrier = true) as
select p.id,p.customer_first_name,p.photo_url,
  p.public_rating_avg,p.public_rating_count,
  p.public_rating_avg as rating_avg,p.public_rating_count as rating_count,
  null::text as bio,null::integer as years_experience,array[]::text[] as services,
  p.vetting_status,p.dbs_verified,p.is_suspended,p.show_on_our_pros
from public.providers p where public.customer_provider_card_visible(p.id);
revoke all on public.customer_provider_cards from public,anon,authenticated;
grant select on public.customer_provider_cards to anon,authenticated,service_role;

create or replace function public.customer_provider_card(public.bookings)
returns setof public.customer_provider_cards rows 1
language sql stable set search_path = '' as $function$
  select p.* from public.customer_provider_cards p where p.id=($1).provider_id;
$function$;
revoke all on function public.customer_provider_card(public.bookings) from public;
grant execute on function public.customer_provider_card(public.bookings) to anon,authenticated,service_role;

notify pgrst, 'reload schema';
commit;
