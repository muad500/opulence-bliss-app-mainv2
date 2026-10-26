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
const workerUser = randomUUID(),
  adminUser = randomUUID(),
  provider = randomUUID(),
  pkg = randomUUID(),
  deep = randomUUID();
await db.query(
  "insert into profiles(id,role,full_name,email,address,postcode) values($1,'provider','Synthetic Worker','fixture@example.invalid','Fixture road','N1 1AA'),($2,'admin','Fixture staff','staff@example.invalid',null,null)",
  [workerUser, adminUser],
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
  "insert into provider_onboarding_details values($1,'1990-01-01','1234567890')",
  [provider],
);
const booking = async (packageId = pkg, rate = 1500) => {
  const id = randomUUID();
  await db.query(
    "insert into bookings(id,package_id,status,scheduled_at,duration_minutes) values($1,$2,'offered',now()+interval '1 week',120)",
    [id, packageId],
  );
  // Enrichment needs an existing settings version; legacy test terms opt out.
  await db.query(
    "insert into booking_cleaning_billing_terms(booking_id,terms) values($1,$2)",
    [
      id,
      {
        version: "operations-test",
        cleanerHourlyPence: rate,
        deepCleanerHourlyPence: 1750,
        productsFeePence: 500,
        productsCleanerPayPence: 400,
        cancellationBasis: "cleaning_hours",
      },
    ],
  );
  return id;
};
const event = async (
  id,
  kind = "provider",
  from = "scheduled",
  to = "offered",
) =>
  db.query(
    "insert into booking_events(booking_id,from_status,to_status,actor_id,actor_kind) values($1,$2,$3,$4,$5)",
    [id, from, to, workerUser, kind],
  );
for (let i = 0; i < 2; i++) await event(await booking());
assert.equal(await value("select count(*)::int value from notifications"), 0);
pass("first two accepted-job cancellations use grace with no admin alert");
const third = await booking();
await event(third);
await event(third);
await event(await booking());
assert.equal(
  await value("select count(*)::int value from cleaner_reliability_events"),
  4,
);
assert.equal(
  await value("select count(*)::int value from cleaner_cancellation_alerts"),
  1,
);
assert.equal(await value("select count(*)::int value from notifications"), 1);
pass(
  "third cancellation alerts once and a retry/fourth cancellation cannot duplicate it",
);
await event(await booking(), "customer");
await event(await booking(), "provider", "offered", "declined");
assert.equal(
  await value("select count(*)::int value from cleaner_reliability_events"),
  4,
);
pass("customer cancellations and unaccepted offer declines do not count");
const future = await booking();
await db.query("update bookings set provider_id=$2 where id=$1", [
  future,
  provider,
]);
await db.query(
  "insert into review_cases(booking_id,category) values($1,'worker_no_show')",
  [future],
);
assert.equal(
  await value(
    "select count(*)::int value from cleaner_reliability_events where kind='no_show_report'",
  ),
  0,
);
await db.query(
  "update bookings set scheduled_at=now()-interval '1 hour' where id=$1",
  [future],
);
await db.query(
  "insert into review_cases(booking_id,category) values($1,'worker_no_show'),($1,'worker_no_show')",
  [future],
);
assert.equal(
  await value(
    "select count(*)::int value from cleaner_reliability_events where kind='no_show_report'",
  ),
  1,
);
pass(
  "future unmatched jobs are not false no-shows; genuine reports are flagged once",
);
const rate = async (base, start, last, at) =>
  value("select standard_cleaner_experience_rate($1,$2,$3,$4) value", [
    base,
    start,
    last,
    at,
  ]);
assert.equal(
  await rate(1500, "2026-01-01Z", "2026-05-30Z", "2026-05-31Z"),
  1500,
);
assert.equal(
  await rate(1500, "2026-01-01Z", "2026-05-30Z", "2026-06-01Z"),
  1525,
);
assert.equal(
  await rate(1500, "2025-01-01Z", "2025-12-30Z", "2026-01-01Z"),
  1550,
);
assert.equal(
  await rate(1750, "2025-01-01Z", "2025-12-30Z", "2026-01-01Z"),
  1750,
);
pass("calendar month 6 and 13 raise only the standard rate; deep stays 1750");
assert.equal(
  await rate(1500, "2025-01-01Z", "2026-01-01Z", "2026-04-01Z"),
  1500,
);
await db.query(
  "select advance_cleaner_experience($1,now()-interval '1 year')",
  [provider],
);
await db.query("select advance_cleaner_experience($1,now()-interval '1 day')", [
  provider,
]);
assert.equal(
  await value(
    "select started_at=last_completed_at value from cleaner_experience_clocks where provider_id=$1",
    [provider],
  ),
  true,
);
const clock = await value(
  "select last_completed_at::text value from cleaner_experience_clocks where provider_id=$1",
  [provider],
);
await db.query(
  "select advance_cleaner_experience($1,now()-interval '2 years')",
  [provider],
);
assert.equal(
  await value(
    "select last_completed_at::text value from cleaner_experience_clocks where provider_id=$1",
    [provider],
  ),
  clock,
);
pass(
  "90 days inactivity resets tenure and delayed old completion cannot move it backwards",
);
await db.query(
  "update cleaner_experience_clocks set started_at=now()-interval '6 months' where provider_id=$1",
  [provider],
);
const assigned = await booking();
await db.query(
  'insert into payments(booking_id,gross_amount,status,kind,split_breakdown) values($1,70.98,\'succeeded\',\'booking\',\'{"reserved_lines":[{"id":"cleaning","reservedMinutes":120,"amountPence":4598},{"id":"oven","amountPence":2000},{"id":"products","amountPence":500}]}\')',
  [assigned],
);
await db.query(
  "update bookings set provider_id=$2,status='scheduled' where id=$1",
  [assigned, provider],
);
assert.equal(
  await value("select effective_booking_cleaner_hourly_pence($1) value", [
    assigned,
  ]),
  1525,
);
assert.equal(
  Number(
    await value(
      "select (split_breakdown->>'provider')::numeric value from payments where booking_id=$1",
      [assigned],
    ),
  ),
  34.5,
);
assert.equal(
  Number(
    await value(
      "select (split_breakdown->>'business_extras')::numeric value from payments where booking_id=$1",
      [assigned],
    ),
  ),
  21,
);
pass(
  "assignment locks 1525 rate: 2 hours plus existing 400 products share = 3450; extras remain separate",
);
await db.query(
  "update cleaner_experience_clocks set started_at=now()-interval '14 months' where provider_id=$1",
  [provider],
);
await db.query("update bookings set provider_id=null where id=$1;", [assigned]);
await db.query("update bookings set provider_id=$2 where id=$1", [
  assigned,
  provider,
]);
assert.equal(
  await value("select effective_booking_cleaner_hourly_pence($1) value", [
    assigned,
  ]),
  1525,
);
const deepJob = await booking(deep, 1750);
await db.query("update bookings set provider_id=$2 where id=$1", [
  deepJob,
  provider,
]);
assert.equal(
  await value("select effective_booking_cleaner_hourly_pence($1) value", [
    deepJob,
  ]),
  1750,
);
pass(
  "a reaccepted job keeps its agreed rate and deep-clean assignment never gains a rise",
);
const complaint = randomUUID();
await db.query(
  "insert into account_incidents(id,reporter_id,subject_provider_id,log_kind,description) values($1,$2,$3,'complaint','A synthetic complaint for the isolated test')",
  [complaint, adminUser, provider],
);
assert.equal(
  await value(
    "select retention_has_hold(jsonb_build_object('provider',$1::text)) value",
    [provider],
  ),
  true,
);
await db.query(
  "update account_incidents set status='resolved',reviewed_by=$2,resolution_note='Reviewed synthetic outcome' where id=$1",
  [complaint, adminUser],
);
assert.equal(
  await value(
    "select count(*)::int value from account_incident_history where incident_id=$1",
    [complaint],
  ),
  2,
);
assert.equal(
  await value(
    "select retention_has_hold(jsonb_build_object('provider',$1::text)) value",
    [provider],
  ),
  false,
);
pass("open complaints protect the named professional; resolution is audited");
const payout = randomUUID();
await db.query(
  "insert into payouts(id,provider_id,booking_id,amount,status,created_at) values($1,$2,$3,34.50,'paid',now()-interval '2 years')",
  [payout, provider, assigned],
);
await db.query(
  "insert into payout_events(payout_id,to_status,created_at) values($1,'paid',now())",
  [payout],
);
await db.query(
  "select set_config('request.jwt.claims','{\"role\":\"service_role\"}',false)",
);
const dates = ["2026-01-01", "2027-01-01"];
const rows = (
  await db.query("select * from professional_earnings_export($1,$2)", dates)
).rows;
assert.equal(rows.length, 1);
assert.equal(Number(rows[0].net_paid_pence), 3450);
assert.equal(rows[0].utr_number, "1234567890");
assert.equal(rows[0].missing_details, "");
assert.equal(
  (
    await db.query("select * from professional_earnings_export($1,$2,$3)", [
      ...dates,
      provider,
    ])
  ).rows.length,
  0,
);
pass(
  "private export uses actual paid-event date, includes tax details, and paginates without duplication",
);
const maintenance = randomUUID(),
  transfer = randomUUID();
await db.query("insert into handyman_jobs(id,provider_id) values($1,$2)", [
  maintenance,
  provider,
]);
await db.query(
  "insert into handyman_quote_operations(id,job_id,kind,status,amount_pence,stripe_ref) values($1,$2,'transfer','succeeded',8000,'tr_fixture')",
  [transfer, maintenance],
);
await db.query(
  "insert into handyman_quote_operations(job_id,source_id,kind,status,amount_pence) values($1,$2,'reversal','succeeded',2000)",
  [maintenance, transfer],
);
const combined = (
  await db.query("select * from professional_earnings_export($1,$2)", dates)
).rows;
assert.equal(Number(combined[0].net_paid_pence), 9450);
assert.equal(Number(combined[0].transfer_count), 2);
pass(
  "export includes maintenance transfers and deducts recorded reversals without changing marketplace code",
);
await db.query(
  "update provider_onboarding_details set utr_number=null where provider_id=$1",
  [provider],
);
assert.match(
  (await db.query("select * from professional_earnings_export($1,$2)", dates))
    .rows[0].missing_details,
  /UTR missing/,
);
pass("missing private tax details are explicitly flagged, not invented");
await db.query(
  "select set_config('request.jwt.claims','{\"role\":\"authenticated\"}',false)",
);
await assert.rejects(
  db.query("select * from professional_earnings_export($1,$2)", dates),
  /Service role/,
);
assert.equal(
  await value(
    "select has_function_privilege('authenticated','public.professional_earnings_export(date,date,uuid)','execute') value",
  ),
  false,
);
assert.equal(
  await value(
    "select has_table_privilege('authenticated','public.booking_cleaner_pay_terms','update') value",
  ),
  false,
);
pass("non-staff cannot export tax data or rewrite pay snapshots");
const audited = (
  await db.query(
    "insert into professional_export_audits(actor_id,starts_on,ends_before,professional_count) values($1,'2026-04-06','2027-04-06',-1) returning actor_id,created_at,professional_count",
    [adminUser],
  )
).rows[0];
assert.equal(audited.actor_id, adminUser);
assert.ok(audited.created_at);
assert.equal(audited.professional_count, -1);
for (const role of ["anon", "authenticated"])
  for (const privilege of ["select", "insert", "update", "delete"])
    assert.equal(
      await value(
        "select has_table_privilege($1,'public.professional_export_audits',$2) value",
        [role, privilege],
      ),
      false,
    );
assert.equal(
  await value(
    "select has_table_privilege('service_role','public.professional_export_audits','delete') value",
  ),
  false,
);
pass(
  "CSV audits keep database timestamps and actor identity without public write or delete access",
);
const existingUnassigned = await booking();
const existingAgreed = await booking();
await db.query(
  "update cleaner_experience_clocks set started_at=now()-interval '14 months',last_completed_at=now() where provider_id=$1",
  [provider],
);
await db.query("update bookings set provider_id=$2 where id=$1", [
  existingAgreed,
  provider,
]);
const agreedBeforeRelease = await value(
  "select effective_booking_cleaner_hourly_pence($1) value",
  [existingAgreed],
);
const moneyRecords = async () =>
  JSON.stringify(
    (
      await db.query(
        "select (select jsonb_agg(to_jsonb(p) order by id) from payments p) payments,(select jsonb_agg(to_jsonb(p) order by id) from payouts p) payouts",
      )
    ).rows,
  );
const recordsBeforeRelease = await moneyRecords();
await db.exec(
  readFileSync(
    "supabase/migrations/20261026000900_preserve_existing_booking_pay.sql",
    "utf8",
  ),
);
assert.equal(await moneyRecords(), recordsBeforeRelease);
pass(
  "the new-booking safeguard does not rewrite any existing payment or payout",
);
await db.query("update bookings set provider_id=$2 where id=$1", [
  existingUnassigned,
  provider,
]);
assert.equal(
  await value("select effective_booking_cleaner_hourly_pence($1) value", [
    existingUnassigned,
  ]),
  1500,
);
await db.query("update bookings set provider_id=null where id=$1", [
  existingUnassigned,
]);
await db.query("update bookings set provider_id=$2 where id=$1", [
  existingUnassigned,
  provider,
]);
assert.equal(
  await value("select effective_booking_cleaner_hourly_pence($1) value", [
    existingUnassigned,
  ]),
  1500,
);
assert.equal(
  await value("select effective_booking_cleaner_hourly_pence($1) value", [
    existingAgreed,
  ]),
  agreedBeforeRelease,
);
assert.equal(
  await value("select effective_booking_cleaner_hourly_pence($1) value", [
    assigned,
  ]),
  1525,
);
pass(
  "pre-release unassigned and reaccepted bookings keep original pay; existing agreements stay unchanged",
);
const afterRelease = await booking();
await db.query("update bookings set provider_id=$2 where id=$1", [
  afterRelease,
  provider,
]);
assert.equal(
  await value("select effective_booking_cleaner_hourly_pence($1) value", [
    afterRelease,
  ]),
  1550,
);
assert.equal(
  await value(
    "select count(*)::int value from existing_booking_cleaner_pay where booking_id=$1",
    [afterRelease],
  ),
  0,
);
const afterReleaseDeep = await booking(deep, 1750);
await db.query("update bookings set provider_id=$2 where id=$1", [
  afterReleaseDeep,
  provider,
]);
assert.equal(
  await value("select effective_booking_cleaner_hourly_pence($1) value", [
    afterReleaseDeep,
  ]),
  1750,
);
pass(
  "only bookings created after release gain experience pay; deep-clean rates remain unchanged",
);
for (const role of ["anon", "authenticated"])
  for (const privilege of ["select", "insert", "update", "delete"])
    assert.equal(
      await value(
        "select has_table_privilege($1,'public.existing_booking_cleaner_pay',$2) value",
        [role, privilege],
      ),
      false,
    );
for (const privilege of ["insert", "update", "delete"])
  assert.equal(
    await value(
      "select has_table_privilege('service_role','public.existing_booking_cleaner_pay',$1) value",
      [privilege],
    ),
    false,
  );
pass(
  "customers and staff API callers cannot rewrite the pre-release booking pay guard",
);
console.log(`${passed} PostgreSQL assertions passed`);
await db.close();
