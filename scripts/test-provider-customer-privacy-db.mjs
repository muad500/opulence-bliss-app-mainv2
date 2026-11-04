// Offline PostgreSQL only. Fictional identifiers; no network/project credentials.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
if (!process.env.PGLITE_MODULE)
  throw Error("Supply local PGLITE_MODULE, never a remote database.");
const { PGlite } = require(process.env.PGLITE_MODULE);
const db = new PGlite();
let checks = 0;
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
async function check(sql, expected, label) {
  assert.deepEqual(
    Object.values((await db.query(sql)).rows[0])[0],
    expected,
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
async function actor(user, role = "authenticated", aal = "aal1") {
  await db.exec(
    `reset role; select set_config('request.jwt.claims','${JSON.stringify({ sub: user, role, aal })}',false); set role ${role};`,
  );
}
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; grant usage on schema auth,public to anon,authenticated,service_role;
    create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
    create function can_review_professional() returns boolean language sql stable as $$select coalesce(
      auth.uid()='${id(3)}'::uuid and current_setting('request.jwt.claims',true)::jsonb->>'aal'='aal2',false)$$;
    create function account_is_active() returns boolean language sql stable as $$select auth.uid() is distinct from '${id(9)}'::uuid$$;
    create table providers(id uuid primary key,profile_id uuid,display_name text,customer_first_name text,
      photo_url text,public_rating_avg numeric,public_rating_count integer,bio text,years_experience integer,
      services text[],vetting_status text,dbs_verified boolean,is_suspended boolean,show_on_our_pros boolean,
      joining_fee_paid boolean,stripe_account_id text,insurance_ref text,cert_ref text);
    create table bookings(id uuid primary key,provider_id uuid references providers,customer_id uuid);
    create table customer_favourite_providers(provider_id uuid,user_id uuid);
    alter table providers enable row level security;
    create policy legacy_public on providers for select using(vetting_status='approved' and joining_fee_paid);
    create policy self_reads on providers for select using(profile_id=auth.uid());
    create policy scoped_staff on providers for select using(can_review_professional());
    create policy self_updates on providers for update using(profile_id=auth.uid());
    grant select on providers,bookings,customer_favourite_providers to anon,authenticated,service_role;
    grant update(bio) on providers to authenticated;
    create function public_eligible_provider_ids() returns table(id uuid) language sql stable security definer set search_path=public
      as $$select p.id from providers p where show_on_our_pros and dbs_verified and not is_suspended and vetting_status='approved'$$;
    insert into providers values('${id(11)}','${id(1)}','TEST First PrivateSurname','TEST','test-photo',4.5,2,'TEST public bio',2,
      array['cleaning'],'approved',true,false,true,true,'acct_TEST_private','TEST_PRIVATE_INSURANCE','TEST_PRIVATE_CERT');
    insert into providers values('${id(12)}','${id(2)}','TEST Hidden PrivateSurname','TEST',null,null,0,null,0,
      array['cleaning'],'approved',true,false,false,true,'acct_TEST_hidden',null,null);
    insert into providers values('${id(13)}','${id(8)}','TEST Unrelated PrivateSurname','TEST',null,null,0,null,0,
      array['cleaning'],'approved',true,false,false,true,'acct_TEST_unrelated',null,null);
    insert into bookings values('${id(20)}','${id(12)}','${id(4)}');
    insert into customer_favourite_providers values('${id(12)}','${id(5)}');`);
  await actor(id(4));
  await check(
    "select count(*)::int from providers",
    3,
    "fixture reproduces the legacy permissive leak",
  );
  await db.exec("reset role");
  await db.exec(
    readFileSync(
      "supabase/migrations/20261104210000_private_provider_customer_projection.sql",
      "utf8",
    ),
  );
  await actor(id(4));
  await check("select count(*)::int from providers",3,"expansion alone does not break old staging readers");
  await db.exec("reset role");
  await db.exec(readFileSync("supabase/migrations/20261104210001_close_legacy_provider_customer_reads.sql","utf8"));
  await actor(null, "anon");
  await check(
    "select count(*)::int from providers",
    0,
    "anonymous requests cannot read stored provider rows",
  );
  await check(
    "select count(*)::int from customer_provider_cards",
    1,
    "public directory projection retains eligible profiles",
  );
  await check(
    "select bio is null and years_experience is null and cardinality(services)=0 from customer_provider_cards limit 1",
    true,
    "legacy biography fields are compatibility placeholders, not stored personal data",
  );
  await denied(
    "select display_name from customer_provider_cards",
    "public projection has no stored full-name column",
  );
  await denied(
    "select profile_id,stripe_account_id,insurance_ref,cert_ref from customer_provider_cards",
    "private identity/payment/check fields are not in the projection",
  );
  await actor(id(4));
  await check(
    "select count(*)::int from providers",
    0,
    "a customer cannot query any other cleaner's private row",
  );
  await check(
    "select count(*)::int from customer_provider_cards",
    2,
    "customer can see directory plus their historical assigned cleaner",
  );
  await check(
    `select count(*)::int from customer_provider_cards where id='${id(13)}'`,
    0,
    "an unrelated hidden cleaner remains hidden",
  );
  await check(
    `select count(*)::int from bookings b cross join lateral customer_provider_card(b) p where b.id='${id(20)}'`,
    1,
    "safe computed booking embed resolves",
  );
  await check(
    `select p.customer_first_name from bookings b cross join lateral customer_provider_card(b) p where b.id='${id(20)}'`,
    "TEST",
    "booking embed returns first name only",
  );
  await actor(id(5));
  await check(
    "select count(*)::int from customer_provider_cards",
    2,
    "customer favourites retain their safe card",
  );
  await actor(id(9));
  await check(
    "select count(*)::int from customer_provider_cards",
    1,
    "closed account has public directory access only",
  );
  await actor(id(1));
  await check(
    `select display_name from providers where id='${id(11)}'`,
    "TEST First PrivateSurname",
    "worker can still read their own full stored name",
  );
  await check(
    "select count(*)::int from providers",
    1,
    "worker cannot read another professional's private row",
  );
  await db.exec(
    `update providers set bio='TEST changed by own worker' where id='${id(11)}'`,
  );
  await check(
    `select bio from providers where id='${id(11)}'`,
    "TEST changed by own worker",
    "worker self-profile update still works",
  );
  await actor(id(3));
  await check(
    "select count(*)::int from providers",
    0,
    "staff without authenticator assurance cannot read private providers",
  );
  await actor(id(3), "authenticated", "aal2");
  await check(
    "select count(*)::int from providers",
    3,
    "authorised MFA staff retain onboarding and full-name access",
  );
  await actor(null, "service_role");
  await check(
    "select count(*)::int from providers",
    3,
    "billing and staff service-role jobs remain unaffected",
  );
  console.log(
    `${checks} provider privacy database checks passed; offline fictional data only.`,
  );
} finally {
  await db.close();
}
