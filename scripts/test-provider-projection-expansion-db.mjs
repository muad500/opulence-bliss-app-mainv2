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
async function actor(user, role = "authenticated", claims = {}) {
  await db.exec(
    `reset role; select set_config('request.jwt.claims','${JSON.stringify({ sub: user, role, ...claims })}',false); set role ${role};`,
  );
}
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; grant usage on schema auth,public to anon,authenticated,service_role;
    create function auth.uid() returns uuid language sql stable as $$select (current_setting('request.jwt.claims',true)::jsonb->>'sub')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb$$;
    create function can_review_professional() returns boolean language sql stable as $$select coalesce(auth.jwt()->>'staff'='manager' and auth.jwt()->>'aal'='aal2' and auth.jwt()->>'totp'='verified',false)$$;
    create function account_is_active() returns boolean language sql stable as $$select auth.uid() is not null and coalesce(auth.jwt()->>'closed','false')<>'true'$$;
    revoke all on function account_is_active(),can_review_professional() from public,anon;
    grant execute on function account_is_active(),can_review_professional() to authenticated,service_role;
    create table providers(id uuid primary key,profile_id uuid,display_name text,customer_first_name text,photo_url text,
      public_rating_avg numeric,public_rating_count int,bio text,years_experience int,services text[],vetting_status text,
      dbs_verified boolean,is_suspended boolean,show_on_our_pros boolean,stripe_account_id text);
    create table bookings(id uuid primary key,provider_id uuid references providers,customer_id uuid);
    create table customer_favourite_providers(provider_id uuid,user_id uuid);
    alter table providers enable row level security;
    create policy legacy_read on providers for select using(true);
    grant select on providers,bookings,customer_favourite_providers to anon,authenticated,service_role;
    revoke all on customer_favourite_providers from anon,authenticated;
    grant all on customer_favourite_providers to service_role;
    create function public_eligible_provider_ids() returns table(id uuid) language sql stable security definer set search_path=public
      as $$select p.id from providers p where show_on_our_pros and dbs_verified and not is_suspended$$;
    insert into providers values('${id(11)}','${id(1)}','TEST Public Surname','TEST',null,4.5,2,'TEST stored biography',3,array['cleaning'],'approved',true,false,true,'acct_TEST_PRIVATE');
    insert into providers values('${id(12)}','${id(2)}','TEST Assigned Surname','TEST',null,4.2,1,null,2,array['cleaning'],'approved',true,false,false,'acct_TEST_PRIVATE_2');
    insert into bookings values('${id(20)}','${id(12)}','${id(4)}');`);
  const helpersBefore = (await db.query("select proname,prosrc,proacl::text from pg_proc where proname in('account_is_active','can_review_professional') order by proname")).rows;
  // Reproduce the original view under real Stage 1-style helper ACLs, not
  // permissive mock defaults. This is the regression that blocked anon reads.
  await db.exec(`create view customer_provider_cards as select p.id from providers p where
    exists(select 1 from public_eligible_provider_ids() e where e.id=p.id)
    or (auth.uid() is not null and account_is_active() and (p.profile_id=auth.uid() or can_review_professional()));
    grant select on customer_provider_cards to anon,authenticated;`);
  await actor(null,"anon");
  await assert.rejects(db.query("select * from customer_provider_cards"),/permission denied for function/);
  checks++;
  await db.exec("reset role;drop view customer_provider_cards");
  await db.exec(
    readFileSync(
      "supabase/migrations/20261106010000_customer_provider_projection_prerequisite.sql",
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
  await assert.rejects(db.query("select account_is_active()"),/permission denied/);checks++;
  await assert.rejects(db.query("select can_review_professional()"),/permission denied/);checks++;
  await assert.rejects(db.query("select * from customer_favourite_providers"),/permission denied/);checks++;
  await check(`select customer_provider_card_visible('${id(12)}')`,false,"anonymous cannot resolve a private historical card");
  await actor(id(5));
  await check("select count(*)::int from customer_provider_cards",1,"unrelated customer sees no private historical card");
  await check(`select count(*)::int from customer_provider_card(row('${id(99)}','${id(12)}','${id(5)}')::bookings)`,0,"forged booking argument cannot bypass real ownership");
  await db.exec(`reset role;insert into customer_favourite_providers values('${id(12)}','${id(5)}')`);
  await actor(id(5));
  await check("select count(*)::int from customer_provider_cards",2,"server-only favourite retains a scoped safe card");
  await actor(id(5),"authenticated",{closed:true});
  await check("select count(*)::int from customer_provider_cards",1,"closed account cannot resolve its private favourite");
  await actor(id(4));
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
  for(const claims of [{staff:'manager',aal:'aal1',totp:'verified'},{staff:'manager',aal:'aal2'}]){
    await actor(id(9),'authenticated',claims);
    await check("select count(*)::int from customer_provider_cards",1,"staff without full authenticator proof gains no private cards");
  }
  await actor(id(9),'authenticated',{staff:'manager',aal:'aal2',totp:'verified'});
  await check("select count(*)::int from customer_provider_cards",2,"MFA reviewer retains the prior safe-card scope");
  await db.exec("reset role");
  assert.deepEqual((await db.query("select proname,prosrc,proacl::text from pg_proc where proname in('account_is_active','can_review_professional') order by proname")).rows,helpersBefore);checks++;
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
