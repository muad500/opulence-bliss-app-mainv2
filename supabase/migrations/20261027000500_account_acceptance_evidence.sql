begin;

-- Account registration and professional agreements need the same evidence as
-- checkout. Older records remain unchanged; never invent historical evidence.
alter table public.account_legal_acceptances
  add column acceptance_evidence jsonb,
  add constraint account_acceptance_evidence_object check (
    acceptance_evidence is null or (
      jsonb_typeof(acceptance_evidence) = 'object'
      and acceptance_evidence ->> 'schemaVersion' = '1'
      and jsonb_typeof(acceptance_evidence -> 'request') = 'object'
      and jsonb_typeof(acceptance_evidence -> 'checkboxes') = 'array'
      and jsonb_typeof(acceptance_evidence -> 'document') = 'object'
    )
  );

-- The existing immutable trigger covers this column. The existing scoped
-- business-record purge retains it until six years after the last contract
-- ends (or account closure), and continues to respect open case holds.
create function public.account_acceptance_evidence_ready()
returns boolean language sql stable set search_path = public as $$select true$$;
revoke all on function public.account_acceptance_evidence_ready() from public;
grant execute on function public.account_acceptance_evidence_ready() to anon, authenticated, service_role;

commit;
notify pgrst, 'reload schema';
