begin;

-- Stage 1 correctly removed anonymous execution of staff permission helpers.
-- The combined legal read policy still called is_admin() for anonymous users,
-- causing public policy preparation (and Google sign-in) to fail. Keep the
-- same visibility rules, but do not call staff helpers from an anonymous read.
drop policy "published legal documents are public" on public.legal_documents;
create policy "published legal documents are public" on public.legal_documents
  for select to authenticated using (
    public.is_admin() or (published and (audience<>'professionals' or exists (
      select 1 from public.providers p where p.profile_id=auth.uid()
    )))
  );
create policy "anonymous published customer legal documents" on public.legal_documents
  for select to anon using (published and audience<>'professionals');

-- No staff-function grants, legal text/version changes, account changes,
-- provider access changes or authentication bypasses.
notify pgrst, 'reload schema';
commit;
