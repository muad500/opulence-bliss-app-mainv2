begin;

-- Stage 1 staff helpers intentionally require an authenticated staff session.
-- Keep their predicates for authenticated callers, but do not evaluate them
-- during public catalogue reads. ALL policies also participate in SELECT, so
-- the existing staff-write policies must not target anonymous callers.
alter policy "anyone reads active packages" on public.packages to authenticated;
alter policy "admin writes packages" on public.packages to authenticated;
create policy "anonymous reads active packages" on public.packages
  for select to anon using (active);

alter policy "anyone reads active areas" on public.service_areas to authenticated;
alter policy "admin writes areas" on public.service_areas to authenticated;
create policy "anonymous reads active areas" on public.service_areas
  for select to anon using (active);

alter policy "public reads published faqs" on public.faqs to authenticated;
create policy "anonymous reads published faqs" on public.faqs
  for select to anon using (published);

-- No table/function grants, row changes, staff/MFA changes or private-table
-- policy changes. Existing authenticated predicates remain byte-for-byte intact.
notify pgrst, 'reload schema';
commit;
