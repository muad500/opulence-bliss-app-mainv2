begin;

-- Old per-visit terms can lack the cleaner/products payout split. Do not
-- prepare a staff retention decision which the unchanged payout worker cannot
-- settle. A customer's free replacement cancellation needs no cleaner payout.
do $guard$
declare
  source text := pg_get_functiondef('public.prepare_recorded_visit_outcome(uuid,text,text,integer,integer)'::regprocedure);
  marker text := '  select t.terms into strict terms from public.booking_cleaning_billing_terms t where booking_id=p_booking;';
begin
  if position(marker in source)=0 then
    raise exception 'Recorded-outcome source changed; review before applying';
  end if;
  execute replace(source,marker,marker || E'\n  if p_mode <> ''replacement_cancel'' and not (terms ? ''productsCleanerPayPence'') then\n    raise exception ''This older booking needs its agreed payment and cleaner pay reviewed separately'';\n  end if;');
end;
$guard$;

commit;
