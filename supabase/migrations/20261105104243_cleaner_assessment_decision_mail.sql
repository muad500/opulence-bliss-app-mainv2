begin;

-- Only the assessment's supplied final-decision copy can use this queue. The
-- missing Process 9.1/9.3/invitation templates remain held in the other outbox.
create table cleaner_assessment_private.decision_emails (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null unique references cleaner_assessment_private.attempts(id) on delete cascade,
  application_id uuid not null references public.cleaner_applications(id) on delete cascade,
  copy_version text not null default '1.0' check (copy_version = '1.0'),
  status text not null default 'pending' check (status in ('pending', 'delivering', 'sent', 'failed')),
  created_at timestamptz not null default clock_timestamp(),
  first_attempt_at timestamptz,
  sent_at timestamptz,
  claim_token uuid,
  claimed_until timestamptz
);
alter table cleaner_assessment_private.decision_emails enable row level security;
revoke all on cleaner_assessment_private.decision_emails from public, anon, authenticated, service_role;

create function cleaner_assessment_private.queue_decision_email()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if new.phase = 'failed' and new.decided_at is not null
    and new.failure_reason is distinct from 'application not progressed' then
    insert into cleaner_assessment_private.decision_emails(attempt_id, application_id)
      select new.id, i.application_id from cleaner_assessment_private.invitations i
      where i.id = new.invitation_id on conflict (attempt_id) do nothing;
  end if;
  return new;
end;
$fn$;
create trigger queue_cleaner_assessment_decision after insert or update of phase, decided_at
  on cleaner_assessment_private.attempts for each row
  execute function cleaner_assessment_private.queue_decision_email();

create function public.claim_cleaner_assessment_emails(p_allowed text[])
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare v_rows jsonb;
begin
  -- Staging only uses an explicit recipient allowlist; never claim arbitrary
  -- applicant emails or put addresses/bodies in scheduler output.
  if p_allowed is null or cardinality(p_allowed) not between 1 and 50 then
    return '[]'::jsonb;
  end if;
  update cleaner_assessment_private.decision_emails set status = 'failed'
    where status <> 'sent' and first_attempt_at < clock_timestamp() - interval '23 hours';
  with wanted as (
    select e.id, c.email from cleaner_assessment_private.decision_emails e
    join public.cleaner_applications c on c.id = e.application_id
    join cleaner_assessment_private.attempts a on a.id = e.attempt_id
    where e.status in ('pending', 'delivering') and a.phase = 'failed'
      and c.status = 'not_progressed' and lower(c.email) = any(p_allowed)
      and a.failure_reason is distinct from 'application not progressed'
      and not exists (select 1 from cleaner_assessment_private.attempts newer
        where newer.invitation_id = a.invitation_id and newer.attempt_number > a.attempt_number)
      and (e.claimed_until is null or e.claimed_until < clock_timestamp())
    order by e.created_at limit 4 for update of e skip locked
  ), claimed as (
    update cleaner_assessment_private.decision_emails e set status = 'delivering',
      first_attempt_at = coalesce(first_attempt_at, clock_timestamp()),
      claim_token = gen_random_uuid(), claimed_until = clock_timestamp() + interval '10 minutes'
    from wanted w where e.id = w.id returning e.id, e.copy_version, e.claim_token, w.email
  ) select coalesce(jsonb_agg(to_jsonb(claimed)), '[]'::jsonb) into v_rows from claimed;
  return v_rows;
end;
$fn$;
create function public.finish_cleaner_assessment_email(p_id uuid, p_claim uuid, p_sent boolean)
returns boolean language plpgsql security definer set search_path = '' as $fn$
begin
  update cleaner_assessment_private.decision_emails set
    status = case when p_sent is true then 'sent' else 'pending' end,
    sent_at = case when p_sent is true then clock_timestamp() else null end,
    claim_token = null,
    claimed_until = case when p_sent is true then null else clock_timestamp() + interval '5 minutes' end
    where id = p_id and claim_token = p_claim and status = 'delivering'
      and claimed_until > clock_timestamp();
  return found;
end;
$fn$;
revoke all on function cleaner_assessment_private.queue_decision_email(),
  public.claim_cleaner_assessment_emails(text[]), public.finish_cleaner_assessment_email(uuid,uuid,boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_cleaner_assessment_emails(text[]),
  public.finish_cleaner_assessment_email(uuid,uuid,boolean) to service_role;

notify pgrst, 'reload schema';
commit;
