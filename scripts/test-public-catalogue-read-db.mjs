// Disposable offline database only; no real identities or network credentials.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
if (!process.env.PGLITE_MODULE) throw Error("Local PGLITE_MODULE required");
const { PGlite } = require(process.env.PGLITE_MODULE);
const db = new PGlite();
let checks = 0;
async function value(sql) { return Object.values((await db.query(sql)).rows[0])[0]; }
async function pass(label, work) { await work(); checks++; console.log(`PASS ${label}`); }
async function denied(sql, label) { await pass(label, () => assert.rejects(db.exec(sql))); }
async function actor(role, claims = {}) {
  await db.exec(`reset role;select set_config('request.jwt.claims','${JSON.stringify(claims)}',false);set role ${role};`);
}
const tables = ["packages", "service_areas", "faqs"];
try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;grant usage on schema auth,public to anon,authenticated,service_role;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create function is_admin() returns boolean language sql stable security definer set search_path=public as $$select coalesce(auth.jwt()->>'staff'='manager' and auth.jwt()->>'aal'='aal2' and auth.jwt()->>'totp'='verified',false)$$;
    revoke all on function is_admin() from public,anon;grant execute on function is_admin() to authenticated,service_role;
    create function account_is_active() returns boolean language sql stable as $$select coalesce(auth.jwt()->>'closed','false')<>'true'$$;
    create table packages(id text primary key,active boolean,price numeric);
    insert into packages values('TEST-active',true,18.99),('TEST-inactive',false,999);
    create table service_areas(id text primary key,active boolean,postcode_prefixes text[]);
    insert into service_areas values('TEST-active',true,array['E14']),('TEST-inactive',false,array['ZZ99']);
    create table faqs(id text primary key,published boolean,answer text);
    insert into faqs values('TEST-published',true,'TEST public answer'),('TEST-draft',false,'TEST private draft');
    create policy "anyone reads active packages" on packages for select to public using(active or is_admin());
    create policy "admin writes packages" on packages for all to public using(is_admin()) with check(is_admin());
    create policy "anyone reads active areas" on service_areas for select to public using(active or is_admin());
    create policy "admin writes areas" on service_areas for all to public using(is_admin()) with check(is_admin());
    create policy "public reads published faqs" on faqs for select to public using(published or is_admin());
    create policy "admins manage faqs" on faqs for all to authenticated using(is_admin()) with check(is_admin());
    create table private_records(id text);insert into private_records values('TEST private evidence');
    alter table private_records enable row level security;grant select on private_records to anon,authenticated;
    create policy private_staff_only on private_records for select to public using(is_admin());`);
  for (const table of tables) await db.exec(`alter table ${table} enable row level security;
    grant select,insert,update,delete on ${table} to anon,authenticated;
    create policy erased_accounts_have_no_access on ${table} as restrictive for all to authenticated using(account_is_active()) with check(account_is_active());`);
  const before = {
    helper: await value("select pg_get_functiondef('is_admin()'::regprocedure)||proacl::text from pg_proc where oid='is_admin()'::regprocedure"),
    grants: await value("select string_agg(relname||relacl::text,',' order by relname) from pg_class where relname in ('packages','service_areas','faqs','private_records')"),
    rows: await value("select md5((select jsonb_agg(t)::text from packages t)||(select jsonb_agg(t)::text from service_areas t)||(select jsonb_agg(t)::text from faqs t))"),
    privatePolicy: await value("select row_to_json(p)::text from pg_policies p where tablename='private_records'"),
  };
  await actor("anon");
  for (const table of tables) await denied(`select * from ${table}`, `reproduces anonymous ${table} helper error`);
  await db.exec("reset role");
  await db.exec(readFileSync("supabase/migrations/20261105134601_public_catalogue_read_scope.sql", "utf8"));
  await pass("staff helper definition and ACL unchanged", async () => assert.equal(await value("select pg_get_functiondef('is_admin()'::regprocedure)||proacl::text from pg_proc where oid='is_admin()'::regprocedure"), before.helper));
  await pass("table grants unchanged", async () => assert.equal(await value("select string_agg(relname||relacl::text,',' order by relname) from pg_class where relname in ('packages','service_areas','faqs','private_records')"), before.grants));
  await pass("no catalogue rows or prices changed", async () => assert.equal(await value("select md5((select jsonb_agg(t)::text from packages t)||(select jsonb_agg(t)::text from service_areas t)||(select jsonb_agg(t)::text from faqs t))"), before.rows));
  await pass("private record policy unchanged", async () => assert.equal(await value("select row_to_json(p)::text from pg_policies p where tablename='private_records'"), before.privatePolicy));
  await actor("anon");
  for (const table of tables) await pass(`anonymous ${table} returns only its public row`, async () => assert.equal(await value(`select count(*)::int from ${table}`), 1));
  await pass("inactive services cannot be requested directly", async () => assert.equal(await value("select count(*)::int from packages where not active"), 0));
  await pass("inactive coverage cannot be requested directly", async () => assert.equal(await value("select count(*)::int from service_areas where not active"), 0));
  await pass("unpublished FAQ cannot be requested directly", async () => assert.equal(await value("select count(*)::int from faqs where not published"), 0));
  await pass("public booking prices remain readable", async () => assert.equal(Number(await value("select price from packages")), 18.99));
  await denied("select is_admin()", "anonymous staff helper still denied");
  await denied("select * from private_records", "private evidence still inaccessible anonymously");
  for (const table of tables) {
    await pass(`anonymous ${table} updates cannot alter records`, async () => assert.equal((await db.query(`update ${table} set id=id returning id`)).rows.length, 0));
    await pass(`anonymous ${table} deletes cannot remove records`, async () => assert.equal((await db.query(`delete from ${table} returning id`)).rows.length, 0));
  }
  await denied("insert into packages values('TEST-forged',true,0)", "anonymous service creation denied");
  await denied("insert into service_areas values('TEST-forged',true,array['ZZ99'])", "anonymous coverage creation denied");
  await denied("insert into faqs values('TEST-forged',true,'TEST forged')", "anonymous FAQ publication denied");
  for (const claims of [{}, { staff: "manager", aal: "aal1", totp: "verified" }, { staff: "manager", aal: "aal2" }, { staff: "onboarding", aal: "aal2", totp: "verified" }, { staff: "developer", aal: "aal2", totp: "verified" }]) {
    await actor("authenticated", claims);
    await pass(`non-Manager/MFA session cannot read inactive/draft rows (${JSON.stringify(claims)})`, async () => {
      for (const table of tables) assert.equal(await value(`select count(*)::int from ${table}`), 1);
      assert.equal(await value("select count(*)::int from private_records"), 0);
      assert.equal((await db.query("update faqs set answer='TEST forbidden' returning id")).rows.length, 0);
    });
  }
  await actor("authenticated", { staff: "manager", aal: "aal2", totp: "verified" });
  await pass("MFA Manager retains catalogue editing and unpublished access", async () => {
    for (const table of tables) assert.equal(await value(`select count(*)::int from ${table}`), 2);
    assert.equal((await db.query("update faqs set answer='TEST Manager edit' returning id")).rows.length, 2);
  });
  await actor("authenticated", { closed: true });
  await pass("closed-account restrictions preserved", async () => {
    for (const table of tables) assert.equal(await value(`select count(*)::int from ${table}`), 0);
  });
  console.log(`${checks} offline public-catalogue policy checks passed.`);
} finally { await db.close(); }
