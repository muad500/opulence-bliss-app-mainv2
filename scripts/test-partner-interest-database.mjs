// Isolated PostgreSQL only: no website, mail, credentials or customer data.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
const { PGlite } = await import(
  pathToFileURL(process.env.RETENTION_PGLITE_MODULE).href
);
const db = new PGlite();
let passed = 0;
const check = (name) => {
  passed++;
  console.log(`PASS ${name}`);
};
const value = async (sql, args = []) =>
  (await db.query(sql, args)).rows[0]?.value;
const call = (name, args = []) =>
  value(
    `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) value`,
    args,
  );
// Reuse the real retention schema fixture and all its current adapters.
const previous = readFileSync(
  "scripts/test-data-retention-database.mjs",
  "utf8",
);
const fixture = previous.slice(
  previous.indexOf("await db.exec(`") + "await db.exec(`".length,
  previous.indexOf("`);", previous.indexOf("await db.exec(`")),
);
await db.exec(fixture);
await db.exec(
  `alter table profiles add column email text; create function public.is_admin() returns boolean language sql stable as $$select coalesce(current_setting('test.mfa',true),'')='true'$$;`,
);
for (const name of [
  "20261026000100_automatic_data_retention",
  "20261026000200_retention_incomplete_applications",
  "20261026000300_retention_storage_and_contract_boundaries",
  "20261026000400_retention_dbs_metadata_completion",
  "20261027000100_acceptance_evidence_retention_guards",
  "20261027000500_account_acceptance_evidence",
  "20261028000100_partner_interest_registration",
  "20261028000200_partner_interest_retention",
])
  await db.exec(readFileSync("supabase/migrations/" + name + ".sql", "utf8"));
check(
  "Both Partner migrations install without deleting existing records or enabling retention",
);
const consent =
  "I agree to be contacted about the partnership opportunity and have read the privacy notice.";
const register = (email, rate = "a".repeat(64)) =>
  call("register_partner_interest", [
    "Fixture Person",
    email,
    "+442079460123",
    "Freelancer",
    consent,
    "203.0.113.28",
    rate,
  ]);
const first = await register("fixture@example.test");
assert.ok(first.id);
assert.equal(first.duplicate, false);
assert.equal(
  await value("select count(*)::int value from partner_interests"),
  1,
);
assert.equal(
  await value("select count(*)::int value from partner_interest_email_queue"),
  1,
);
assert.equal(
  await value("select consent_wording value from partner_interests"),
  consent,
);
check(
  "Contact details, exact consent, timestamp and trusted IP are saved with one transactional email",
);
const duplicate = await register("fixture@example.test");
assert.equal(duplicate.duplicate, true);
assert.equal(duplicate.id, undefined);
assert.equal(
  await value("select count(*)::int value from partner_interest_email_queue"),
  1,
);
check(
  "An email duplicate returns the same public success without enqueuing another email",
);
for (let i = 1; i < 10; i++)
  assert.ok((await register(`rate${i}@example.test`)).id);
assert.equal((await register("rateblocked@example.test")).limited, true);
assert.equal((await register("fixture@example.test")).duplicate, true);
check(
  "Per-IP hourly rate limit is atomic and a duplicate remains generic even at the limit",
);
await assert.rejects(
  call("register_partner_interest", [
    "F",
    "bad",
    "+44",
    "Other",
    consent,
    null,
    "a".repeat(64),
  ]),
  /Invalid/,
);
await assert.rejects(
  call("register_partner_interest", [
    "Fixture",
    "new@example.test",
    "+442079460123",
    "Other",
    "different words",
    null,
    "a".repeat(64),
  ]),
  /Invalid/,
);
check("Database rejects invalid contact data and invented consent wording");
await assert.rejects(
  db.query("update partner_interests set consent_ip=$1 where id=$2", [
    "198.51.100.5",
    first.id,
  ]),
  /immutable/,
);
await assert.rejects(
  db.query("delete from partner_interests where id=$1", [first.id]),
  /retention/,
);
check(
  "Consent evidence and contact details cannot be edited or deleted outside retention",
);
const claimed = (
  await db.query("select * from claim_partner_interest_emails(1,$1)", [
    first.id,
  ])
).rows[0];
assert.ok(claimed.claim_token);
assert.equal(
  (
    await db.query("select * from claim_partner_interest_emails(1,$1)", [
      first.id,
    ])
  ).rows.length,
  0,
);
await assert.rejects(
  call("finish_partner_interest_email", [claimed.id, randomUUID(), "sent"]),
  /expired/,
);
await call("finish_partner_interest_email", [
  claimed.id,
  claimed.claim_token,
  "retry",
]);
assert.equal(
  await value(
    "select status value from partner_interest_email_queue where id=$1",
    [claimed.id],
  ),
  "pending",
);
await db.query(
  "update partner_interest_email_queue set next_attempt_at=now()-interval '1 minute' where id=$1",
  [claimed.id],
);
const retry = (
  await db.query("select * from claim_partner_interest_emails(1,$1)", [
    first.id,
  ])
).rows[0];
await call("finish_partner_interest_email", [
  retry.id,
  retry.claim_token,
  "sent",
]);
assert.equal(
  (
    await db.query("select * from claim_partner_interest_emails(1,$1)", [
      first.id,
    ])
  ).rows.length,
  0,
);
check(
  "Claims are exclusive, stale claims fail, retries retain one idempotency identity, and sent mail is never claimed again",
);
const held = await register("held@example.test", "b".repeat(64));
const h = (
  await db.query("select * from claim_partner_interest_emails(1,$1)", [held.id])
).rows[0];
await call("finish_partner_interest_email", [h.id, h.claim_token, "held"]);
assert.equal(
  (
    await db.query("select * from claim_partner_interest_emails(1,$1)", [
      held.id,
    ])
  ).rows.length,
  0,
);
check("Disallowed staging recipients remain held and do not spin or send");
const expired = await register("expiredmail@example.test", "c".repeat(64));
await db.query(
  "update partner_interest_email_queue set created_at=now()-interval '24 hours' where interest_id=$1",
  [expired.id],
);
assert.equal(
  (
    await db.query("select * from claim_partner_interest_emails(1,$1)", [
      expired.id,
    ])
  ).rows.length,
  0,
);
assert.equal(
  await value(
    "select status value from partner_interest_email_queue where interest_id=$1",
    [expired.id],
  ),
  "failed",
);
check(
  "Uncertain deliveries stop before Resend idempotency expires and remain visible for staff",
);
const admin = randomUUID(),
  profile = randomUUID();
await db.query(
  "insert into profiles(id,role,email) values($1,'admin','staff@example.test'),($2,'customer','protected@example.test')",
  [admin, profile],
);
const old = randomUUID(),
  recent = randomUUID(),
  registered = randomUUID(),
  caseProtected = randomUUID(),
  manualProtected = randomUUID();
for (const [id, email, age, reg] of [
  [old, "old@example.test", "13 months", false],
  [recent, "recent@example.test", "11 months", false],
  [registered, "registered@example.test", "13 months", true],
  [caseProtected, "protected@example.test", "13 months", false],
  [manualProtected, "manual@example.test", "13 months", false],
])
  await db.query(
    `insert into partner_interests(id,full_name,email,phone,description,created_at,consent_at,consent_wording,partner_registered_at) values($1,'Retention fixture',$2,'+442079460123','Other',now()-$3::interval,now()-$3::interval,$4,case when $5 then now()-interval '2 months' end)`,
    [id, email, age, consent, reg],
  );
await db.query(
  "insert into partner_interest_email_queue(interest_id) values($1)",
  [old],
);
await db.query("insert into account_incidents(reporter_id) values($1)", [
  profile,
]);
const hold = await call("admin_manage_retention_hold", [
  admin,
  null,
  "partner_interest",
  manualProtected,
  "Open Partner interest complaint",
]);
assert.ok(hold);
const dry = await call("run_data_retention", [true]);
assert.equal(dry.partner_interests, 1);
assert.equal(dry.held, 2);
assert.equal(
  await value("select count(*)::int value from partner_interests where id=$1", [
    old,
  ]),
  1,
);
check(
  "Preview logs the eligible interest but excludes registered Partners, recent interests, open linked incidents and explicit interest holds",
);
await db.exec("update data_retention_control set enabled=true");
const sweep = await call("run_data_retention", [false]);
assert.equal(sweep.partner_interests, 1);
assert.equal(sweep.failed, 0);
assert.equal(
  await value("select count(*)::int value from partner_interests where id=$1", [
    old,
  ]),
  0,
);
assert.equal(
  await value(
    "select count(*)::int value from partner_interest_email_queue where interest_id=$1",
    [old],
  ),
  0,
);
for (const id of [recent, registered, caseProtected, manualProtected])
  assert.equal(
    await value(
      "select count(*)::int value from partner_interests where id=$1",
      [id],
    ),
    1,
  );
assert.equal((await call("run_data_retention", [false])).completed, 0);
check(
  "Daily retention deletes expired unregistered interest plus its email metadata once; protected and registered rows survive; rerun deletes zero",
);
await call("admin_manage_retention_hold", [
  admin,
  hold,
  "",
  null,
  "The enquiry was resolved and closed",
]);
await db.query(
  "update account_incidents set status='resolved',reviewed_at=now() where reporter_id=$1",
  [profile],
);
const released = await call("run_data_retention", [false]);
assert.equal(released.partner_interests, 2);
assert.equal(released.failed, 0);
check(
  "Resolving the incident and explicit hold permits the next ordinary retention run",
);
await db.query(
  "update partner_interests set partner_registered_at=now() where id=$1",
  [recent],
);
await assert.rejects(
  db.query(
    "update partner_interests set partner_registered_at=null where id=$1",
    [recent],
  ),
  /immutable/,
);
check(
  "Future Partner registration uses the retention lock and cannot be erased to make it expire",
);
const audit = await value(
  "insert into partner_interest_export_audits(actor_id) values($1) returning id value",
  [admin],
);
await db.query(
  "update partner_interest_export_audits set row_count=0,completed_at=now() where id=$1",
  [audit],
);
await assert.rejects(
  db.query(
    "update partner_interest_export_audits set row_count=12 where id=$1",
    [audit],
  ),
  /immutable/,
);
check(
  "CSV access records keep the staff/time identity immutable and permit only one completion",
);
await db.exec("set role anon");
await assert.rejects(
  db.query("select * from partner_interests"),
  /permission denied/,
);
await assert.rejects(register("anonymous@example.test"), /permission denied/);
await db.exec("reset role");
await db.exec(
  "select set_config('test.mfa','false',false); set role authenticated",
);
assert.equal(
  await value("select count(*)::int value from partner_interests"),
  0,
);
await assert.rejects(
  register("authenticated@example.test"),
  /permission denied/,
);
await db.exec("reset role");
check(
  "Public and ordinary accounts cannot read interests or invoke trusted registration/delivery helpers",
);
console.log(JSON.stringify({ passed }));
await db.close();
