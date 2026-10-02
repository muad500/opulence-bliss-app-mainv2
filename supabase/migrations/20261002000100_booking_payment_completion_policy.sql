-- The automatic checkout and admin capture retry handlers already exist, but
-- their successful transitions were missing from the authored policy seed.
-- Keep both service-only/admin-only and require the caller's audit reason.
begin;

insert into public.booking_transitions
  (from_status, to_status, actor_kind, required_assignment, reason_required, note)
values
  ('in_progress', 'completed', 'system', 'none', true,
   'Automatic checkout after the selected cleaning duration and grace period.')
on conflict (from_status, to_status, actor_kind) do update set
  required_assignment = excluded.required_assignment,
  reason_required = excluded.reason_required,
  note = excluded.note;

insert into public.payment_transitions
  (from_status, to_status, actor_kind, reason_required, note)
values
  ('capturing', 'succeeded', 'admin', true,
   'Stripe confirmed the administrator-requested capture retry.')
on conflict (from_status, to_status, actor_kind) do update set
  reason_required = excluded.reason_required,
  note = excluded.note;

commit;
