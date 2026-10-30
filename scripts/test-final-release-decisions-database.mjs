// Runs the actual migration in an isolated PostgreSQL engine, never a hosted DB.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const { PGlite } = await import(
  pathToFileURL(process.env.RETENTION_PGLITE_MODULE).href
);
const db = new PGlite();
const c = "11111111-1111-4111-8111-111111111111",
  w = "22222222-2222-4222-8222-222222222222",
  stranger = "33333333-3333-4333-8333-333333333333",
  p = "44444444-4444-4444-8444-444444444444",
  b = "55555555-5555-4555-8555-555555555555",
  s = "66666666-6666-4666-8666-666666666666";
await db.exec(`
set time zone 'UTC';
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.uid',true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$ select current_setting('request.role',true) $$;
create table auth.users(id uuid primary key,email text);
create table profiles(id uuid primary key,account_deleted_at timestamptz);
create table providers(id uuid primary key,profile_id uuid references profiles);
create table regular_booking_series(id uuid primary key,customer_id uuid,billing_paused boolean default false);
create table bookings(id uuid primary key,customer_id uuid references profiles,provider_id uuid references providers,
 regular_series_id uuid references regular_booking_series,scheduled_at timestamptz,status text,duration_minutes integer,
 preferred_scheduled_at timestamptz,optional_scheduled_at timestamptz[]);
create table booking_visit_billing(booking_id uuid primary key references bookings,active_operation_id uuid,status text,charge_due_at timestamptz);
create table booking_visit_money_operations(id uuid primary key default gen_random_uuid(),booking_id uuid references bookings,operation_type text,status text,parameters jsonb default '{}');
create table notifications(id uuid primary key default gen_random_uuid(),user_id uuid,title text,body text,href text);
create table booking_events(booking_id uuid,from_status text,to_status text,actor_id uuid,actor_kind text,reason text,meta jsonb);
create table faqs(question text,answer text,category text);
create function lock_visit_series(uuid) returns void language sql as $$select$$;
create function provider_service_approved(uuid,text) returns boolean language sql as $$select true$$;
create function professional_booking_conflict(uuid,uuid,timestamptz) returns text language sql as $$select null::text$$;
create function visit_charge_gate(p_booking uuid,p_operation uuid default null,p_kind text default 'charge') returns jsonb language sql as $$
 select jsonb_build_object('allowed',b.provider_id is not null and b.status='scheduled' and not coalesce(s.billing_paused,false),
 'assigned',b.provider_id is not null,'paused',coalesce(s.billing_paused,false),'reason',case when coalesce(s.billing_paused,false) then 'series_paused' else null end)
 from bookings b left join regular_booking_series s on s.id=b.regular_series_id where b.id=p_booking $$;
create function claim_visit_money_operation(p_operation uuid) returns jsonb language sql as $$select to_jsonb(o) from booking_visit_money_operations o where id=p_operation$$;
create function guard_visit_billing_booking_changes() returns trigger language plpgsql as $$begin
 if new.scheduled_at is distinct from old.scheduled_at then
   if old.scheduled_at<now()+interval '48 hours' then raise exception 'solo change below48h'; end if;
 end if;
 if new.scheduled_at is distinct from old.scheduled_at and exists(select 1 from booking_visit_billing where booking_id=old.id and active_operation_id is not null) then raise exception 'payment active'; end if;
 return new;end$$;
create trigger billing_changes before update on bookings for each row execute function guard_visit_billing_booking_changes();
insert into profiles(id) values('${c}'),('${w}'),('${stranger}');
insert into auth.users values('${c}','fixture@example.invalid');
insert into providers values('${p}','${w}');
insert into regular_booking_series values('${s}','${c}',false);
insert into bookings values('${b}','${c}','${p}','${s}',now()+interval '4 hours','scheduled',120,null,'{}');
insert into booking_visit_billing values('${b}',null,'unpaid',now());
insert into booking_visit_money_operations(id,booking_id,operation_type,status,parameters) values('77777777-7777-4777-8777-777777777777','${b}','charge','prepared','{"amountPence":5298}');
`);
await db.exec(
  readFileSync(
    "supabase/migrations/20261031000100_final_pack_release_decisions.sql",
    "utf8",
  ),
);
const query = async (sql, args = []) => (await db.query(sql, args)).rows;
const value = async (sql, args = []) => (await query(sql, args))[0].value;
const call = async (name, args) =>
  value(
    `select public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) as value`,
    args,
  );
const identity = async (uid, role = "authenticated") => {
  await query(
    "select set_config('request.uid',$1,false),set_config('request.role',$2,false)",
    [uid, role],
  );
};
let passed = 0;
const pass = (name) => {
  passed++;
  console.log("PASS " + name);
};
await identity(c, "service_role");
assert.deepEqual(
  await call("claim_regular_payment_notice", [
    "77777777-7777-4777-8777-777777777777",
  ]),
  { required: false, ready: true },
);
const op = (
  await query(
    "insert into booking_visit_money_operations(booking_id,operation_type,status,parameters) values($1,'charge','prepared','{\"amountPence\":5298}') returning id",
    [b],
  )
)[0].id;
assert.equal(
  await value(
    "select (parameters->>'prepaymentNoticeRequired')::boolean value from booking_visit_money_operations where id=$1",
    [op],
  ),
  true,
);
const notice = await call("claim_regular_payment_notice", [op]);
assert.equal(notice.required, true);
assert.equal(notice.ready, false);
assert.equal(notice.amountPence, 5298);
assert.ok(notice.token);
assert.equal(
  await value("select count(*)::integer value from notifications"),
  1,
);
assert.equal(
  (await call("visit_charge_gate", [b, op, "charge"])).allowed,
  false,
);
assert.equal(await call("claim_visit_money_operation", [op]), null);
pass(
  "new regular charges require both notices; legacy in-flight operations keep their recorded model",
);
assert.equal(
  (await call("claim_regular_payment_notice", [op])).token,
  undefined,
);
assert.equal(
  await value("select count(*)::integer value from notifications"),
  1,
);
assert.equal(
  await call("finish_regular_payment_notice", [
    notice.id,
    "00000000-0000-4000-8000-000000000000",
    "fake",
  ]),
  false,
);
assert.equal(
  await call("finish_regular_payment_notice", [
    notice.id,
    notice.token,
    "email_test_ref",
  ]),
  true,
);
assert.equal(
  (await call("visit_charge_gate", [b, op, "charge"])).allowed,
  true,
);
assert.ok(await call("claim_visit_money_operation", [op]));
assert.equal((await call("claim_regular_payment_notice", [op])).ready, true);
pass(
  "concurrent notice claims and delayed retries do not duplicate in-app mail or bypass acknowledgement",
);
await query(
  "update regular_booking_series set billing_paused=true where id=$1",
  [s],
);
assert.equal(
  (await call("visit_charge_gate", [b, op, "charge"])).allowed,
  false,
);
await query(
  "update regular_booking_series set billing_paused=false where id=$1",
  [s],
);
await query(
  "update booking_visit_money_operations set parameters=jsonb_set(parameters,'{amountPence}','6000') where id=$1",
  [op],
);
assert.equal(
  (await call("visit_charge_gate", [b, op, "charge"])).allowed,
  false,
);
await query(
  "update booking_visit_money_operations set parameters=jsonb_set(parameters,'{amountPence}','5298') where id=$1",
  [op],
);
pass(
  "a pause or changed amount still blocks a charge after an earlier notice was sent",
);
await identity(c);
const proposed = await value(
  "select date_trunc('day',now())+interval '2 days 10 hours' as value",
);
await assert.rejects(
  query("update bookings set scheduled_at=$2 where id=$1", [b, proposed]),
  /solo change/,
);
const request = await call("request_cleaning_time_change", [b, proposed]);
await assert.rejects(
  call("respond_cleaning_time_change", [request.id, true]),
  /not yours/,
);
assert.equal(
  await value(
    "select scheduled_at=$2::timestamptz value from bookings where id=$1",
    [b, request.original_at],
  ),
  true,
);
await identity(stranger);
await assert.rejects(
  call("respond_cleaning_time_change", [request.id, true]),
  /not yours/,
);
await identity(w);
const agreement = await call("respond_cleaning_time_change", [
  request.id,
  true,
]);
assert.equal(agreement.status, "agreed");
assert.equal(
  await value(
    "select scheduled_at=$2::timestamptz and provider_id=$3::uuid value from bookings where id=$1",
    [b, proposed, p],
  ),
  true,
);
assert.equal(
  (await call("respond_cleaning_time_change", [request.id, true])).status,
  "agreed",
);
assert.equal(
  await value("select count(*)::integer value from booking_events"),
  1,
);
pass(
  "under48h solo changes fail; the other party can agree a free move with assignment preserved, retry-safe",
);
const second = await call("request_cleaning_time_change", [
  b,
  new Date(new Date(proposed).getTime() + 86400000).toISOString(),
]);
await identity(c);
assert.equal(
  (await call("respond_cleaning_time_change", [second.id, false])).status,
  "declined",
);
assert.equal(
  await value(
    "select scheduled_at=$2::timestamptz value from bookings where id=$1",
    [b, proposed],
  ),
  true,
);
pass("declining a time change leaves the original time and payment unchanged");
assert.equal(
  await value(
    "select has_function_privilege('anon','public.claim_regular_payment_notice(uuid)','EXECUTE') value",
  ),
  false,
);
assert.equal(
  await value(
    "select has_function_privilege('authenticated','public.finish_regular_payment_notice(uuid,uuid,text)','EXECUTE') value",
  ),
  false,
);
assert.equal(
  await value(
    "select has_function_privilege('anon','public.respond_cleaning_time_change(uuid,boolean)','EXECUTE') value",
  ),
  false,
);
pass(
  "notice machine endpoints and two-party response permissions stay private",
);
await db.close();
console.log(JSON.stringify({ passed }));
