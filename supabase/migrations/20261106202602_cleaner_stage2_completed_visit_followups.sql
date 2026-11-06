begin;

-- Completion time lives in check_ins, with the retained invoice as a fallback.
-- bookings has no completed_at column. Keep reminders independent of payments.
do $fix$
declare
  source text;
  previous_query text := $query$for completed in select id,completed_at,row_number() over(order by completed_at,id) as ordinal
      from public.bookings where provider_id=item.provider_id and status::text='completed' and completed_at is not null loop$query$;
  corrected_query text := $query$for completed in
      select finished.id, finished.completed_at,
        row_number() over (order by finished.completed_at, finished.id) as ordinal
      from (
        select b.id, coalesce(c.left_at, invoice.completed_at) as completed_at
        from public.bookings b
        left join lateral (
          select max(ci.left_at) as left_at
          from public.check_ins ci
          where ci.booking_id = b.id
        ) c on true
        left join lateral (
          select min(i.completed_at) as completed_at
          from public.provider_job_invoices i
          where i.booking_id = b.id and i.provider_id = b.provider_id
        ) invoice on true
        where b.provider_id = item.provider_id and b.status::text = 'completed'
      ) finished
      where finished.completed_at is not null
    loop$query$;
begin
  select replace(pg_get_functiondef(
    'public.process_cleaner_stage2_followups()'::regprocedure), E'\r\n', E'\n')
    into strict source;
  if position(previous_query in source) = 0 then
    raise exception 'Expected Stage 2 completion query is missing; review before replacing';
  end if;
  execute replace(source, previous_query, corrected_query);
end;
$fix$;

notify pgrst, 'reload schema';
commit;
