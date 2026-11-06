begin;

-- Match prepareAccountAcceptance / legalContentHash's existing fingerprint.
-- Exact source HTML, published version and the pinned PDF remain unchanged.
do $fix$
declare
  source text;
  previous_check text := $check$encode(sha256(convert_to(d.content_html,'UTF8')),'hex')=document->>'contentHash'$check$;
  corrected_check text := $check$md5(d.content_html)=document->>'contentHash'$check$;
begin
  select pg_get_functiondef(
    'public.record_cleaner_stage2_acceptances(uuid,jsonb)'::regprocedure)
    into strict source;
  if position(previous_check in source) = 0 then
    raise exception 'Expected Stage 2 fingerprint check missing; review before replacing';
  end if;
  execute replace(source, previous_check, corrected_check);
end;
$fix$;

notify pgrst, 'reload schema';
commit;
