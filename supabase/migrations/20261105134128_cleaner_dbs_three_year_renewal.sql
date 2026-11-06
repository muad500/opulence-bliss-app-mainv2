begin;

-- Only the three annual DBS calculations change. Preserve the wrappers for
-- insurance, right-to-work, staff permissions and all service approvals.
do $migration$
declare
  signature text;
  source text;
begin
  foreach signature in array array[
    'public.professional_verification_block_before_client_documents(uuid,date)',
    'public.validate_renewed_verification()',
    'public.process_verification_renewals_before_channels()'
  ] loop
    select pg_get_functiondef(signature::regprocedure) into strict source;
    if strpos(source, 'interval ''1 year''') = 0 then
      raise exception 'Expected annual DBS calculation missing in %; review before release.', signature;
    end if;
    source := replace(source, 'interval ''1 year''', 'interval ''3 years''');
    source := replace(source, 'Your annual DBS re-check', 'Your three-year DBS re-check');
    source := replace(source, 'Annual DBS re-check', 'Three-year DBS re-check');
    source := replace(source, 'issued within the last twelve months', 'issued within the last three years');
    execute source;
  end loop;
end;
$migration$;

-- An older daily job also calculated a year from the review date. Delegate it
-- to the same issue-date/three-year ledger so the two schedules cannot create
-- competing annual notices or duplicate three-year notices.
create or replace function public.remind_professional_document_checks()
returns void language plpgsql security definer set search_path = '' as $fn$
begin
  perform public.process_verification_renewals();
end;
$fn$;
revoke all on function public.remind_professional_document_checks() from public,anon,authenticated,service_role;
grant execute on function public.remind_professional_document_checks() to service_role;

-- Do not rewrite historical checks, reminders or restore previously paused
-- accounts. The existing daily verification schedule uses the replaced body.
notify pgrst, 'reload schema';
commit;
