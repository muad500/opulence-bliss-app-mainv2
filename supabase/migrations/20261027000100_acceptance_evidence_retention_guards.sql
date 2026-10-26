begin;

-- All acceptance rows are append-only, including account-level acceptances.
-- Expired evidence is removable only by the existing, scoped retention job:
-- that job checks the last contract end + six years and every open case.
create function public.guard_acceptance_evidence_mutation()
returns trigger language plpgsql set search_path = public as $function$
begin
  if tg_op = 'DELETE' and public.retention_delete_authorised() then
    return old;
  end if;
  raise exception 'Acceptance evidence is immutable and reserved for authorised retention'
    using errcode = 'insufficient_privilege';
end;
$function$;
revoke all on function public.guard_acceptance_evidence_mutation()
  from public, anon, authenticated, service_role;

create trigger retain_checkout_acceptance_evidence
before update or delete on public.booking_checkout_legal_consents
for each row execute function public.guard_acceptance_evidence_mutation();
create trigger retain_account_acceptance_evidence
before update or delete on public.account_legal_acceptances
for each row execute function public.guard_acceptance_evidence_mutation();

commit;
