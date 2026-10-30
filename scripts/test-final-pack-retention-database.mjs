// Offline PostgreSQL only. No remote database, credentials, emails or payments.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const baseline =
  readFileSync("scripts/test-data-retention-database.mjs", "utf8").replace(
    "await db.close();",
    "",
  ) + "\nexport { db };";
const { db } = await import(
  `data:text/javascript;base64,${Buffer.from(baseline).toString("base64")}`
);
const check = (label) => console.log(`PASS final pack: ${label}`);
await db.exec(`
  reset role;
  select set_config('request.role','service_role',false);
  alter table profiles add full_name text, add email text, add phone text;
  alter table provider_verification_items add document_type text, add document_storage_path text;
  create table account_profile_details(user_id uuid primary key references profiles(id), first_name text);
  create table booking_visit_charges(id uuid primary key default gen_random_uuid(),booking_id uuid references bookings(id),created_at timestamptz default now());
  create table partner_interests(id uuid primary key default gen_random_uuid(),email text,partner_registered_at timestamptz,created_at timestamptz default now());
`);
await db.exec(
  readFileSync(
    "supabase/migrations/20261029000400_final_privacy_retention.sql",
    "utf8",
  ),
);
const value = async (sql, args = []) =>
  (await db.query(sql, args)).rows[0]?.value;
const call = (name, args = []) =>
  value(
    `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) value`,
    args,
  );
const customer = randomUUID(),
  held = randomUUID(),
  former = randomUUID(),
  worker = randomUUID(),
  activeWorker = randomUUID(),
  activeProfile = randomUUID();
await db.query(
  `insert into profiles(id,full_name,email,phone,account_deleted_at) values
  ($1,'Expired Customer','expired@example.invalid','+442079460123',now()-interval '13 months'),
  ($2,'Protected Customer','protected@example.invalid','+442079460123',now()-interval '13 months'),
  ($3,'Former Worker','former@example.invalid',null,now()-interval '25 months'),
  ($4,'Active Worker','active@example.invalid',null,null)`,
  [customer, held, former, activeProfile],
);
await db.query(
  "insert into account_profile_details(user_id,first_name) values($1,'Expired'),($2,'Protected')",
  [customer, held],
);
await db
  .query(
    "insert into customer_addresses(user_id,line1) values($1,'Old address'),($2,'Protected address')",
    [customer, held],
  )
  .catch(async () => {
    // The baseline intentionally has only the columns its old adapter needs.
    await db.query("insert into customer_addresses(user_id) values($1),($2)", [
      customer,
      held,
    ]);
  });
await db.query(
  "insert into providers(id,profile_id,retention_left_at) values($1,$2,now()-interval '25 months'),($3,$4,now()-interval '25 months')",
  [worker, former, activeWorker, activeProfile],
);
const expiredIdentity = randomUUID(),
  expiredInsurance = randomUUID(),
  activeIdentity = randomUUID();
await db.query(
  "insert into provider_verification_items(id,provider_id,document_type) values($1,$2,'right_to_work'),($3,$2,'public_liability_insurance'),($4,$5,'photo_id')",
  [expiredIdentity, worker, expiredInsurance, activeIdentity, activeWorker],
);
await db.query(
  "insert into bookings(id,customer_id,provider_id,status,scheduled_at) values($1,$2,$3,'scheduled',now()+interval '1 day')",
  [randomUUID(), held, activeWorker],
);
await db.query(
  "insert into data_retention_holds(user_id,reason) values($1,'Open complaint protects this person')",
  [held],
);

const candidates = async () =>
  (
    await db.query(
      "select category,entity_id from retention_candidates() c where not retention_has_hold(c.scope)",
    )
  ).rows;
let rows = await candidates();
assert.ok(
  rows.some(
    (r) => r.category === "customer_accounts" && r.entity_id === customer,
  ),
);
assert.ok(!rows.some((r) => r.entity_id === held));
assert.ok(
  rows.some(
    (r) =>
      r.category === "identity_right_to_work" &&
      r.entity_id === expiredIdentity,
  ),
);
assert.ok(
  rows.some(
    (r) => r.category === "trade_insurance" && r.entity_id === expiredInsurance,
  ),
);
assert.ok(!rows.some((r) => r.entity_id === activeIdentity));
check(
  "12-month customer and 2-year document clocks; open cases and upcoming work protected",
);

assert.equal(
  await call("retention_financial_cutoff", ["2010-01-01T00:00:00Z"]),
  null,
);
await db.exec(
  "update data_retention_control set financial_year_end_month=3,financial_year_end_day=31 where id",
);
assert.equal(
  new Date(
    await call("retention_financial_cutoff", ["2020-10-01T12:00:00Z"]),
  ).toISOString(),
  "2027-03-31T23:00:00.000Z",
);
assert.equal(
  new Date(
    await call("retention_financial_cutoff", ["2020-03-01T12:00:00Z"]),
  ).toISOString(),
  "2026-03-31T23:00:00.000Z",
);
check(
  "financial records are retained if the accounting year is unknown; year-end boundary and London DST are correct",
);

await db.exec("update data_retention_control set enabled=true where id");
await call("run_data_retention", [false]);
assert.equal(
  await value(
    "select retention_account_anonymised_at is not null value from profiles where id=$1",
    [customer],
  ),
  true,
);
assert.equal(
  await value(
    "select count(*)::integer value from provider_verification_items where id in ($1,$2)",
    [expiredIdentity, expiredInsurance],
  ),
  0,
);
assert.equal(
  await value(
    "select retention_account_anonymised_at is null value from profiles where id=$1",
    [held],
  ),
  true,
);
assert.equal(
  await value(
    "select count(*)::integer value from provider_verification_items where id=$1",
    [activeIdentity],
  ),
  1,
);
rows = await candidates();
assert.ok(
  !rows.some((r) =>
    [customer, expiredIdentity, expiredInsurance].includes(r.entity_id),
  ),
);
const second = await call("run_data_retention", [false]);
assert.equal(second.customer_accounts ?? 0, 0);
assert.equal(second.identity_right_to_work ?? 0, 0);
assert.equal(second.trade_insurance ?? 0, 0);
check(
  "only eligible data is cleared; repeat run produces no new deletions in the new categories",
);
await db.close();
