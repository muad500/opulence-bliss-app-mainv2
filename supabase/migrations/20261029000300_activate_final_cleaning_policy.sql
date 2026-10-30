-- Publication first. Only NEW booking snapshots receive these rules.
begin;
do $publication$
begin
  if (select count(*) from public.legal_documents where published
    and effective_date=date '2026-10-01' and version='1.0'
    and slug in ('terms','cancellation-refund','privacy','safeguarding','dbs-data'))<>5 then
    raise exception 'Publish the final pack before activating its rules';
  end if;
end;
$publication$;

insert into public.cleaning_billing_settings(terms)
select terms || '{"cancellationBasis":"booking_total","cancellationRefundPercent":{"full":100,"three_quarter":75,"half":50,"none":30}}'::jsonb
from public.cleaning_billing_settings order by id desc limit 1;
update public.professional_launch_controls set safeguarding_enabled=true,updated_at=now() where id;

-- A package price is read only for new quotes. Existing billing and legal
-- snapshots retain the old agreed amounts.
update public.packages set price=round(25.99*coalesce(duration_minutes,120)/60.0,2)
where name='Signature Deep Clean' and service_type ilike '%clean%';

do $functions$
declare source text; marker text; target regprocedure;
begin
  select replace(pg_get_functiondef('public.enrich_launch_cleaning_terms()'::regprocedure),E'\r\n',E'\n') into source;
  marker:='if v_published->>''cancellationBasis''=''cleaning_hours'' then';
  if strpos(source,marker)=0 then raise exception 'Booking terms adapter changed'; end if;
  source:=replace(source,marker,'if v_published->>''cancellationBasis'' in (''cleaning_hours'',''booking_total'') then');
  source:=replace(source,'''cancellationBasis'',''cleaning_hours''','''cancellationBasis'',v_published->>''cancellationBasis''');
  execute source;

  foreach target in array array[
    'public.snapshot_cleaning_cancellation()'::regprocedure,
    'public.report_booking_exception(uuid,text,text,text,jsonb)'::regprocedure,
    'public.cleaning_statutory_cancellation_free(uuid,timestamptz)'::regprocedure,
    'public.prepare_visit_money_operation(uuid,uuid,text,integer,jsonb)'::regprocedure
  ] loop
    select replace(pg_get_functiondef(target),E'\r\n',E'\n') into source;
    if strpos(source,'cancellationBasis')=0 then raise exception 'Policy adapter changed: %',target; end if;
    source:=replace(source,'v_terms->>''cancellationBasis''=''cleaning_hours''',
      'v_terms->>''cancellationBasis'' in (''cleaning_hours'',''booking_total'')');
    source:=replace(source,'terms->>''cancellationBasis''=''cleaning_hours''',
      'terms->>''cancellationBasis'' in (''cleaning_hours'',''booking_total'')');
    source:=replace(source,'v_terms->>''cancellationBasis'' is distinct from ''cleaning_hours'' or',
      'coalesce(v_terms->>''cancellationBasis'','''') not in (''cleaning_hours'',''booking_total'') or');
    if target='public.snapshot_cleaning_cancellation()'::regprocedure then
      marker:='where c.booking_id=new.booking_id and line->>''id''=''cleaning'';';
      if strpos(source,marker)=0 then raise exception 'Cancellation amount adapter changed'; end if;
      source:=replace(source,marker,
        'where c.booking_id=new.booking_id and (line->>''id''=''cleaning'' or v_terms->>''cancellationBasis''=''booking_total'');');
      source:=replace(source,'coalesce((c.refunded_lines->>''cleaning'')::integer,0)',
        'coalesce((c.refunded_lines->>(line->>''id''))::integer,0)');
    end if;
    execute source;
  end loop;

  select replace(pg_get_functiondef('public.finish_cleaning_cancellation()'::regprocedure),E'\r\n',E'\n') into source;
  marker:='where c.booking_id=new.booking_id and line->>''id''=''cleaning'';';
  if strpos(source,marker)=0 then raise exception 'Cancellation settlement adapter changed'; end if;
  source:=replace(source,marker,
    'where c.booking_id=new.booking_id and (line->>''id''=''cleaning'' or exists(select 1 from public.booking_cleaning_billing_terms t where t.booking_id=new.booking_id and t.terms->>''cancellationBasis''=''booking_total''));');
  source:=replace(source,'coalesce((c.refunded_lines->>''cleaning'')::integer,0)',
    'coalesce((c.refunded_lines->>(line->>''id''))::integer,0)');
  execute source;

  select replace(pg_get_functiondef('public.prepare_cleaning_cancellation_adjustment(uuid,text,integer,integer)'::regprocedure),E'\r\n',E'\n') into source;
  marker:='  v_amount integer; v_lines jsonb;';
  if strpos(source,marker)=0 then raise exception 'Staff reduction declaration changed'; end if;
  source:=replace(source,marker,
    '  v_cumulative integer:=0; v_allocated integer:=0; v_available integer; v_next integer; v_line jsonb;
  v_amount integer; v_lines jsonb;');
  marker:=$old$    select coalesce(sum((line->>'amountPence')::integer),0)-coalesce((v_charge.refunded_lines->>'cleaning')::integer,0)
      into v_amount from jsonb_array_elements(v_charge.line_items) line where line->>'id'='cleaning';
    v_amount:=least(v_left,greatest(0,v_amount));
    if v_amount=0 then continue; end if;
    v_lines:=v_charge.refunded_lines||jsonb_build_object('cleaning',coalesce((v_charge.refunded_lines->>'cleaning')::integer,0)+v_amount);$old$;
  marker:=replace(marker,E'\r\n',E'\n');
  if strpos(source,marker)=0 then raise exception 'Staff reduction allocation changed'; end if;
  source:=replace(source,marker,$new$    if exists(select 1 from public.booking_cleaning_billing_terms t where t.booking_id=p_booking and t.terms->>'cancellationBasis'='booking_total') then
      v_lines:=v_charge.refunded_lines;
      v_amount:=0;
      for v_line in select value from jsonb_array_elements(v_charge.line_items) loop
        v_available:=(v_line->>'amountPence')::integer-coalesce((v_lines->>(v_line->>'id'))::integer,0);
        if v_available<0 or v_line->>'id'='tip' then raise exception 'Cancellation lines need reconciliation'; end if;
        v_cumulative:=v_cumulative+v_available;
        v_next:=round(v_cumulative::numeric*v_delta/v_row.charge_pence);
        v_lines:=jsonb_set(v_lines,array[v_line->>'id'],to_jsonb(coalesce((v_lines->>(v_line->>'id'))::integer,0)+v_next-v_allocated));
        v_amount:=v_amount+v_next-v_allocated;
        v_allocated:=v_next;
      end loop;
    else
      select coalesce(sum((line->>'amountPence')::integer),0)-coalesce((v_charge.refunded_lines->>'cleaning')::integer,0)
        into v_amount from jsonb_array_elements(v_charge.line_items) line where line->>'id'='cleaning';
      v_amount:=least(v_left,greatest(0,v_amount));
      v_lines:=v_charge.refunded_lines||jsonb_build_object('cleaning',coalesce((v_charge.refunded_lines->>'cleaning')::integer,0)+v_amount);
    end if;
    if v_amount=0 then continue; end if;$new$);
  execute source;

  -- Under 48 hours, do not silently move the original visit for free. The
  -- original must be cancelled under its agreed band and a new visit booked.
  select replace(pg_get_functiondef('public.guard_visit_billing_booking_changes()'::regprocedure),E'\r\n',E'\n') into source;
  marker:='if old.scheduled_at < now() + interval ''24 hours'' then';
  if strpos(source,marker)=0 then raise exception 'Reschedule billing guard changed'; end if;
  source:=replace(source,marker,
    'if old.scheduled_at < now() + (case when exists(select 1 from public.booking_cleaning_billing_terms t where t.booking_id=old.id and t.terms->>''cancellationBasis''=''booking_total'') then interval ''48 hours'' else interval ''24 hours'' end) then');
  source:=replace(source,'Date changes need at least 24 hours notice',
    'Free date changes need the notice agreed at booking. Under the final policy, less than 48 hours requires cancellation of the original visit under its charge band and rebooking.');
  execute source;
end;
$functions$;

create or replace function public.reschedule_window(p_booking_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $fn$
declare v_booking public.bookings; v_rules public.booking_rules;
  v_cutoff timestamptz; v_hours integer; v_final boolean;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode='insufficient_privilege'; end if;
  select * into v_rules from public.booking_rules where id=1;
  select * into v_booking from public.bookings where id=p_booking_id;
  if not found then return jsonb_build_object('can_reschedule',false,'reason','not found'); end if;
  if public.account_booking_actor(p_booking_id,true) is null then
    raise exception 'not your booking' using errcode='insufficient_privilege';
  end if;
  select exists(select 1 from public.booking_cleaning_billing_terms
    where booking_id=p_booking_id and terms->>'cancellationBasis'='booking_total') into v_final;
  v_hours:=case when v_final then 48 else v_rules.reschedule_lockout_hours end;
  if v_booking.status::text not in ('offered','declined','scheduled') then
    return jsonb_build_object('can_reschedule',false,'reason','this visit can no longer be changed','lockout_hours',v_hours);
  end if;
  v_cutoff:=v_booking.scheduled_at-make_interval(hours=>v_hours);
  return jsonb_build_object('can_reschedule',case when v_final then now()<=v_cutoff else now()<v_cutoff end,
    'cutoff_at',v_cutoff,'lockout_hours',v_hours,'min_notice_hours',v_rules.min_notice_hours,
    'reason',case when now()<v_cutoff then null when v_final then
      'Under 48 hours: cancel the original visit under its agreed charge band and rebook. Contact us if you need help.'
      else format('changes need %s hours notice',v_hours) end);
end;
$fn$;

commit;
notify pgrst, 'reload schema';
