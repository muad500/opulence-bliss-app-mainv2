-- Resuming keeps each visit's original engine and accepted payment timing.
-- The confirmation must not promise the older 48-hour model for every series.
begin;
do $copy$
declare
  source text;
  old_sentence text := 'Once a cleaner accepts, payment is taken 48 hours before the visit, or immediately if it is closer.';
  new_sentence text := 'The payment timing agreed for each visit still applies. We will tell you its date and amount before any new regular visit payment.';
begin
  source := pg_get_functiondef(
    'public.resume_regular_series_before_customer_controls(uuid,integer)'::regprocedure
  );
  if strpos(source, old_sentence) = 0 then
    raise exception 'Resume confirmation changed. Review its wording before applying.';
  end if;
  execute replace(source, old_sentence, new_sentence);
end;
$copy$;
commit;
