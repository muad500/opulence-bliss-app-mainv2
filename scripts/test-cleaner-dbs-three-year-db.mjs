import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
if (!process.env.PGLITE_MODULE) throw Error("Local PGLITE_MODULE required.");
const { PGlite } = require(process.env.PGLITE_MODULE);
const db = new PGlite();
const source = readFileSync(
  "supabase/migrations/20261003001500_verification_renewals.sql",
  "utf8",
);
function original(name, replacement = name) {
  const start = source.indexOf(`create or replace function public.${name}(`);
  const end = source.indexOf("$fn$;", start);
  if (start < 0 || end < 0)
    throw Error("Expected verification source missing.");
  return source
    .slice(start, end + 5)
    .replace(`public.${name}(`, `public.${replacement}(`);
}
const id = "00000000-0000-4000-8000-000000000001";
let count = 0;
async function check(name, work) {
  await work();
  console.log(`PASS ${name}`);
  count++;
}
async function value(sql, args = []) {
  return Object.values((await db.query(sql, args)).rows[0])[0];
}
try {
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create table providers(id uuid primary key,profile_id uuid,dbs_verified boolean default true);
    create table profiles(id uuid primary key,role text);
    create table provider_dbs_checks(provider_id uuid primary key,status text,issue_date date);
    create table provider_verification_items(provider_id uuid,document_type text,status text,
      gov_uk_checked_on date,uploaded_at timestamptz,document_storage_path text,reference text,
      expires_at date,next_check_at date);
    create table verification_renewal_reminders(provider_id uuid,check_type text,due_date date,phase text,recipient_id uuid,
      primary key(provider_id,check_type,due_date,phase,recipient_id));
    create table notifications(user_id uuid,title text,body text,href text);`);
  await db.exec(
    original(
      "professional_verification_block",
      "professional_verification_block_before_client_documents",
    ),
  );
  await db.exec(original("validate_renewed_verification"));
  await db.exec(
    original(
      "process_verification_renewals",
      "process_verification_renewals_before_channels",
    ),
  );
  await db.exec(
    readFileSync(
      "supabase/migrations/20261105134128_cleaner_dbs_three_year_renewal.sql",
      "utf8",
    ),
  );
  await db.query("insert into providers(id,profile_id) values($1,$1)", [id]);
  await db.query("insert into profiles values($1,'provider')", [id]);
  await db.query(
    "insert into provider_dbs_checks values($1,'verified',current_date-interval '2 years')",
    [id],
  );
  await db.query(
    "insert into provider_verification_items values($1,'right_to_work','verified',current_date,now(),null,'TESTCODE1',null,null)",
    [id],
  );
  await check("a two-year-old DBS remains current", async () =>
    assert.equal(
      await value(
        "select professional_verification_block_before_client_documents($1)",
        [id],
      ),
      null,
    ),
  );
  await check(
    "scheduler does not pause a two-year-old verified check",
    async () => {
      assert.equal(
        await value("select process_verification_renewals_before_channels()"),
        0,
      );
      assert.equal(await value("select dbs_verified from providers"), true);
    },
  );
  await db.exec(
    "create trigger validate_dbs before update of issue_date,status on provider_dbs_checks for each row execute function validate_renewed_verification()",
  );
  await check("verification accepts a certificate inside three years", () =>
    db.exec(
      "update provider_dbs_checks set issue_date=current_date-interval '2 years'",
    ),
  );
  await check("verification rejects an older certificate", () =>
    assert.rejects(() =>
      db.exec(
        "update provider_dbs_checks set issue_date=current_date-interval '3 years 1 day'",
      ),
    ),
  );
  await db.exec(
    "drop trigger validate_dbs on provider_dbs_checks;update provider_dbs_checks set issue_date=current_date-interval '3 years 1 day'",
  );
  await check("offers block after the three-year date", async () =>
    assert.match(
      await value(
        "select professional_verification_block_before_client_documents($1)",
        [id],
      ),
      /three-year/,
    ),
  );
  await check(
    "renewal scheduler uses the new date and current wording",
    async () => {
      assert.equal(
        await value("select process_verification_renewals_before_channels()"),
        1,
      );
      assert.equal(await value("select dbs_verified from providers"), false);
      assert.equal(
        await value("select title from notifications"),
        "Three-year DBS re-check",
      );
      assert.equal(
        await value("select process_verification_renewals_before_channels()"),
        0,
      );
    },
  );
  await db.exec(
    "update provider_dbs_checks set issue_date=current_date;update provider_verification_items set expires_at=current_date-1",
  );
  await check("right-to-work expiry is unchanged", async () =>
    assert.match(
      await value(
        "select professional_verification_block_before_client_documents($1)",
        [id],
      ),
      /right-to-work check has expired/,
    ),
  );
  console.log(
    `${count} isolated three-year DBS checks passed; no real checks or approvals changed.`,
  );
} catch (error) {
  console.error(error.message);
  if (error.where) console.error(error.where);
  process.exitCode = 1;
} finally {
  await db.close();
}
