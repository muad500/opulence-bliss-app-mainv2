// Isolated PostgreSQL proof: synthetic data, no network or credentials.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const { PGlite } = await import(
  pathToFileURL(process.env.RETENTION_PGLITE_MODULE).href
);
const fixture = readFileSync("scripts/test-data-retention-database.mjs", "utf8")
  .split("await db.exec(`")[1]
  .split("`);")[0];
const activation = readFileSync(
  "supabase/production/data-retention-approved-activation.sql",
  "utf8",
);
const migrations = [
  "20261026000100_automatic_data_retention.sql",
  "20261026000200_retention_incomplete_applications.sql",
  "20261026000300_retention_storage_and_contract_boundaries.sql",
  "20261026000400_retention_dbs_metadata_completion.sql",
];
const db = new PGlite();
await db.exec(fixture);
for (const name of migrations)
  await db.exec(readFileSync(`supabase/migrations/${name}`, "utf8"));
await db.exec(`
  alter table profiles add column email text;
  create schema vault; create schema net; create schema cron;
  create table vault.secrets(name text, decrypted_secret text);
  create view vault.decrypted_secrets as select * from vault.secrets;
  insert into vault.secrets values('opulence_cron_secret','synthetic-only');
  create table net.requests(id bigint generated always as identity, url text);
  create function net.http_get(url text,headers jsonb,timeout_milliseconds integer)
  returns bigint language plpgsql as $$declare request_id bigint; begin
    insert into net.requests(url) values($1) returning id into request_id;
    return request_id; end $$;
  create table cron.job(jobname text, schedule text, active boolean);
  insert into cron.job values('opulence-production-data-retention','15 3 * * *',true);
  update data_retention_control
    set storage_origin='https://uiqcsihgqaktpjumyeap.supabase.co';
  insert into profiles(id,email,role)
    values(gen_random_uuid(),'syedmouad+admin@gmail.com','admin');
  do $$declare customer uuid; booking uuid; i integer; begin
    for i in 1..9 loop
      customer:=gen_random_uuid(); booking:=gen_random_uuid();
      insert into profiles(id) values(customer);
      insert into bookings(id,customer_id,status,scheduled_at,retention_ended_at,
        access_instructions,household_notes)
      values(booking,customer,case when i=9 then 'confirmed' else 'completed' end,
        case when i=9 then now()+interval '1 week' else now()-interval '1 day' end,
        case when i=9 then null else now()-interval '1 day' end,
        'synthetic access','synthetic notes');
      if i=8 then
        insert into review_cases(booking_id) values(booking);
      end if;
    end loop;
  end $$;
`);
// A changed scope must roll back the control and all deletion.
await assert.rejects(
  db.exec(activation.replace(/<>7\b/g, "<>8")),
  /Approved 7-record scope changed/,
);
await db.exec("rollback;");
assert.equal(
  (await db.query("select enabled from data_retention_control")).rows[0]
    .enabled,
  false,
);
assert.equal(
  (
    await db.query(
      "select count(*)::int n from bookings where access_instructions is not null",
    )
  ).rows[0].n,
  9,
);
console.log(
  "PASS changed scope rolls back without deleting or enabling anything",
);
const results = await db.exec(activation);
const proof = results.at(-1).rows[0].committed_verification;
assert.equal(proof.enabled, true);
assert.equal(proof.eligible_remaining, 0);
assert.equal(proof.real_runs[0].summary.completed, 7);
assert.equal(proof.real_runs[1].summary.completed, 0);
assert.equal(proof.real_runs[0].summary.verified_active_bookings_unchanged, 1);
assert.equal(
  proof.real_runs[0].summary.verified_protected_bookings_unchanged,
  1,
);
assert.equal(proof.real_runs[0].summary.verified_future_bookings_unchanged, 1);
for (const value of Object.values(proof.real_runs[0].summary))
  assert.equal(typeof value, "number");
console.log(
  "PASS exact seven cleared, held/active/future unchanged, second run zero, numeric admin log",
);
await db.query("select invoke_production_data_retention()");
assert.equal(
  (await db.query("select url from net.requests order by id desc limit 1"))
    .rows[0].url,
  "https://www.opulencebliss.com/api/cron/data-retention",
);
await db.exec("update data_retention_control set enabled=false");
await db.query("select invoke_production_data_retention()");
assert.match(
  (await db.query("select url from net.requests order by id desc limit 1"))
    .rows[0].url,
  /\?dry=1$/,
);
console.log(
  "PASS scheduler follows control and reverts to preview when disabled",
);
await db.exec(
  "update data_retention_control set storage_origin='https://comwdjprdedmsnxtvuuk.supabase.co'",
);
await assert.rejects(db.query("select invoke_production_data_retention()"));
for (const role of ["anon", "authenticated", "service_role"])
  assert.equal(
    (
      await db.query(
        "select has_function_privilege($1,'public.invoke_production_data_retention()','execute') allowed",
        [role],
      )
    ).rows[0].allowed,
    false,
  );
console.log(
  "PASS wrong project fails closed and public API roles cannot invoke scheduler",
);
await db.close();
