// Offline, fictional policies and identities only; no network credentials.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
if (!process.env.PGLITE_MODULE) throw Error("Local PGLITE_MODULE required.");
const { PGlite } = require(process.env.PGLITE_MODULE);
const db = new PGlite();
let checks = 0;
const provider = "00000000-0000-4000-8000-000000000001";
async function actor(role, claims = {}) {
  await db.exec(
    `reset role;select set_config('request.jwt.claims','${JSON.stringify(claims)}',false);set role ${role};`,
  );
}
async function value(sql) {
  return Object.values((await db.query(sql)).rows[0])[0];
}
async function pass(label, fn) {
  await fn();
  checks++;
  console.log(`PASS ${label}`);
}
async function denied(sql, label) {
  await pass(label, () => assert.rejects(db.exec(sql)));
}
try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;grant usage on schema auth,public to anon,authenticated,service_role;
    create function auth.uid() returns uuid language sql stable as $$select (current_setting('request.jwt.claims',true)::jsonb->>'sub')::uuid$$;
    create function is_admin() returns boolean language sql stable security definer as $$select coalesce(
      current_setting('request.jwt.claims',true)::jsonb->>'staff'='manager' and current_setting('request.jwt.claims',true)::jsonb->>'aal'='aal2',false)$$;
    revoke all on function is_admin() from public,anon;grant execute on function is_admin() to authenticated,service_role;
    create function account_is_active() returns boolean language sql stable as $$select coalesce(current_setting('request.jwt.claims',true)::jsonb->>'closed','false')<>'true'$$;
    create table providers(id uuid,profile_id uuid);insert into providers values('${provider}','${provider}');
    alter table providers enable row level security;create policy own_provider on providers for select to authenticated using(profile_id=auth.uid());
    grant select on providers to authenticated;
    create table legal_documents(slug text primary key,published boolean,audience text,content_html text);
    insert into legal_documents values('TEST-public-customer',true,'customers','TEST public customer text'),('TEST-public-everyone',true,'everyone','TEST public text'),
      ('TEST-professional',true,'professionals','TEST restricted text'),('TEST-unpublished',false,'customers','TEST draft'),('TEST-private-draft',false,'professionals','TEST restricted draft');
    alter table legal_documents enable row level security;grant select on legal_documents to anon,authenticated,service_role;
    create policy "published legal documents are public" on legal_documents for select to anon,authenticated using(is_admin() or (published and (audience<>'professionals' or exists(select 1 from providers p where p.profile_id=auth.uid()))));
    create policy erased_accounts_have_no_access on legal_documents as restrictive for all to authenticated using(account_is_active());
    create policy "admins update legal documents" on legal_documents for update to authenticated using(is_admin());`);
  const before = {
    content: await value(
      "select md5(string_agg(row_to_json(t)::text,',' order by slug)) from legal_documents t",
    ),
    staff: await value("select pg_get_functiondef('is_admin()'::regprocedure)"),
    providers: await value(
      "select md5(string_agg(row_to_json(t)::text,',' order by policyname)) from pg_policies t where tablename='providers'",
    ),
  };
  await actor("anon");
  await denied(
    "select slug from legal_documents where published",
    "reproduces public policy read failing after staff-helper lockdown",
  );
  await db.exec("reset role");
  await db.exec(
    readFileSync(
      "supabase/migrations/20261105010000_anonymous_published_legal_read.sql",
      "utf8",
    ),
  );
  await actor("anon");
  await pass(
    "anonymous visitors can read only published customer/everyone policies",
    async () =>
      assert.deepEqual(
        (
          await db.query("select slug from legal_documents order by slug")
        ).rows.map((r) => r.slug),
        ["TEST-public-customer", "TEST-public-everyone"],
      ),
  );
  await denied(
    "select is_admin()",
    "anonymous visitors still cannot execute staff permission helpers",
  );
  await denied(
    "select * from providers",
    "anonymous visitors gain no private-provider access",
  );
  await denied(
    "insert into legal_documents values('TEST-forged',true,'customers','TEST')",
    "anonymous visitors cannot publish policies",
  );
  await denied(
    "update legal_documents set published=true",
    "anonymous visitors cannot edit policies",
  );
  await actor("authenticated");
  await pass(
    "ordinary signed-in customer does not gain drafts or professional-only documents",
    async () =>
      assert.equal(await value("select count(*)::int from legal_documents"), 2),
  );
  await actor("authenticated", { sub: provider });
  await pass(
    "professional retains access to published professional documents",
    async () =>
      assert.equal(await value("select count(*)::int from legal_documents"), 3),
  );
  await actor("authenticated", { staff: "manager", aal: "aal1" });
  await pass("Manager without MFA does not gain access to drafts", async () =>
    assert.equal(await value("select count(*)::int from legal_documents"), 2),
  );
  await actor("authenticated", { staff: "manager", aal: "aal2" });
  await pass("Manager with MFA retains legal-editor draft access", async () =>
    assert.equal(await value("select count(*)::int from legal_documents"), 5),
  );
  await actor("authenticated", { sub: provider, closed: true });
  await pass("closed-account restrictive policy is preserved", async () =>
    assert.equal(await value("select count(*)::int from legal_documents"), 0),
  );
  await db.exec("reset role");
  await pass("legal wording and publication flags are unchanged", async () =>
    assert.equal(
      await value(
        "select md5(string_agg(row_to_json(t)::text,',' order by slug)) from legal_documents t",
      ),
      before.content,
    ),
  );
  await pass("staff helper definition is unchanged", async () =>
    assert.equal(
      await value("select pg_get_functiondef('is_admin()'::regprocedure)"),
      before.staff,
    ),
  );
  await pass("provider policies are unchanged", async () =>
    assert.equal(
      await value(
        "select md5(string_agg(row_to_json(t)::text,',' order by policyname)) from pg_policies t where tablename='providers'",
      ),
      before.providers,
    ),
  );
  console.log(`${checks} offline public-policy checks passed.`);
} finally {
  await db.close();
}
