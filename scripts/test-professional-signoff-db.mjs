// Offline PostgreSQL only. The production approval implementation remains
// wrapped, not replaced; this fixture models its existing evidence checks.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
if (!process.env.PGLITE_MODULE)
  throw Error("Local PGLITE_MODULE required; no network database is accepted");
const { PGlite } = require(process.env.PGLITE_MODULE);
const db = new PGlite();
let checks = 0;
const ids = {
  a: "00000000-0000-4000-8000-000000000001",
  b: "00000000-0000-4000-8000-000000000002",
  c: "00000000-0000-4000-8000-000000000003",
  pro: "00000000-0000-4000-8000-000000000004",
  provider: "00000000-0000-4000-8000-000000000005",
};
const sql = (text) => db.exec(text);
async function actor(id, aal = "aal2") {
  await sql(
    `reset role; select set_config('request.jwt.claims','${JSON.stringify({ sub: id, role: "authenticated", aal })}',false); set role authenticated`,
  );
}
async function eq(query, expected, label) {
  assert.deepEqual(
    Object.values((await db.query(query)).rows[0])[0],
    expected,
    label,
  );
  checks++;
  console.log(`PASS ${label}`);
}
async function denied(query, pattern, label) {
  await assert.rejects(sql(query), pattern, label);
  checks++;
  console.log(`PASS ${label}`);
}
const approve = `select review_professional_service('${ids.provider}','cleaning','approved','TEST ONLY - reviewed fictional evidence')`;
try {
  await sql(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage; grant usage on schema public,auth,storage to authenticated,anon,service_role;
    create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
    create table profiles(id uuid primary key, role text);
    create function is_admin() returns boolean language sql stable security definer set search_path=public as $$select auth.jwt()->>'aal'='aal2' and exists(select 1 from profiles where id=auth.uid() and role='admin')$$;
    create table providers(id uuid primary key,profile_id uuid,services text[],service_approvals jsonb,vetting_status text default 'pending',is_suspended boolean default false);
    create table provider_dbs_checks(provider_id uuid primary key,status text,reviewed_by uuid,issue_date date);
    create table provider_verification_items(provider_id uuid,document_type text,status text,reviewed_by uuid,uploaded_at timestamptz,expires_at date,document_storage_path text);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,updated_at timestamptz default now());
    create function professional_verification_block(uuid) returns text language sql as $$select case when not exists(select 1 from provider_dbs_checks where provider_id=$1 and status='verified') then 'DBS needs verification' end$$;
    create function review_professional_service(p_provider uuid,p_service text,p_status text,p_reason text default null) returns void language plpgsql security definer set search_path=public as $$begin
      if not is_admin() then raise exception 'Admins only'; end if;
      update providers set vetting_status=case when p_status='approved' then 'approved' else vetting_status end where id=p_provider;
      update providers set service_approvals=service_approvals||jsonb_build_object(p_service,p_status) where id=p_provider;
    end$$;
    grant select,update on providers to authenticated;
    insert into profiles values('${ids.a}','admin'),('${ids.b}','admin'),('${ids.c}','admin'),('${ids.pro}','provider');
    insert into providers values('${ids.provider}','${ids.pro}',array['cleaning'],'{"cleaning":"pending"}');
    insert into provider_dbs_checks values('${ids.provider}','verified','${ids.a}',current_date);
    insert into provider_verification_items values('${ids.provider}','photo_id','verified','${ids.a}',now(),null,'test/photo.pdf');
    insert into storage.objects(bucket_id,name) values('provider-verification','test/photo.pdf');
  `);
  await sql(
    readFileSync(
      "supabase/migrations/20261103153510_professional_second_signoff.sql",
      "utf8",
    ),
  );
  await actor(ids.a, "aal1");
  await denied(
    approve,
    /Authenticator staff/,
    "password-only staff cannot review",
  );
  await actor(ids.pro);
  await denied(
    approve,
    /Authenticator staff/,
    "professional cannot approve themselves",
  );
  await actor(ids.a);
  await denied(
    `update providers set service_approvals='{"cleaning":"approved"}' where id='${ids.provider}'`,
    /Independent second sign-off/,
    "direct table activation cannot bypass sign-off",
  );
  await denied(
    `select review_professional_service_before_two_person('${ids.provider}','cleaning','approved','bypass')`,
    /permission denied/,
    "legacy approval entry point is not callable",
  );
  await denied(
    `select review_professional_service('${ids.provider}','cleaning','approved','short')`,
    /at least 10/,
    "each review needs a meaningful reason",
  );
  await sql(approve);
  await eq(
    `select vetting_status from providers where id='${ids.provider}'`,
    "pending",
    "first review does not activate the account",
  );
  await eq(
    `select professional_approval_review_state('${ids.provider}','cleaning')->>'canReview'`,
    "false",
    "first reviewer sees second sign-off disabled",
  );
  await denied(
    approve,
    /different staff member/,
    "same person cannot sign off twice",
  );
  await denied(
    `update professional_approval_reviews set second_reviewer='${ids.a}'`,
    /permission denied/,
    "staff cannot forge review rows",
  );
  await actor(ids.b);
  await eq(
    `select professional_approval_review_state('${ids.provider}','cleaning')->>'phase'`,
    "second",
    "independent reviewer sees second step",
  );
  await sql(
    `reset role; update provider_verification_items set reviewed_by='${ids.b}' where provider_id='${ids.provider}';`,
  );
  await actor(ids.a);
  await eq(
    `select professional_approval_review_state('${ids.provider}','cleaning')->>'phase'`,
    "first",
    "changed evidence invalidates the previous first review",
  );
  await sql(approve);
  await actor(ids.b);
  await denied(
    approve,
    /did not check the documents/,
    "another document checker cannot give independent sign-off",
  );
  await actor(ids.c);
  await sql(approve);
  await eq(
    `select vetting_status from providers where id='${ids.provider}'`,
    "approved",
    "independent MFA staff activates through existing approval implementation",
  );
  await eq(
    `select service_approvals->>'cleaning' from providers where id='${ids.provider}'`,
    "approved",
    "service approval is saved",
  );
  await eq(
    `select count(*)::integer from professional_approval_audit`,
    4,
    "both reviews and stale evidence invalidation are audited",
  );
  await denied(approve, /Only pending/, "repeat activation is rejected");
  await sql(
    `select review_professional_service('${ids.provider}','cleaning','suspended','TEST ONLY - end of test')`,
  );
  await eq(
    `select count(*)::integer from professional_approval_reviews`,
    0,
    "suspension clears the old approval state",
  );
  await sql(
    `select review_professional_service('${ids.provider}','cleaning','pending','TEST ONLY - reopen')`,
  );
  await sql(`reset role; update provider_dbs_checks set status='failed'`);
  await actor(ids.a);
  await denied(
    approve,
    /DBS needs verification/,
    "existing verification checks remain enforced before first review",
  );
  await actor(ids.pro);
  await eq(
    `select count(*)::integer from professional_approval_audit`,
    0,
    "private review audit is hidden from professionals",
  );
  await sql(
    `reset role; update profiles set role='admin' where id='${ids.pro}';`,
  );
  await actor(ids.pro);
  await denied(
    approve,
    /own account/,
    "even staff cannot review their own professional application",
  );
  console.log(
    `${checks} independent sign-off checks passed. No remote database contacted.`,
  );
} finally {
  await db.close();
}
