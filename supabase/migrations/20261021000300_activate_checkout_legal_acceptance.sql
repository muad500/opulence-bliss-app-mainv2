-- Phase B: apply AFTER deploying the writer that uses the four-column key.
-- Old booking records and old checkout sessions are deliberately not backfilled.
begin;
do $$declare constraint_name text;
begin
 for constraint_name in select c.conname from pg_constraint c
  where c.conrelid='public.account_legal_acceptances'::regclass and c.contype='u'
   and (select array_agg(a.attname::text order by k.ordinality) from unnest(c.conkey) with ordinality k(attnum,ordinality)
    join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum)=array['user_id','document_slug','version']
 loop execute format('alter table public.account_legal_acceptances drop constraint %I',constraint_name); end loop;
end;
$$;
commit;
