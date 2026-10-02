begin;
create table public.account_incidents(
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete restrict,
  booking_id uuid references public.bookings(id) on delete restrict,
  category text not null check(category in ('booking','safety','payment','account','other')),
  description text not null check(char_length(description) between 20 and 5000),
  status text not null default 'open' check(status in ('open','in_review','resolved')),
  created_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  resolution_note text
);
create index account_incidents_status_idx on public.account_incidents(status,created_at);
alter table public.account_incidents enable row level security;
revoke all on public.account_incidents from public,anon,authenticated;
grant all on public.account_incidents to service_role;
create trigger reject_erased_account_mutation before insert or update or delete on public.account_incidents
for each row execute function public.reject_erased_account_mutation();
commit;
