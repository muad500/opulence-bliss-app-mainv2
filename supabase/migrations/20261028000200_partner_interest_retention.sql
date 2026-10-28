begin;

-- A non-account enquiry can also be protected while a complaint is open.
-- Keep only its opaque reference in the hold log after the interest expires.
alter table public.data_retention_holds add column partner_interest_id uuid;
do $constraint$
declare
  item record;
begin
  for item in
    select conname
    from pg_constraint
    where conrelid = 'public.data_retention_holds'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%num_nonnulls%'
  loop
    execute format(
      'alter table public.data_retention_holds drop constraint %I',
      item.conname
    );
  end loop;
end;
$constraint$;
alter table public.data_retention_holds
  add constraint retention_one_record check (
    num_nonnulls(
      user_id, booking_id, handyman_job_id, enquiry_id, partner_interest_id
    ) = 1
  );

-- All contact evidence is append-only. Future Partner registration must also
-- take the retention lock, so it cannot race the daily expiry decision.
create trigger partner_interest_retention_lock
  before insert or update or delete on public.partner_interests
  for each row execute function public.serialise_retention_holds();

-- Extend reviewed functions in place, preserving their OIDs and grants. Fail
-- closed if the expected integration points have changed.
do $patch$
declare
  source text;
  marker text;
begin
  select pg_get_functiondef('public.retention_candidates()'::regprocedure)
  into source;
  source:=replace(source,E'\r\n',E'\n');
  marker:='  select ''emergency_contacts''';
  if strpos(source, marker) = 0 then
    raise exception 'Retention candidate adapter changed';
  end if;
  execute replace(source,marker,$sql$  select 'partner_interests',i.id::text,jsonb_build_object('partnerInterest',i.id),'[]'::jsonb
    from public.partner_interests i where i.created_at<=now()-interval '12 months' and i.partner_registered_at is null
  union all
  select 'emergency_contacts'$sql$);

  select pg_get_functiondef('public.retention_has_hold(jsonb)'::regprocedure)
  into source;
  source:=replace(source,E'\r\n',E'\n');
  marker:='    select (p_scope->>''user'')::uuid id where p_scope ? ''user''';
  if strpos(source, marker) = 0 then
    raise exception 'Retention account hold adapter changed';
  end if;
  source:=replace(source,marker,$sql$    select (p_scope->>'user')::uuid id where p_scope ? 'user'
    union select p.id from public.profiles p join public.partner_interests i on lower(p.email)=i.email
      where i.id=(p_scope->>'partnerInterest')::uuid$sql$);
  marker:='  select exists(select 1 from public.review_cases';
  if strpos(source, marker) = 0 then
    raise exception 'Retention direct hold adapter changed';
  end if;
  execute replace(source,marker,$sql$  select exists(select 1 from public.data_retention_holds where resolved_at is null
      and partner_interest_id=(p_scope->>'partnerInterest')::uuid)
    or exists(select 1 from public.review_cases$sql$);

  select pg_get_functiondef(
    'public.apply_retention_candidate(text,text,jsonb)'::regprocedure
  ) into source;
  source:=replace(source,E'\r\n',E'\n');
  marker:='  case p_category';
  if strpos(source, marker) = 0 then
    raise exception 'Retention deletion adapter changed';
  end if;
  execute replace(source,marker,$sql$  case p_category
    when 'partner_interests' then
      delete from public.partner_interests where id=p_entity::uuid
        and created_at<=now()-interval '12 months' and partner_registered_at is null;$sql$);

  select pg_get_functiondef(
    'public.admin_manage_retention_hold(uuid,uuid,text,uuid,text)'::regprocedure
  ) into source;
  source:=replace(source,E'\r\n',E'\n');
  marker:='  if p_kind not in(''user'',''booking'',''handyman'',''enquiry'')';
  if strpos(source, marker) = 0 then
    raise exception 'Retention staff hold adapter changed';
  end if;
  source:=replace(source,marker,'  if p_kind not in(''user'',''booking'',''handyman'',''enquiry'',''partner_interest'')');
  marker:='  insert into public.data_retention_holds(user_id,booking_id,handyman_job_id,enquiry_id,reason,created_by)';
  if strpos(source, marker) = 0 then
    raise exception 'Retention staff hold insertion changed';
  end if;
  source:=replace(source,marker,$sql$  if p_kind='partner_interest' and not exists(select 1 from public.partner_interests where id=p_record) then
    raise exception 'Partner interest not found';
  end if;
  insert into public.data_retention_holds(user_id,booking_id,handyman_job_id,enquiry_id,partner_interest_id,reason,created_by)$sql$);
  marker:='case when p_kind=''enquiry'' then p_record end,btrim(p_reason),p_actor)';
  if strpos(source, marker) = 0 then
    raise exception 'Retention staff hold values changed';
  end if;
  execute replace(source,marker,'case when p_kind=''enquiry'' then p_record end,case when p_kind=''partner_interest'' then p_record end,btrim(p_reason),p_actor)');
end;
$patch$;

commit;
notify pgrst, 'reload schema';
