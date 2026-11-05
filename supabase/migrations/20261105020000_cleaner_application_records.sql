begin;

-- Pre-account applications: deliberately no FK to auth.users, no password and
-- no providers row. Invited assessment identity is a later, limited capability.
create table public.cleaner_applications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  full_name text not null check(char_length(full_name) between 1 and 150),
  email text not null check(char_length(email) between 3 and 254),
  phone text not null check(char_length(phone) between 8 and 40),
  postcode text not null check(char_length(postcode) between 5 and 10),
  areas text[] not null check(cardinality(areas) between 1 and 20),
  experience text not null check(char_length(experience) between 1 and 2000),
  availability text not null check(char_length(availability) between 1 and 1000),
  right_to_work_type text not null check(char_length(right_to_work_type) between 1 and 150),
  referral_code text check(char_length(referral_code)<=80),
  checks_acknowledged boolean not null check(checks_acknowledged),
  declaration_text text not null,
  declaration_source text not null,
  declaration_version text,
  declaration_pending boolean not null default true,
  privacy_version text not null,
  status text not null default 'applied' check(status in (
    'applied','screened','interviewed','id_rtw_verified','dbs_recorded','experience_checked',
    'invited','assessment_passed','accepted_setup','active','suspended','closed','not_progressed')),
  decision_at timestamptz,
  retention_due_at timestamptz,
  legal_hold boolean not null default false
);
alter table public.cleaner_applications enable row level security;
revoke all on public.cleaner_applications from public,anon,authenticated;
grant select on public.cleaner_applications to authenticated;
grant all on public.cleaner_applications to service_role;
create policy cleaner_applications_scoped_staff on public.cleaner_applications
  for select to authenticated using ((select public.can_review_professional()));

create table public.cleaner_application_communications (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.cleaner_applications(id) on delete cascade,
  template_key text not null,
  status text not null default 'awaiting_wording' check(status in ('awaiting_wording','queued','sent','failed')),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique(application_id,template_key)
);
alter table public.cleaner_application_communications enable row level security;
revoke all on public.cleaner_application_communications from public,anon,authenticated;
grant select on public.cleaner_application_communications to authenticated;
grant all on public.cleaner_application_communications to service_role;
create policy cleaner_application_mail_scoped_staff on public.cleaner_application_communications
  for select to authenticated using ((select public.can_review_professional()));

create function public.queue_cleaner_application_received()
returns trigger language plpgsql security definer set search_path=public as $fn$
begin
  insert into public.cleaner_application_communications(application_id,template_key)
    values(new.id,'applicationReceived');
  return new;
end;
$fn$;
revoke all on function public.queue_cleaner_application_received() from public,anon,authenticated,service_role;
create trigger queue_cleaner_application_received after insert on public.cleaner_applications
  for each row execute function public.queue_cleaner_application_received();

-- No login, role activation, document approval or email dispatch is performed.
notify pgrst, 'reload schema';
commit;
