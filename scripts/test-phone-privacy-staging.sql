-- Run against the staging database only. All synthetic rows are rolled back.
begin;

insert into auth.users (id) values
  ('10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000003'),
  ('10000000-0000-4000-8000-000000000004');

insert into public.profiles (id, role, full_name, phone) values
  ('10000000-0000-4000-8000-000000000001', 'customer', 'Privacy Test Customer', '+447700900123'),
  ('10000000-0000-4000-8000-000000000002', 'provider', 'Assigned Cleaner', null),
  ('10000000-0000-4000-8000-000000000003', 'provider', 'Other Cleaner', null),
  ('10000000-0000-4000-8000-000000000004', 'admin', 'Privacy Test Admin', null);

insert into public.providers (id, profile_id, vetting_status, dbs_verified) values
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'approved', true),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003', 'approved', true);

insert into public.packages (id, name, price, service_type, duration_minutes) values
  ('30000000-0000-4000-8000-000000000001', 'Privacy Test Clean', 40, 'cleaning', 120);

insert into public.bookings (
  id, customer_id, provider_id, package_id, scheduled_at,
  preferred_scheduled_at, duration_minutes, status
)
select
  ('40000000-0000-4000-8000-00000000000' || item.n)::uuid,
  '10000000-0000-4000-8000-000000000001'::uuid,
  case when item.state = 'offered' then null::uuid else '20000000-0000-4000-8000-000000000002'::uuid end,
  '30000000-0000-4000-8000-000000000001'::uuid,
  ((current_date + 7) + time '12:00') at time zone 'Europe/London',
  ((current_date + 7) + time '12:00') at time zone 'Europe/London',
  120,
  item.state::public.booking_status
from (values
  (1, 'scheduled'),
  (2, 'in_progress'),
  (3, 'completed'),
  (4, 'cancelled'),
  (5, 'needs_review'),
  (6, 'offered')
) as item(n, state);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);

do $test$
declare
  v_phone text;
  v_n integer;
begin
  select phone into v_phone from public.booking_customer_summary('40000000-0000-4000-8000-000000000001');
  if v_phone is distinct from '+447700900123' then
    raise exception 'Assigned cleaner cannot see scheduled customer phone';
  end if;
  select phone into v_phone from public.booking_customer_summary('40000000-0000-4000-8000-000000000002');
  if v_phone is distinct from '+447700900123' then
    raise exception 'Assigned cleaner cannot see in-progress customer phone';
  end if;
  select count(*) into v_n
    from (values (3), (4), (5)) as closed(n)
   where (select phone from public.booking_customer_summary(
     ('40000000-0000-4000-8000-00000000000' || closed.n)::uuid
   )) is not null;
  if v_n <> 0 then
    raise exception 'Closed or review bookings exposed a customer phone';
  end if;
  begin
    perform public.booking_customer_summary('40000000-0000-4000-8000-000000000006');
    raise exception 'Unaccepted offer was not refused';
  exception when insufficient_privilege then null;
  end;
end
$test$;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
do $test$
begin
  begin
    perform public.booking_customer_summary('40000000-0000-4000-8000-000000000001');
    raise exception 'Different cleaner was not refused';
  exception when insufficient_privilege then null;
  end;
end
$test$;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
do $test$
declare v_phone text;
begin
  select phone into v_phone from public.booking_customer_summary('40000000-0000-4000-8000-000000000003');
  if v_phone is distinct from '+447700900123' then
    raise exception 'Admin cannot see closed booking phone';
  end if;
end
$test$;

select set_config('request.jwt.claim.sub', '', true);
do $test$
begin
  begin
    perform public.booking_customer_summary('40000000-0000-4000-8000-000000000001');
    raise exception 'Signed-out caller was not refused';
  exception when insufficient_privilege then null;
  end;
end
$test$;

rollback;
