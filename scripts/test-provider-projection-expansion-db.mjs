// Offline only. This checks additive rollout support, NOT closed legacy access.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
if (!process.env.PGLITE_MODULE)
  throw Error(
    "Supply a local PGLITE_MODULE; remote databases are not supported.",
  );
const { PGlite } = require(process.env.PGLITE_MODULE);
const db = new PGlite();
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let checks = 0;
async function check(query, expected, label) {
  assert.deepEqual(
    Object.values((await db.query(query)).rows[0])[0],
    expected,
    label,
  );
  checks++;
  console.log(`PASS ${label}`);
}
async function actor(user, role = "authenticated") {
  await db.exec(
    `reset role; select set_config('request.jwt.claims','${JSON.stringify({ sub: user, role })}',false); set role ${role};`,
  );
}
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; grant usage on schema auth,public to anon,authenticated,service_role;
    create function auth.uid() returns uuid language sql stable as $$select (current_setting('request.jwt.claims',true)::jsonb->>'sub')::uuid$$;
    create function can_review_professional() returns boolean language sql stable as $$select false$$;
    create function account_is_active() returns boolean language sql stable as $$select auth.uid() is not null$$;
    create table providers(id uuid primary key,profile_id uuid,display_name text,customer_first_name text,photo_url text,
      public_rating_avg numeric,public_rating_count int,bio text,years_experience int,services text[],vetting_status text,
      dbs_verified boolean,is_suspended boolean,show_on_our_pros boolean,stripe_account_id text);
    create table bookings(id uuid primary key,provider_id uuid references providers,customer_id uuid);
    create table customer_favourite_providers(provider_id uuid,user_id uuid);
    alter table providers enable row level security;
    create policy legacy_read on providers for select using(true);
    grant select on providers,bookings to anon,authenticated,service_role;
    grant select on customer_favourite_providers to service_role;
    create function public_eligible_provider_ids() returns table(id uuid) language sql stable security definer set search_path=public
      as $$select p.id from providers p where show_on_our_pros and dbs_verified and not is_suspended$$;
    insert into providers values('${id(11)}','${id(1)}','TEST Public Surname','TEST',null,4.5,2,'TEST stored biography',3,array['cleaning'],'approved',true,false,true,'acct_TEST_PRIVATE');
    insert into providers values('${id(12)}','${id(2)}','TEST Assigned Surname','TEST',null,4.2,1,null,2,array['cleaning'],'approved',true,false,false,'acct_TEST_PRIVATE_2');
    insert into bookings values('${id(20)}','${id(12)}','${id(4)}');`);
  await db.exec(
    readFileSync(
      "supabase/migrations/20261104210000_private_provider_customer_projection.sql",
      "utf8",
    ),
  );
  await actor(null, "anon");
  await check(
    "select count(*)::int from customer_provider_cards",
    1,
    "anonymous directory uses the safe projection",
  );
  await check(
    "select customer_first_name from customer_provider_cards limit 1",
    "TEST",
    "projection returns the first name",
  );
  await check(
    "select bio is null and years_experience is null and cardinality(services)=0 from customer_provider_cards limit 1",
    true,
    "stored biographical fields are not disclosed",
  );
  await assert.rejects(
    db.exec(
      "select display_name,stripe_account_id from customer_provider_cards",
    ),
  );
  checks++;
  await actor(id(4));
  await assert.rejects(db.exec("select * from customer_favourite_providers"));
  checks++;
  console.log(
    "PASS private favourite table stays server-only while customer projection works",
  );
  await check(
    "select count(*)::int from customer_provider_cards",
    2,
    "customer retains assigned historical cleaner card",
  );
  await check(
    `select p.customer_first_name from bookings b cross join lateral customer_provider_card(b) p where b.id='${id(20)}'`,
    "TEST",
    "computed booking relationship works",
  );
  await check(
    "select count(*)::int from providers",
    2,
    "legacy reads remain unchanged pending owner confirmation",
  );
  await actor(id(1));
  await check(
    `select display_name from providers where id='${id(11)}'`,
    "TEST Public Surname",
    "worker self data remains unchanged",
  );
  await db.exec("reset role");
  await check(
    "select count(*)::int from pg_policies where schemaname='public' and tablename='providers'",
    1,
    "expansion does not add or alter provider access policies",
  );
  console.log(
    `${checks} additive projection checks passed; restriction NOT installed.`,
  );
} finally {
  await db.close();
}
