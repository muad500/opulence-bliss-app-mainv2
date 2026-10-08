begin;

-- A request is not a paid booking. Existing Stripe finalisation creates bookings.
create table if not exists public.voice_booking_requests (
  id uuid primary key default gen_random_uuid(),
  access_token text not null unique check (access_token ~ '^[a-f0-9]{64}$'),
  fingerprint text not null unique check (fingerprint ~ '^[a-f0-9]{64}$'),
  agent_id text not null,
  call_id text not null,
  email text not null,
  details jsonb not null,
  quote jsonb not null,
  customer_id uuid references auth.users(id) on delete cascade,
  checkout_session_id text unique,
  early_start_requested_at timestamptz,
  email_sent_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);
create index if not exists voice_booking_call_idx on public.voice_booking_requests (agent_id, call_id);
create index if not exists voice_booking_expiry_idx on public.voice_booking_requests (expires_at);

alter table public.voice_booking_requests enable row level security;
revoke all on public.voice_booking_requests from anon, authenticated;
grant select, insert, update, delete on public.voice_booking_requests to service_role;
comment on table public.voice_booking_requests is 'Private voice booking requests; accessed only by the server after Retell signature or customer identity verification.';

commit;
