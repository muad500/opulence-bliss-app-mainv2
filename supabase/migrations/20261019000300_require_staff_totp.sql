begin;

-- All current staff accounts use the administrator role. A password-only
-- session must never gain administrator RLS or RPC privileges, even by using
-- Supabase directly instead of the website. Public and self-profile reads stay
-- available so first-time staff can reach authenticator setup.
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $function$
  select coalesce(auth.jwt()->>'aal' = 'aal2', false)
    and exists (select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]'::jsonb)) entry where entry->>'method' = 'totp')
    and exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and account_deleted_at is null)
    and exists (select 1 from auth.mfa_factors where user_id = auth.uid() and factor_type = 'totp' and status = 'verified');
$function$;

-- This older policy checked the role directly rather than is_admin().
alter policy service_events_read on public.provider_service_events using (
  public.is_admin() or exists (select 1 from public.providers where providers.id = provider_service_events.provider_id and providers.profile_id = auth.uid())
);

-- Preserve the existing booking/review implementations and their grants, while
-- closing role-only branches in legacy SECURITY DEFINER functions (including
-- functions called indirectly by newer wrappers). Fail closed on schema drift.
do $migration$
declare v_signature text; v_oid regprocedure; v_source text; v_replacement text; v_definition text;
begin
  foreach v_signature in array array[
    'public._case_admin()',
    'public.account_booking_actor(uuid,boolean)',
    'public.modify_customer_booking(uuid,timestamptz,uuid,text,boolean,text,jsonb)',
    'public.guard_professional_service_approvals()',
    'public.send_booking_message_before_contact_decisions(uuid,text)',
    'public.review_professional_service_before_client_documents(uuid,text,text,text)'
  ] loop
    v_oid:=to_regprocedure(v_signature);
    if v_oid is null then raise exception 'Expected staff function missing: %',v_signature; end if;
    select prosrc,pg_get_functiondef(oid) into v_source,v_definition from pg_proc where oid=v_oid;
    v_replacement:=regexp_replace(v_source,E'\\mbegin\\M',
      E'begin\n  if exists (select 1 from public.profiles where id=auth.uid() and role::text=''admin'') and not public.is_admin() then\n    raise exception ''Authenticator sign-in required'' using errcode=''insufficient_privilege'';\n  end if;','i');
    if v_source=v_replacement then raise exception 'Staff function guard could not be installed'; end if;
    execute replace(v_definition,v_source,v_replacement);
  end loop;
  v_oid:='public.professional_duplicate_warnings(uuid)'::regprocedure;
  select prosrc,pg_get_functiondef(oid) into v_source,v_definition from pg_proc where oid=v_oid;
  v_replacement:=replace(v_source,
    'exists (select 1 from public.profiles where id = auth.uid() and role = ''admin'')','public.is_admin()');
  if v_source=v_replacement then raise exception 'Duplicate warnings guard has changed; review migration'; end if;
  execute replace(v_definition,v_source,v_replacement);
end $migration$;

commit;
