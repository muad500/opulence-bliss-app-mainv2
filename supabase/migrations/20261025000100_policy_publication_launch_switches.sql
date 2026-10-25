-- Publication-day controls. Pay changes are independent of cancellation terms.
-- Default both switches OFF. Never rewrite agreed booking snapshots/acceptances.
begin;
create table public.professional_launch_controls (
  id boolean primary key default true check(id),
  safeguarding_enabled boolean not null default false,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
insert into public.professional_launch_controls(id) values(true);
alter table public.professional_launch_controls enable row level security;
revoke all on public.professional_launch_controls from public,anon,authenticated;
grant all on public.professional_launch_controls to service_role;

create or replace function public.safeguarding_registration_config()
returns jsonb language sql stable security definer set search_path=public as $fn$
  select jsonb_build_object('enabled',c.safeguarding_enabled and d.version is not null,
    'version',case when c.safeguarding_enabled then d.version else null end)
  from public.professional_launch_controls c left join public.legal_documents d
    on d.slug='safeguarding' and d.published and length(trim(d.content_html))>0
  where c.id;
$fn$;
revoke all on function public.safeguarding_registration_config() from public;
grant execute on function public.safeguarding_registration_config() to anon,authenticated,service_role;

alter table public.providers alter column safeguarding_required set default false;
create or replace function public.require_professional_safeguarding()
returns trigger language plpgsql security definer set search_path=public as $fn$
begin
  if tg_op='INSERT' then
    new.safeguarding_required:=coalesce((public.safeguarding_registration_config()->>'enabled')::boolean,false);
  elsif new.safeguarding_required is distinct from old.safeguarding_required then
    raise exception 'The safeguarding registration requirement cannot be removed' using errcode='check_violation';
  end if;
  if new.safeguarding_required and (
    new.vetting_status::text='approved' or coalesce(new.service_approvals->>'cleaning','')='approved'
    or coalesce(new.service_approvals->>'handyman','')='approved'
  ) and not exists(select 1 from public.account_legal_acceptances
    where user_id=new.profile_id and document_slug='safeguarding') then
    raise exception 'The professional must accept the safeguarding policy before approval' using errcode='check_violation';
  end if;
  return new;
end
$fn$;

-- The published policy is 0/25/50/100%, not the future 12-hour/70% policy.
insert into public.cleaning_billing_settings(terms)
select (terms-'cancellationBasis') || '{"cleanerHourlyPence":1500,"deepCleanerHourlyPence":1750,"productsCleanerPayPence":400,"cancellationRefundPercent":{"full":100,"three_quarter":75,"half":50,"none":0}}'::jsonb
from public.cleaning_billing_settings order by id desc limit 1;

create or replace function public.enrich_launch_cleaning_terms()
returns trigger language plpgsql security definer set search_path=public as $fn$
declare v_published jsonb; v_package text;
begin
  select terms into v_published from public.cleaning_billing_settings where id::text=new.terms->>'version';
  if v_published ? 'productsCleanerPayPence' then
    new.terms:=(v_published || new.terms)-'cancellationBasis';
    if v_published->>'cancellationBasis'='cleaning_hours' then
      new.terms:=new.terms||jsonb_build_object('cancellationBasis','cleaning_hours');
    end if;
    new.terms:=new.terms||jsonb_build_object(
      'cancellationRefundPercent',v_published->'cancellationRefundPercent',
      'deepCleanerHourlyPence',v_published->'deepCleanerHourlyPence',
      'productsCleanerPayPence',v_published->'productsCleanerPayPence');
    select p.name into v_package from public.bookings b join public.packages p on p.id=b.package_id where b.id=new.booking_id;
    new.terms:=new.terms||jsonb_build_object('cleanerHourlyPence',case when v_package in ('Signature Deep Clean','End of Tenancy / Move-In Clean')
      then v_published->'deepCleanerHourlyPence' else v_published->'cleanerHourlyPence' end);
  end if;
  return new;
end
$fn$;

-- Keep pay/products/source-payout protections active with EITHER policy.
do $migration$
declare v_def text; v_oid regprocedure; v_old text; v_new text;
begin
  foreach v_oid in array array[
    'public.set_cleaning_payment_allocation()'::regprocedure,
    'public.prepare_cleaning_payout(uuid,jsonb)'::regprocedure,
    'public.snapshot_cleaning_cancellation()'::regprocedure
  ] loop
    select replace(pg_get_functiondef(v_oid),E'\r\n',E'\n') into v_def;
    if v_oid='public.set_cleaning_payment_allocation()'::regprocedure then
      v_old:='v_terms->>''cancellationBasis''=''cleaning_hours''';
      v_new:='v_terms ? ''productsCleanerPayPence''';
    else
      v_old:='v_terms->>''cancellationBasis'' is distinct from ''cleaning_hours''';
      v_new:='not (v_terms ? ''productsCleanerPayPence'')';
    end if;
    if strpos(v_def,v_old)=0 then raise exception 'Launch pay guard changed: %',v_oid; end if;
    v_def:=replace(v_def,v_old,v_new);
    if v_oid='public.snapshot_cleaning_cancellation()'::regprocedure then
      v_old:='when v_booking.scheduled_at>=now()+interval ''12 hours'' then (v_refunds->>''half'')::integer';
      v_new:='when v_terms->>''cancellationBasis'' is distinct from ''cleaning_hours'' or v_booking.scheduled_at>=now()+interval ''12 hours'' then (v_refunds->>''half'')::integer';
      if strpos(v_def,v_old)=0 then raise exception 'Cancellation band guard changed'; end if;
      v_def:=replace(v_def,v_old,v_new);
      v_def:=replace(v_def,'least(v_cap,70)','least(v_cap,case when v_terms->>''cancellationBasis''=''cleaning_hours'' then 70 else 100 end)');
      v_def:=replace(v_def,'v_percent>70','v_percent>case when v_terms->>''cancellationBasis''=''cleaning_hours'' then 70 else 100 end');
      v_def:=replace(v_def,'''chargePercent'',least(v_percent,70)','''chargePercent'',v_percent');
      v_old:='v_booking.scheduled_at+interval ''15 minutes''';
      v_new:='v_booking.scheduled_at+(case when v_terms->>''cancellationBasis''=''cleaning_hours'' then interval ''15 minutes'' else interval ''30 minutes'' end)';
      if strpos(v_def,v_old)=0 then raise exception 'No-access guard changed'; end if;
      v_def:=replace(v_def,v_old,v_new);
      v_def:=replace(v_def,'No access needs a report and a 15 minute wait','No access needs a report and the agreed waiting period');
    end if;
    execute v_def;
  end loop;
  select replace(pg_get_functiondef('public.report_booking_exception(uuid,text,text,text,jsonb)'::regprocedure),E'\r\n',E'\n') into v_def;
  v_old:='v_scheduled + interval ''15 minutes''';
  v_new:='v_scheduled + (case when exists(select 1 from public.booking_cleaning_billing_terms where booking_id=p_booking_id and terms->>''cancellationBasis''=''cleaning_hours'') then interval ''15 minutes'' else interval ''30 minutes'' end)';
  if strpos(v_def,v_old)=0 then raise exception 'Report wait guard changed'; end if;
  execute replace(replace(v_def,v_old,v_new),'Wait 15 minutes after the scheduled start before reporting no access.','Wait the agreed period after the scheduled start before reporting no access (30 minutes under the published policy; 15 under the new policy).');
  select replace(pg_get_functiondef('public.prepare_visit_money_operation(uuid,uuid,text,integer,jsonb)'::regprocedure),E'\r\n',E'\n') into v_def;
  if strpos(v_def,'No access after fifteen minutes; staff reviewed the cancellation charge')=0 then raise exception 'No-access reason changed'; end if;
  execute replace(v_def,'No access after fifteen minutes; staff reviewed the cancellation charge','No access after the agreed waiting period; staff reviewed the cancellation charge');
end
$migration$;
alter table public.cleaning_cancellation_settlements drop constraint cleaning_cancellation_settlements_charge_percent_check;
alter table public.cleaning_cancellation_settlements add constraint cleaning_cancellation_settlements_charge_percent_check check(charge_percent between 0 and 100);
commit;
