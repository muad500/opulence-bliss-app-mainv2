begin;

-- Contract phase. Deploy the safe customer readers before applying this file.
-- A legacy permissive policy otherwise allows every stored column on approved
-- providers. Restrictive AND semantics close it without weakening self/staff
-- policy checks or the existing erased-account restriction.
create policy private_provider_records on public.providers as restrictive
  for select to anon, authenticated
  using (profile_id = (select auth.uid()) or (select public.can_review_professional()));

notify pgrst, 'reload schema';
commit;
