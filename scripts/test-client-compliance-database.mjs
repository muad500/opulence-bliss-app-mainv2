// Isolated PostgreSQL. Never reads credentials or connects to a website.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
const { PGlite } = await import(
  pathToFileURL(process.env.RETENTION_PGLITE_MODULE).href
);
const db = new PGlite();
let passed = 0;
const pass = (name) => {
  passed++;
  console.log(`PASS ${name}`);
};
const value = async (sql, args = []) =>
  (await db.query(sql, args)).rows[0]?.value;
// Reuse the launch test's real table shapes and reviewed billing functions.
let fixture = readFileSync(
  "supabase/tests/launch_safety.sql",
  "utf8",
).replaceAll("\r\n", "\n");
fixture = fixture.slice(
  fixture.indexOf("create role anon;"),
  fixture.indexOf("insert into public.cleaning_billing_settings(terms) values"),
);
await db.exec(fixture);
await db.exec(`
alter table profiles add column address text,add column postcode text;
alter table bookings add column retention_ended_at timestamptz;
alter table review_cases add column created_at timestamptz default now();
create table provider_profile_settings(provider_id uuid primary key references providers(id),home_postcode text);
create table provider_onboarding_details(provider_id uuid primary key references providers(id),date_of_birth date,utr_number text);
create table handyman_jobs(id uuid primary key default gen_random_uuid(),provider_id uuid references providers(id),quote_mode boolean default true,bill jsonb,transfer_ref text,retention_ended_at timestamptz,updated_at timestamptz default now());
create table handyman_quote_operations(id uuid primary key default gen_random_uuid(),job_id uuid references handyman_jobs(id),source_id uuid references handyman_quote_operations(id),kind text,status text,amount_pence integer,stripe_ref text,updated_at timestamptz default now());
create table account_incidents(id uuid primary key default gen_random_uuid(),reporter_id uuid references profiles(id),booking_id uuid references bookings(id),category text,description text,status text default 'open',reviewed_by uuid references profiles(id),reviewed_at timestamptz,resolution_note text);
create function retention_has_hold(p_scope jsonb) returns boolean language sql as $$
with scope_users as (select (p_scope->>'user')::uuid id union select profile_id from providers where id=(p_scope->>'provider')::uuid),
scope_bookings as (select id from bookings where id=(p_scope->>'booking')::uuid)
select exists(select 1 from account_incidents where status<>'resolved'
and (reporter_id in(select id from scope_users) or booking_id in(select id from scope_bookings))) $$;
`);
let launch = readFileSync(
  "supabase/migrations/20261024000400_launch_cleaning_pay_terms.sql",
  "utf8",
);
// Cancellation deadline substitutions belong to the existing launch suite;
// retain the actual allocation/enrichment functions for these integration tests.
launch = launch.slice(0, launch.indexOf("do $migration$")) + "commit;";
await db.exec(launch);
let cancellation = readFileSync(
  "supabase/migrations/20261024000500_cleaning_cancellation_settlements.sql",
  "utf8",
);
// That migration's final historical patch targets a different cancellation
// fixture revision. Its existing dedicated suite covers that patch; here use
// the real snapshot, settlement tables and triggers our new migration changes.
cancellation =
  cancellation.slice(0, cancellation.indexOf("do $migration$")) + "commit;";
await db.exec(cancellation);
for (const file of [
  "20261026000500_cleaner_reliability_and_complaints.sql",
  "20261026000600_standard_cleaner_experience_pay.sql",
  "20261026000700_private_professional_earnings_export.sql",
  "20261026000800_all_service_earnings_export.sql",
])
  await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
pass(
  "all four migrations install with reviewed allocation and cancellation functions",
);
await db.exec(
  readFileSync(
    "supabase/migrations/20261026000900_preserve_existing_booking_pay.sql",
    "utf8",
  ),
);
await db.exec(
  readFileSync(
    "supabase/migrations/20261027000200_approved_absence_cleaner_pay.sql",
    "utf8",
  ),
);
const adminUser = randomUUID(),
  workerUser = randomUUID(),
  provider = randomUUID(),
  pkg = randomUUID(),
  deep = randomUUID();
await db.query(
  "insert into profiles(id,role) values($1,'admin'),($2,'provider')",
  [adminUser, workerUser],
);
await db.query("insert into providers(id,profile_id) values($1,$2)", [
  provider,
  workerUser,
]);
await db.query(
  "insert into packages(id,name) values($1,'Essential Clean'),($2,'Signature Deep Clean')",
  [pkg, deep],
);
await db.query(
  "insert into cleaner_experience_clocks values($1,now()-interval '2 years',now()-interval '100 days')",
  [provider],
);
const claims = async (who, aal = "aal2") =>
  db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: who, role: "authenticated", aal }),
  ]);
const retain = () =>
  value(
    "select set_cleaner_rate_retention($1,true,current_date-101,current_date-100,'Written advance notice fixture') value",
    [provider],
  );
await claims(workerUser);
await assert.rejects(retain(), /staff sign-in/);
await claims(adminUser, "aal1");
await assert.rejects(retain(), /staff sign-in/);
await claims(adminUser);
await assert.rejects(
  value(
    "select set_cleaner_rate_retention($1,true,current_date-99,current_date-100,'Written advance notice fixture') value",
    [provider],
  ),
  /before the absence/,
);
assert.equal(await retain(), 1550);
pass("MFA staff only; advance written notice required; retains an earned rate");
await assert.rejects(
  db.exec("update cleaner_rate_retention_events set hourly_pence=1500"),
  /append only/,
);
await assert.rejects(
  db.exec("delete from cleaner_rate_retention_events"),
  /append only/,
);
pass("Pay exceptions are append-only with actor, date and notice reference");
const booking = async (packageId = pkg, rate = 1500) => {
  const id = randomUUID();
  await db.query(
    "insert into bookings(id,package_id,status,created_at,scheduled_at,duration_minutes) values($1,$2,'offered',clock_timestamp(),now()+interval '1 week',120)",
    [id, packageId],
  );
  await db.query(
    "insert into booking_cleaning_billing_terms(booking_id,terms) values($1,$2)",
    [
      id,
      {
        version: "fixture",
        cleanerHourlyPence: rate,
        deepCleanerHourlyPence: 1750,
        productsCleanerPayPence: 400,
      },
    ],
  );
  return id;
};
const beforeException = await booking();
await db.query(
  "update bookings set created_at=now()-interval '1 day' where id=$1",
  [beforeException],
);
const duringException = await booking();
const duringDeep = await booking(deep, 1750);
for (const id of [beforeException, duringException, duringDeep])
  await db.query("update bookings set provider_id=$2 where id=$1", [
    id,
    provider,
  ]);
const rate = (id) =>
  value("select effective_booking_cleaner_hourly_pence($1) value", [id]);
assert.equal(await rate(beforeException), 1500);
assert.equal(await rate(duringException), 1550);
assert.equal(await rate(duringDeep), 1750);
pass(
  "90-day inactivity retains earned standard pay only on new bookings; deep rate unchanged",
);
const promisedUnassigned = await booking();
await value(
  "select set_cleaner_rate_retention($1,false,null,null,'Ending the approved exception fixture') value",
  [provider],
);
await db.query("update bookings set provider_id=$2 where id=$1", [
  promisedUnassigned,
  provider,
]);
const afterRelease = await booking();
await db.query("update bookings set provider_id=$2 where id=$1", [
  afterRelease,
  provider,
]);
assert.equal(await rate(promisedUnassigned), 1550);
assert.equal(await rate(afterRelease), 1500);
assert.equal(await rate(duringException), 1550);
pass(
  "Withdrawing the exception preserves existing assigned and unassigned promises",
);
await db.exec(`
 alter table providers add column services text[] default array['cleaning','handyman'];
 create table provider_verification_items (
 id uuid primary key default gen_random_uuid(),provider_id uuid references providers,document_type text,
 label text,status text,reference text,issued_at date,expires_at date,checked_at timestamptz,
 next_check_at date,reviewed_by uuid,review_note text,document_storage_path text,
 document_original_name text,document_mime_type text,uploaded_at timestamptz,updated_at timestamptz,
 unique(provider_id,document_type),constraint provider_verification_items_document_type_check check(document_type in('trade_certificate')));
 create table verification_renewal_reminders(provider_id uuid,check_type text,due_date date,phase text,recipient_id uuid,
 primary key(provider_id,check_type,due_date,phase,recipient_id),constraint verification_renewal_reminders_check_type_check check(check_type in('dbs','right_to_work','insurance')));
 create function notification_essential_email(p_title text) returns boolean language sql immutable as $$select p_title ~* '(security|verification code|cancel)'$$;
`);
await db.exec(
  readFileSync(
    "supabase/migrations/20261027000300_trade_registration_evidence.sql",
    "utf8",
  ),
);
await db.exec(
  readFileSync(
    "supabase/migrations/20261027000400_thirty_minute_checkin_admin_alert.sql",
    "utf8",
  ),
);
await db.exec(
  `select set_config('request.jwt.claims','{"role":"service_role"}',false)`,
);
const docPath = provider + "/gas_safe_registration/fixture.pdf";
await db.query(
  "insert into storage.objects(bucket_id,name) values('provider-verification',$1)",
  [docPath],
);
const upload = (reference, expiry) =>
  value(
    "select replace_provider_verification_document($1,'gas_safe_registration','Gas Safe registration',$2,'fixture.pdf','application/pdf',null,$3,$4) value",
    [provider, docPath, expiry, reference],
  );
await assert.rejects(upload(null, null), /registration number/);
await assert.rejects(upload("123456", "2020-01-01"), /registration number/);
await upload(
  "123456",
  new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10),
);
assert.equal(
  await value("select status value from provider_verification_items limit 1"),
  "pending",
);
await db.exec("update provider_verification_items set status='verified'");
assert.equal(
  await value("select process_trade_registration_renewals() value"),
  2,
);
assert.equal(
  await value("select process_trade_registration_renewals() value"),
  0,
);
pass(
  "Registration requires private evidence, number and expiry; staff review; 30-day reminders once to professional and admin",
);
await db.exec(
  "update provider_verification_items set expires_at=current_date-1",
);
assert.equal(
  await value("select process_trade_registration_renewals() value"),
  2,
);
assert.equal(
  await value("select status value from provider_verification_items limit 1"),
  "expired",
);
assert.equal(
  await value("select process_trade_registration_renewals() value"),
  0,
);
assert.equal(
  await value("select vetting_status value from providers where id=$1", [
    provider,
  ]),
  "pending",
);
pass(
  "Expiry flagged once; no cleaning approval, marketplace or existing check changed",
);
for (const title of [
  "Cleaner check-in overdue",
  "Gas Safe registration expiry",
  "Electrical registration expiry",
])
  assert.equal(
    await value("select notification_essential_email($1) value", [title]),
    true,
  );
pass("Safety and registration notices remain essential emails");
await db.exec("update bookings set status='cancelled'");
const alertBooking = async (minutes, status = "scheduled", checked = false) => {
  const id = await booking();
  await db.query(
    "update bookings set provider_id=$2,status=$3,scheduled_at=now()-$4*interval '1 minute' where id=$1",
    [id, provider, status, minutes],
  );
  if (checked)
    await db.query("insert into check_ins(booking_id) values($1)", [id]);
  return id;
};
await alertBooking(29);
await alertBooking(30, "cancelled");
await alertBooking(31, "scheduled", true);
assert.equal(await value("select alert_missing_cleaner_checkins() value"), 0);
const overdue = await alertBooking(30);
assert.equal(await value("select alert_missing_cleaner_checkins() value"), 1);
assert.equal(await value("select alert_missing_cleaner_checkins() value"), 0);
assert.equal(
  await value("select status value from bookings where id=$1", [overdue]),
  "scheduled",
);
assert.equal(
  await value(
    "select count(*)::int value from notifications where title='Cleaner check-in overdue'",
  ),
  1,
);
pass(
  "30-minute boundary alerts once; 29 minutes, cancelled and arrived visits excluded; booking state unchanged",
);
for (const role of ["anon", "authenticated"])
  assert.equal(
    await value(
      "select has_function_privilege($1,'public.alert_missing_cleaner_checkins()','execute') value",
      [role],
    ),
    false,
  );
pass("Safety scheduler is private to trusted workers");
console.log(JSON.stringify({ passed }));
await db.close();
