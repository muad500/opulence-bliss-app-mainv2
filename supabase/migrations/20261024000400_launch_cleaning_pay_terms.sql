begin;

-- Append a new settings version. Never rewrite an existing booking snapshot.
insert into public.cleaning_billing_settings(terms)
select terms || '{"cleanerHourlyPence":1500,"deepCleanerHourlyPence":1750,"productsFeePence":500,"productsCleanerPayPence":400,"cancellationBasis":"cleaning_hours","cancellationRefundPercent":{"full":100,"three_quarter":75,"half":50,"none":30}}'::jsonb
from public.cleaning_billing_settings order by id desc limit 1;

-- Also works during a rolling deployment if an older application drops newly
-- introduced fields while serialising the selected settings version.
create or replace function public.enrich_launch_cleaning_terms()
returns trigger language plpgsql security definer set search_path=public as $fn$
declare v_published jsonb; v_package text;
begin
  select terms into v_published from public.cleaning_billing_settings
    where id::text=new.terms->>'version';
  if v_published->>'cancellationBasis'='cleaning_hours' then
    new.terms:=v_published || new.terms || jsonb_build_object(
      'cancellationBasis','cleaning_hours',
      'deepCleanerHourlyPence',v_published->'deepCleanerHourlyPence',
      'productsCleanerPayPence',v_published->'productsCleanerPayPence');
    select p.name into v_package from public.bookings b join public.packages p on p.id=b.package_id where b.id=new.booking_id;
    new.terms:=new.terms || jsonb_build_object('cleanerHourlyPence',
      case when v_package in ('Signature Deep Clean','End of Tenancy / Move-In Clean')
        then v_published->'deepCleanerHourlyPence' else v_published->'cleanerHourlyPence' end);
  end if;
  return new;
end
$fn$;
revoke all on function public.enrich_launch_cleaning_terms() from public,anon,authenticated;
create trigger enrich_launch_cleaning_terms before insert on public.booking_cleaning_billing_terms
for each row execute function public.enrich_launch_cleaning_terms();

create or replace function public.set_cleaning_payment_allocation()
returns trigger language plpgsql security definer set search_path=public as $fn$
declare
  v_terms jsonb; v_lines jsonb; v_refunded jsonb; v_minutes integer;
  v_extras integer; v_provider integer; v_products integer:=0; v_review boolean:=false;
begin
  if coalesce(new.kind,'')='tip' then return new; end if;
  select terms into v_terms from public.booking_cleaning_billing_terms where booking_id=new.booking_id;
  if not found then return new; end if;
  select line_items,refunded_lines into v_lines,v_refunded from public.booking_visit_charges where payment_id=new.id;
  v_lines:=coalesce(v_lines,new.split_breakdown->'reserved_lines');
  if v_lines is null then select line_items into v_lines from public.booking_visit_billing where booking_id=new.booking_id; end if;
  select coalesce(sum((line->>'reservedMinutes')::integer) filter(where line->>'id'='cleaning'),0),
    coalesce(sum((line->>'amountPence')::integer) filter(where line->>'id'<>'cleaning'),0)
    into v_minutes,v_extras from jsonb_array_elements(v_lines) line;
  v_provider:=round(v_minutes*(v_terms->>'cleanerHourlyPence')::numeric/60);
  if v_terms->>'cancellationBasis'='cleaning_hours' then
    select case when coalesce(sum((line->>'amountPence')::integer) filter(where line->>'id'='products'),0)
      - coalesce((v_refunded->>'products')::integer,0) >= (v_terms->>'productsFeePence')::integer
      and (v_terms->>'productsFeePence')::integer > 0
      then coalesce((v_terms->>'productsCleanerPayPence')::integer,0) else 0 end
      into v_products from jsonb_array_elements(v_lines) line;
    v_review:=coalesce((v_refunded->>'cleaning')::integer,0)>0;
    v_provider:=v_provider+v_products;
  end if;
  new.split_breakdown:=coalesce(new.split_breakdown,'{}'::jsonb)||jsonb_build_object(
    'provider',v_provider/100.0,'platform_margin',new.gross_amount-v_provider/100.0,
    'business_extras',(v_extras-v_products)/100.0,'products_cleaner_pay_pence',v_products,
    'reserved_base',0,'reserved_extras',0,'billing_model','per_visit','pay_rate_pending',false,
    'cleaner_hourly_pence',(v_terms->>'cleanerHourlyPence')::integer,
    'booked_cleaning_minutes',v_minutes,'allocation_review_required',v_review,
    'billing_settings_version',v_terms->>'version');
  return new;
end
$fn$;

-- A refunded/removed products line must not leave £4 in an old allocation.
create or replace function public.refresh_cleaning_charge_allocation()
returns trigger language plpgsql security definer set search_path=public as $fn$
begin
  update public.payments set split_breakdown=split_breakdown where id=new.payment_id;
  return new;
end
$fn$;
revoke all on function public.refresh_cleaning_charge_allocation() from public,anon,authenticated;
create trigger refresh_cleaning_charge_allocation after insert or update of refunded_lines
on public.booking_visit_charges for each row execute function public.refresh_cleaning_charge_allocation();

-- Keep the existing locking, deadline checks and immutable booking snapshots.
-- Only add the missing under-12-hour band for new cleaning-hours terms.
create or replace function public.cleaning_statutory_cancellation_free(p_booking uuid,p_now timestamptz default now())
returns boolean language sql stable security definer set search_path=public as $fn$
  select coalesce(b.status::text in ('offered','declined','scheduled') and p_now>=b.created_at
    and p_now < (((b.created_at at time zone 'Europe/London')::date+15)::timestamp at time zone 'Europe/London')
    and t.terms->>'cancellationBasis'='cleaning_hours',false)
  from public.bookings b join public.booking_cleaning_billing_terms t on t.booking_id=b.id where b.id=p_booking;
$fn$;
revoke all on function public.cleaning_statutory_cancellation_free(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.cleaning_statutory_cancellation_free(uuid,timestamptz) to service_role;

do $migration$
declare v_oid regprocedure:='public.prepare_visit_money_operation(uuid,uuid,text,integer,jsonb)'::regprocedure;
  v_definition text; v_old text; v_new text;
begin
  select pg_get_functiondef(v_oid) into v_definition;
  v_old:='      else (v_refunds ->> ''half'')::integer end;';
  v_new:='      when v_booking.scheduled_at < now() + interval ''12 hours'' and exists (
        select 1 from public.booking_cleaning_billing_terms where booking_id=p_booking
          and terms->>''cancellationBasis''=''cleaning_hours''
      ) then (v_refunds ->> ''none'')::integer
      else (v_refunds ->> ''half'')::integer end;';
  if strpos(v_definition,v_old)=0 then raise exception 'Cancellation function changed; review this migration'; end if;
  v_definition:=replace(v_definition,v_old,v_new);
  v_old:='      when p_actor is null then 0';
  v_new:='      when p_actor is not null and not coalesce((p_parameters->>''noAccess'')::boolean,false)
        and public.cleaning_statutory_cancellation_free(p_booking) then 100
      when p_actor is null then 0';
  if strpos(v_definition,v_old)=0 then raise exception 'Statutory cancellation guard changed'; end if;
  execute replace(v_definition,v_old,v_new);
end
$migration$;

commit;
