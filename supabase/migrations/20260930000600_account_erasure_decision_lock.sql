begin;
-- Serialise review decisions against preparation, including partial retries.
create or replace function public.review_account_deletion_request(p_id uuid,p_status text,p_note text)
returns void language plpgsql security definer set search_path=public as $fn$
declare current_status text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  select status into current_status from public.account_deletion_requests where id=p_id for update;
  if not found then raise exception 'Request not found'; end if;
  if not ((current_status='pending' and p_status='in_review') or (current_status='in_review' and p_status='declined')) then raise exception 'Request status has changed'; end if;
  if exists(select 1 from public.account_erasure_jobs where request_id=p_id) then raise exception 'Erasure has started; retry cleanup instead of declining'; end if;
  if p_status='declined' and length(btrim(coalesce(p_note,'')))<10 then raise exception 'Provide a reason'; end if;
  update public.account_deletion_requests set status=p_status,resolution_note=nullif(btrim(p_note),''),resolved_at=case when p_status='declined' then now() else null end where id=p_id;
end $fn$;
revoke all on function public.review_account_deletion_request(uuid,text,text) from public,anon,authenticated;
grant execute on function public.review_account_deletion_request(uuid,text,text) to service_role;

create or replace function public.finish_account_erasure(p_id uuid,p_note text)
returns void language plpgsql security definer set search_path=public as $fn$
declare current_status text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  select status into current_status from public.account_deletion_requests where id=p_id for update;
  if not found or current_status<>'in_review' or not exists(select 1 from public.account_erasure_jobs where request_id=p_id) then raise exception 'Erasure is not in progress'; end if;
  update public.account_deletion_requests set status='completed',resolved_at=now(),resolution_note=p_note where id=p_id;
  update public.account_erasure_jobs set completed_at=now(),files='[]' where request_id=p_id;
end $fn$;
revoke all on function public.finish_account_erasure(uuid,text) from public,anon,authenticated;
grant execute on function public.finish_account_erasure(uuid,text) to service_role;
commit;
