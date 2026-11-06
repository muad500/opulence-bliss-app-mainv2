begin;

-- A customer can already have accepted the same version before assessment.
-- Preserve that immutable canonical record and append separate evidence of
-- the post-assessment professional acceptance. Retention follows the same
-- canonical business-record row (six years after the contract ends).
create table public.cleaner_stage2_policy_acceptances (
  id bigint generated always as identity primary key,
  application_id uuid not null,
  account_acceptance_id bigint not null references public.account_legal_acceptances(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  document_slug text not null,
  version text not null,
  accepted_at timestamptz not null,
  acceptance_evidence jsonb not null,
  unique(application_id,document_slug,version)
);
alter table public.cleaner_stage2_policy_acceptances enable row level security;
revoke all on public.cleaner_stage2_policy_acceptances from public,anon,authenticated,service_role;
grant select on public.cleaner_stage2_policy_acceptances to authenticated;
grant all on public.cleaner_stage2_policy_acceptances to service_role;
grant usage,select on sequence public.cleaner_stage2_policy_acceptances_id_seq to service_role;
create policy stage2_acceptances_own on public.cleaner_stage2_policy_acceptances for select to authenticated
  using(user_id=(select auth.uid()));
create trigger immutable_stage2_acceptances before update or delete on public.cleaner_stage2_policy_acceptances
  for each row execute function public.guard_acceptance_evidence_mutation();

create function public.record_cleaner_stage2_acceptances(p_user uuid,p_evidence jsonb)
returns void language plpgsql security definer set search_path = '' as $fn$
declare app public.cleaner_applications; document jsonb; prepared jsonb; accepted timestamptz; passed timestamptz; canonical bigint;
begin
  select * into strict app from public.cleaner_applications where account_user_id=p_user for update;
  if app.status not in ('assessment_passed','accepted_setup') then raise exception 'Passed own applicant required';end if;
  select max(a.decided_at) into passed from cleaner_assessment_private.attempts a
    join cleaner_assessment_private.invitations i on i.id=a.invitation_id where i.application_id=app.id and a.phase='passed';
  accepted:=(p_evidence->>'acceptedAt')::timestamptz;
  if passed is null or accepted is null or accepted<passed or accepted>clock_timestamp()+interval '1 minute'
    or p_evidence->>'schemaVersion' is distinct from '1'
    or jsonb_typeof(p_evidence->'request') is distinct from 'object'
    or jsonb_typeof(p_evidence->'checkboxes') is distinct from 'array'
    or jsonb_array_length(p_evidence->'checkboxes')<5
    or exists(select 1 from jsonb_array_elements(p_evidence->'checkboxes') b where b->>'checked' is distinct from 'true')
    or jsonb_typeof(p_evidence->'documents') is distinct from 'array'
    or jsonb_array_length(p_evidence->'documents')<>5
    or (select count(distinct d->>'slug') from jsonb_array_elements(p_evidence->'documents') d
      where d->>'slug' in ('cleaner-terms','cleaner-cancellation','privacy','safeguarding','dbs-data'))<>5 then
    raise exception 'Fresh post-assessment policy evidence is required';
  end if;
  for document in select * from jsonb_array_elements(p_evidence->'documents') loop
    if not exists(select 1 from public.legal_documents d where d.slug=document->>'slug'
      and d.version=document->>'version' and d.published and d.content_html=document->>'sourceContentHtml'
      and encode(sha256(convert_to(d.content_html,'UTF8')),'hex')=document->>'contentHash') then
      raise exception 'Accepted policy snapshot changed; reload before accepting';
    end if;
    select id into strict canonical from public.account_legal_acceptances where user_id=p_user
      and document_slug=document->>'slug' and version=document->>'version' and booking_id is null;
    prepared:=(p_evidence-'documents')||jsonb_build_object('document',document);
    insert into public.cleaner_stage2_policy_acceptances(application_id,account_acceptance_id,user_id,
      document_slug,version,accepted_at,acceptance_evidence) values(app.id,canonical,p_user,
      document->>'slug',document->>'version',accepted,prepared) on conflict do nothing;
  end loop;
end;
$fn$;
revoke all on function public.record_cleaner_stage2_acceptances(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.record_cleaner_stage2_acceptances(uuid,jsonb) to service_role;

do $wire$
declare source text; corrected text;
begin
  select pg_get_functiondef('public.complete_cleaner_stage2_setup(uuid,text)'::regprocedure) into strict source;
  corrected:=replace(source,'public.account_legal_acceptances','public.cleaner_stage2_policy_acceptances');
  if corrected=source then raise exception 'Expected acceptance query missing';end if;
  execute corrected;
end;
$wire$;
notify pgrst,'reload schema';
commit;
