begin;

-- Server-only intake. Normalising under one transaction prevents simultaneous
-- resubmissions bypassing the three-calendar-month reapplication period.
create function public.submit_cleaner_application(p_details jsonb,p_declaration text,
  p_declaration_source text,p_privacy_version text)
returns uuid language plpgsql security definer set search_path='' as $fn$
declare v_id uuid; v_email text; v_phone text;
begin
  if p_details is null or jsonb_typeof(p_details)<>'object' or p_details ? 'password' then
    raise exception 'The application does not create a login.'; end if;
  v_email:=lower(btrim(p_details->>'email')); v_phone:=p_details->>'phone';
  if coalesce(p_details->>'checksAcknowledged','')<>'true' or
    coalesce(v_email,'') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or
    coalesce(v_phone,'') !~ '^\+44[0-9]{10}$' or
    length(coalesce(p_declaration,''))=0 or length(coalesce(p_declaration_source,''))=0 or
    length(coalesce(p_privacy_version,''))=0 or jsonb_typeof(p_details->'areas') is distinct from 'array' then
    raise exception 'Complete the application and required acknowledgments.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('cleaner-application-intake',0));
  if exists(select 1 from public.cleaner_applications where
    (lower(btrim(email))=v_email or phone=v_phone) and (
      status not in ('not_progressed','closed') or
      coalesce(decision_at,created_at)+interval '3 months'>clock_timestamp())) then
    raise exception 'An application already exists or the reapplication period has not ended.' using errcode='check_violation';
  end if;
  insert into public.cleaner_applications(full_name,email,phone,postcode,areas,experience,
    availability,right_to_work_type,referral_code,checks_acknowledged,declaration_text,
    declaration_source,declaration_pending,privacy_version)
  values(btrim(p_details->>'fullName'),v_email,v_phone,p_details->>'postcode',
    array(select jsonb_array_elements_text(p_details->'areas')),p_details->>'experience',
    p_details->>'availability',p_details->>'rightToWorkType',nullif(p_details->>'referralCode',''),
    true,p_declaration,p_declaration_source,true,p_privacy_version) returning id into v_id;
  return v_id;
end;
$fn$;

create function public.purge_expired_cleaner_applications()
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_attempts integer:=0; v_applications integer:=0;
begin
  -- Application-level legal hold protects answers/writing as well as files.
  -- Manager review without a final decision has no deletion timer.
  with expired as (
    select a.id from cleaner_assessment_private.attempts a
    join cleaner_assessment_private.invitations i on i.id=a.invitation_id
    join public.cleaner_applications c on c.id=i.application_id
    where not c.legal_hold and a.decided_at+interval '6 months'<=clock_timestamp()
      and a.phase in ('passed','failed') order by a.id limit 100 for update of c,a skip locked
  ), removed as (delete from cleaner_assessment_private.attempts where id in(select id from expired) returning id)
  select count(*) into v_attempts from removed;
  with expired as (
    select id from public.cleaner_applications where not legal_hold
      and status in ('not_progressed','closed') and retention_due_at<=clock_timestamp()
      order by id limit 100 for update skip locked
  ), removed as (delete from public.cleaner_applications where id in(select id from expired) returning id)
  select count(*) into v_applications from removed;
  return jsonb_build_object('assessments',v_attempts,'applications',v_applications);
end;
$fn$;
create function public.staff_hold_cleaner_application(p_application uuid,p_hold boolean,p_reason text)
returns void language plpgsql security definer set search_path='' as $fn$
begin
  if not public.staff_has_permission('manage') then raise exception 'Manager authenticator sign-in required.' using errcode='insufficient_privilege'; end if;
  if p_hold is null or length(btrim(coalesce(p_reason,'')))<10 then raise exception 'Record the legal-hold reason.'; end if;
  update public.cleaner_applications set legal_hold=p_hold where id=p_application;
  if not found then raise exception 'Application not found.'; end if;
  insert into cleaner_assessment_private.audit(application_id,actor,event,reason)
    values(p_application,auth.uid(),case when p_hold then 'legal_hold_set' else 'legal_hold_released' end,left(btrim(p_reason),1000));
end;
$fn$;
revoke all on function public.submit_cleaner_application(jsonb,text,text,text),
  public.purge_expired_cleaner_applications(),public.staff_hold_cleaner_application(uuid,boolean,text)
  from public,anon,authenticated,service_role;
grant execute on function public.submit_cleaner_application(jsonb,text,text,text),
  public.purge_expired_cleaner_applications() to service_role;
grant execute on function public.staff_hold_cleaner_application(uuid,boolean,text) to authenticated;
notify pgrst, 'reload schema';
commit;
