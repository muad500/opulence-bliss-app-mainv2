begin;
-- PostgREST enables safe updates. Restrict every singleton heartbeat write
-- explicitly rather than relying only on the table's single-row constraint.
do $fix$
declare signature text; source text; corrected text;
begin
  foreach signature in array array['public.sweep_cleaner_assessments()',
    'public.process_cleaner_stage2_followups()','public.enable_cleaner_stage2_cutover()'] loop
    select pg_get_functiondef(signature::regprocedure) into strict source;
    corrected:=replace(source,'set last_recovery_at=clock_timestamp();',
      'set last_recovery_at=clock_timestamp() where singleton;');
    corrected:=replace(corrected,'set last_followups_at=clock_timestamp();',
      'set last_followups_at=clock_timestamp() where singleton;');
    corrected:=replace(corrected,'set new_applications_from=coalesce(new_applications_from,clock_timestamp());',
      'set new_applications_from=coalesce(new_applications_from,clock_timestamp()) where singleton;');
    if corrected=source then raise exception 'Expected singleton update missing in %',signature;end if;
    execute corrected;
  end loop;
end;
$fix$;
notify pgrst,'reload schema';
commit;
