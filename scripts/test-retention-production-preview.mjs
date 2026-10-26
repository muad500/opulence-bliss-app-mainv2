// Isolated PostgreSQL only. No network, credentials, or linked database.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const { PGlite } = await import(
  pathToFileURL(process.env.RETENTION_PGLITE_MODULE).href
);
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema vault; create schema net; create schema cron;
create schema supabase_migrations;
create table vault.secrets(name text,decrypted_secret text);
create view vault.decrypted_secrets as select * from vault.secrets;
insert into vault.secrets values('opulence_cron_secret','synthetic-credential-only');
create table supabase_migrations.schema_migrations(version text);
insert into supabase_migrations.schema_migrations values
 ('20261026000100'),('20261026000200'),('20261026000300'),('20261026000400');
create table data_retention_control(id boolean primary key,enabled boolean,storage_origin text);
insert into data_retention_control values(true,false,null);
create table net.requests(id bigint generated always as identity,url text,headers jsonb,timeout_ms integer);
create function net.http_get(url text,headers jsonb,timeout_milliseconds integer)
returns bigint language plpgsql as $$declare request_id bigint; begin
  insert into net.requests(url,headers,timeout_ms) values($1,$2,$3) returning id into request_id;
  return request_id; end $$;
create table cron.job(jobid bigint generated always as identity,jobname text,schedule text,command text,active boolean default true);
create function cron.schedule(text,text,text) returns bigint language plpgsql as $$declare job_id bigint; begin
  insert into cron.job(jobname,schedule,command) values($1,$2,$3) returning jobid into job_id;
  return job_id; end $$;
create function cron.unschedule(bigint) returns void language sql as $$delete from cron.job where jobid=$1$$;
create function cron.alter_job(job_id bigint,active boolean) returns void language sql as $$update cron.job set active=$2 where jobid=$1$$;
`);
// PGlite has no Supabase http extension. Only omit extension installation;
// run the exact invocation function, guards, schedule and permission clauses.
const sql = readFileSync(
  "supabase/production/data-retention-schedule.sql",
  "utf8",
).replace("create extension if not exists http with schema extensions;", "");
await db.exec(sql);
let result = (await db.query("select * from cron.job")).rows[0];
assert.equal(result.active, false);
assert.equal(result.schedule, "15 3 * * *");
assert.match(result.command, /invoke_production_data_retention/);
assert.equal(
  (await db.query("select enabled from data_retention_control")).rows[0]
    .enabled,
  false,
);
console.log(
  "PASS Production installer leaves deletion disabled and schedule inactive",
);
await db.query("select public.invoke_production_data_retention()");
result = (await db.query("select * from net.requests")).rows[0];
assert.equal(
  result.url,
  "https://www.opulencebliss.com/api/cron/data-retention?dry=1",
);
assert.equal(result.timeout_ms, 55000);
assert.equal(
  (await db.query("select enabled from data_retention_control")).rows[0]
    .enabled,
  false,
);
console.log(
  "PASS Production invocation always requests preview without enabling deletion",
);
await db.query("update data_retention_control set enabled=true");
await assert.rejects(
  db.query("select public.invoke_production_data_retention()"),
  /requires deletion disabled/,
);
assert.equal(
  (await db.query("select count(*)::int total from net.requests")).rows[0]
    .total,
  1,
);
console.log(
  "PASS accidental deletion enablement stops preview invocation before any request",
);
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
  "PASS public, customer and service API roles cannot invoke the private scheduler",
);
await db.close();
