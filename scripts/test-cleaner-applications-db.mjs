// Offline-only pre-account application records. All identities are fictional.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
if (!process.env.PGLITE_MODULE)
  throw Error("Local PGLITE_MODULE required; no remote database is supported.");
const { PGlite } = require(process.env.PGLITE_MODULE);
const db = new PGlite();
let checks = 0;
const staff = "00000000-0000-4000-8000-000000000001";
async function check(sql, value, label) {
  assert.deepEqual(
    Object.values((await db.query(sql)).rows[0])[0],
    value,
    label,
  );
  checks++;
  console.log(`PASS ${label}`);
}
async function denied(sql, label) {
  await assert.rejects(db.exec(sql));
  checks++;
  console.log(`PASS ${label}`);
}
async function actor(role, user = null, aal = "aal1") {
  await db.exec(
    `reset role;select set_config('request.jwt.claims','${JSON.stringify({ sub: user, aal })}',false);set role ${role};`,
  );
}
const insert = `insert into cleaner_applications(full_name,email,phone,postcode,areas,experience,availability,right_to_work_type,checks_acknowledged,declaration_text,declaration_source,privacy_version)
  values('TEST Applicant Only','test-cleaner@example.invalid','+447700900001','SW1A1AA',array['TEST area'],'TEST fictional experience','TEST mornings','TEST fictional permission',true,'[Onboarding Process 3.1A – wording to be supplied]','Onboarding Process 3.1A','TEST-1')`;
try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;grant usage on schema public,auth to anon,authenticated,service_role;
    create table auth.users(id uuid primary key);create table providers(id uuid primary key);
    create function can_review_professional() returns boolean language sql stable as $$select
      current_setting('request.jwt.claims',true)::jsonb->>'sub'='${staff}' and current_setting('request.jwt.claims',true)::jsonb->>'aal'='aal2'$$;`);
  await db.exec(
    readFileSync(
      "supabase/migrations/20261105020000_cleaner_application_records.sql",
      "utf8",
    ),
  );
  await actor("anon");
  await denied(
    insert,
    "anonymous clients cannot bypass the validated application endpoint",
  );
  await actor("authenticated", staff, "aal2");
  await denied(
    insert,
    "staff cannot bypass application creation validation with direct table writes",
  );
  await actor("service_role");
  await denied(
    insert.replace(",true,", ",false,"),
    "checks declaration cannot be omitted in the database",
  );
  await db.exec(insert);
  await check(
    "select status from cleaner_applications limit 1",
    "applied",
    "onboarding test 2: application is a record with Applied status",
  );
  await check(
    "select declaration_pending from cleaner_applications limit 1",
    true,
    "placeholder declaration remains explicitly pending",
  );
  await check(
    "select status from cleaner_application_communications limit 1",
    "awaiting_wording",
    "missing email wording is held, not sent as final copy",
  );
  await check(
    "select count(*)::int from cleaner_application_communications",
    1,
    "application automatically queues exactly one held confirmation",
  );
  await db.exec("reset role");
  await check(
    "select count(*)::int from auth.users",
    0,
    "onboarding test 3: application creates no authentication login",
  );
  await check(
    "select count(*)::int from providers",
    0,
    "application creates no provider account or booking eligibility",
  );
  await actor("authenticated", "00000000-0000-4000-8000-000000000002");
  await check(
    "select count(*)::int from cleaner_applications",
    0,
    "unrelated account cannot read applicant details",
  );
  await actor("authenticated", staff);
  await check(
    "select count(*)::int from cleaner_applications",
    0,
    "staff without MFA cannot read applicant details",
  );
  await actor("authenticated", staff, "aal2");
  await check(
    "select count(*)::int from cleaner_applications",
    1,
    "authorised MFA onboarding staff can read the application",
  );
  await denied(
    "update cleaner_applications set status='active'",
    "staff cannot directly activate an application",
  );
  console.log(
    `${checks} offline application checks passed; no login, approval or email created.`,
  );
} finally {
  await db.close();
}
