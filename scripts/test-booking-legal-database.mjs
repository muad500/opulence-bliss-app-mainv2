// Offline PostgreSQL integration test. Install PGlite in a temporary directory
// and set LEGAL_PGLITE_MODULE to its dist/index.js; no project dependency or
// network/database credentials are needed by this test.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

if (!process.env.LEGAL_PGLITE_MODULE)
  throw Error("Set LEGAL_PGLITE_MODULE to the temporary PGlite dist/index.js");
const { PGlite } = await import(
  pathToFileURL(process.env.LEGAL_PGLITE_MODULE).href
);
const db = new PGlite();
const hash = (value) => createHash("md5").update(value).digest("hex");
const owner = randomUUID(),
  outsider = randomUUID(),
  staff = randomUUID(),
  pkg = randomUUID();
const check = (label) => console.log(`PASS ${label}`);
const jwt = async (claims = { role: "service_role" }, role = "postgres") => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify(claims),
  ]);
  if (role !== "postgres") await db.exec(`set role ${role}`);
};
const call = async (name, args = []) =>
  (
    await db.query(
      `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) value`,
      args,
    )
  ).rows[0]?.value;
const documents = ["terms", "cancellation-refund", "privacy"].map((slug) => ({
  slug,
  version: "1.0",
  updatedAt: "2026-10-01T00:00:00Z",
  isFallback: false,
}));
const snapshots = documents.map((doc) => {
  const contentHtml = `<p>${doc.slug}: exact accepted wording.</p>`;
  return {
    ...doc,
    title: doc.slug,
    sourceContentHtml: contentHtml,
    contentHtml,
    contentHash: hash(contentHtml),
    displayContentHash: hash(contentHtml),
  };
});
const evidence = {
  schemaVersion: 1,
  request: { ip: "203.0.113.10", userAgent: "Synthetic test browser" },
  account: { email: "spoof@example.invalid" },
  checkboxes: [
    {
      key: "booking_policies",
      text: "I accept the exact three policies (Version 1.0).",
      checked: true,
    },
  ],
};
const prepare = (overrides = {}) =>
  call("prepare_booking_legal_consent_v2", [
    owner,
    JSON.stringify(overrides.documents ?? documents),
    JSON.stringify(overrides.fallbacks ?? []),
    JSON.stringify(overrides.snapshots ?? snapshots),
    JSON.stringify(overrides.evidence ?? evidence),
  ]);
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; grant usage on schema auth to anon,authenticated,service_role;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create function auth.role() returns text language sql stable as $$select auth.jwt()->>'role'$$;
    create function auth.uid() returns uuid language sql stable as $$select nullif(auth.jwt()->>'sub','')::uuid$$;
    create table auth.users(id uuid primary key,email text);
    create table auth.mfa_factors(id uuid primary key default gen_random_uuid(),user_id uuid,factor_type text,status text);
    create table public.profiles(id uuid primary key,email text,full_name text,role text,account_deleted_at timestamptz);
    create table public.packages(id uuid primary key,name text);
    create table public.bookings(id uuid primary key,customer_id uuid references profiles(id),package_id uuid references packages(id),scheduled_at timestamptz,checkout_session_id text,regular_series_id uuid);
    create table public.regular_booking_series(id uuid primary key,checkout_session_id text);
    create table public.booking_checkout_time_choices(checkout_session_id text primary key,customer_id uuid);
    create table public.account_legal_acceptances(id bigint generated always as identity primary key,user_id uuid not null references profiles(id) on delete cascade,document_slug text,version text,accepted_at timestamptz not null default now(),unique(user_id,document_slug,version));
    create table public.legal_documents(slug text primary key,title text,version text,updated_at timestamptz,content_html text,published boolean);
  `);
  const mfaMigration = readFileSync(
    "supabase/migrations/20261019000300_require_staff_totp.sql",
    "utf8",
  );
  await db.exec(
    mfaMigration.match(
      /create or replace function public\.is_admin\(\)[\s\S]*?\$function\$;/,
    )[0],
  );
  for (const [id, role, email] of [
    [owner, "customer", "owner@example.invalid"],
    [outsider, "customer", "other@example.invalid"],
    [staff, "admin", "staff@example.invalid"],
  ]) {
    await db.query("insert into auth.users values($1,$2)", [id, email]);
    await db.query(
      "insert into profiles values($1,$2,'Synthetic account',$3,null)",
      [id, email, role],
    );
  }
  await db.query("insert into packages values($1,'Essential Clean')", [pkg]);
  for (const doc of snapshots)
    await db.query("insert into legal_documents values($1,$2,$3,$4,$5,true)", [
      doc.slug,
      doc.title,
      doc.version,
      doc.updatedAt,
      doc.sourceContentHtml,
    ]);
  await jwt();
  await db.exec(
    readFileSync(
      "supabase/migrations/20261021000200_checkout_legal_acceptance.sql",
      "utf8",
    ),
  );
  await db.exec(
    readFileSync(
      "supabase/migrations/20261021000300_activate_checkout_legal_acceptance.sql",
      "utf8",
    ),
  );
  await db.exec(
    readFileSync(
      "supabase/migrations/20261023000200_booking_legal_evidence.sql",
      "utf8",
    ),
  );
  assert.equal(await call("checkout_legal_evidence_ready"), true);
  check("new migration applies after the original consent migrations");

  await jwt({ role: "authenticated", sub: owner }, "authenticated");
  await assert.rejects(prepare, /permission denied/);
  await jwt();
  for (const invalid of [
    { documents: documents.slice(0, 2) },
    { documents: documents.map((d) => ({ ...d, version: "stale" })) },
    {
      snapshots: snapshots.map((d) => ({
        ...d,
        sourceContentHtml: "<p>Changed</p>",
      })),
    },
    {
      evidence: {
        ...evidence,
        checkboxes: [{ ...evidence.checkboxes[0], checked: false }],
      },
    },
    {
      evidence: {
        ...evidence,
        checkboxes: [...evidence.checkboxes, evidence.checkboxes[0]],
      },
    },
  ])
    await assert.rejects(() => prepare(invalid));
  check(
    "browser roles, stale versions, altered sources and unchecked/duplicate consents are rejected",
  );

  await db.exec("delete from legal_documents where slug='terms'");
  const fallback = {
    ...snapshots[0],
    version: "2.0",
    updatedAt: null,
    isFallback: true,
  };
  const fallbackConsent = await prepare({
    documents: documents.map((d) =>
      d.slug === "terms"
        ? {
            slug: d.slug,
            version: fallback.version,
            updatedAt: null,
            isFallback: true,
          }
        : d,
    ),
    snapshots: snapshots.map((d) => (d.slug === "terms" ? fallback : d)),
    fallbacks: [fallback],
  });
  assert.equal(
    (
      await db.query(
        "select documents->0->>'version' v from booking_checkout_legal_consents where id=$1",
        [fallbackConsent],
      )
    ).rows[0].v,
    "2.0",
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from legal_documents where slug='terms'",
      )
    ).rows[0].n,
    0,
  );
  await db.query("insert into legal_documents values($1,$2,$3,$4,$5,true)", [
    snapshots[0].slug,
    snapshots[0].title,
    snapshots[0].version,
    snapshots[0].updatedAt,
    snapshots[0].sourceContentHtml,
  ]);
  check(
    "missing published Terms uses its trusted built-in version without publishing a legal row",
  );

  const consent = await prepare();
  const recorded = (
    await db.query(
      "select * from booking_checkout_legal_consents where id=$1",
      [consent],
    )
  ).rows[0];
  assert.equal(recorded.evidence.account.email, "owner@example.invalid");
  assert.equal(recorded.evidence.account.userId, owner);
  assert.equal(recorded.evidence.request.userAgent, evidence.request.userAgent);
  assert.equal(
    recorded.documents[0].sourceContentHtml,
    snapshots[0].sourceContentHtml,
  );
  await assert.rejects(
    () =>
      db.query(
        "update booking_checkout_legal_consents set documents='[]' where id=$1",
        [consent],
      ),
    /immutable/,
  );
  check(
    "account identity comes from the database and accepted HTML/evidence cannot be rewritten",
  );

  const session = "cs_test_legal_" + randomUUID(),
    booking = randomUUID();
  await db.query(
    "insert into booking_checkout_time_choices(checkout_session_id,customer_id,legal_consent_id,legal_consent_required) values($1,$2,$3,true)",
    [session, owner, consent],
  );
  await db.query(
    "insert into bookings values($1,$2,$3,now()+interval '10 days',$4,null)",
    [booking, owner, pkg, session],
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from account_legal_acceptances where booking_id=$1",
        [booking],
      )
    ).rows[0].n,
    3,
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from booking_legal_email_deliveries where consent_id=$1",
        [consent],
      )
    ).rows[0].n,
    1,
  );
  await assert.rejects(
    () =>
      db.query(
        "update account_legal_acceptances set version='tampered' where booking_id=$1",
        [booking],
      ),
    /immutable/,
  );
  check(
    "one-off booking atomically saves three acceptance links and queues one contract email",
  );

  const regularConsent = await prepare(),
    series = randomUUID(),
    regularSession = "cs_test_series_" + randomUUID();
  await db.query("insert into regular_booking_series values($1,$2)", [
    series,
    regularSession,
  ]);
  await db.query(
    "insert into booking_checkout_time_choices(checkout_session_id,customer_id,legal_consent_id,legal_consent_required) values($1,$2,$3,true)",
    [regularSession, owner, regularConsent],
  );
  for (let i = 0; i < 6; i++)
    await db.query(
      "insert into bookings values($1,$2,$3,now()+($4::int * interval '7 days'),null,$5)",
      [randomUUID(), owner, pkg, i + 1, series],
    );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from account_legal_acceptances where checkout_legal_consent_id=$1",
        [regularConsent],
      )
    ).rows[0].n,
    18,
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from booking_legal_email_deliveries where consent_id=$1",
        [regularConsent],
      )
    ).rows[0].n,
    1,
  );
  check(
    "six regular visits inherit one acceptance snapshot and queue one email for the series",
  );

  await jwt({ role: "authenticated", sub: outsider }, "authenticated");
  assert.equal(await call("booking_legal_contract", [booking]), null);
  await jwt(
    { role: "authenticated", sub: staff, aal: "aal1" },
    "authenticated",
  );
  assert.equal(await call("booking_legal_contract", [booking]), null);
  await jwt();
  await db.query(
    "insert into auth.mfa_factors(user_id,factor_type,status) values($1,'totp','verified')",
    [staff],
  );
  await jwt(
    {
      role: "authenticated",
      sub: staff,
      aal: "aal2",
      amr: [{ method: "totp" }],
    },
    "authenticated",
  );
  assert.equal((await call("booking_legal_contract", [booking])).id, consent);
  await jwt({ role: "authenticated", sub: owner }, "authenticated");
  assert.equal((await call("booking_legal_contract", [booking])).id, consent);
  await assert.rejects(
    () => call("admin_booking_legal_email_status", [booking]),
    /Admin access/,
  );
  await assert.rejects(
    () => call("claim_booking_legal_emails", [true]),
    /permission denied/,
  );
  check(
    "only the customer or staff with verified TOTP can read the booking's saved documents",
  );

  await jwt();
  assert.equal(await call("claim_booking_legal_emails", [false]), undefined);
  assert.equal(
    (
      await db.query(
        "select sum(attempts)::int n from booking_legal_email_deliveries",
      )
    ).rows[0].n,
    0,
  );
  const claimed = (
    await db.query("select * from claim_booking_legal_emails(true)")
  ).rows;
  assert.equal(claimed.length, 2);
  assert.equal(
    claimed.find((x) => x.contract.id === regularConsent).contract.bookings
      .length,
    6,
  );
  assert.equal(
    (await db.query("select * from claim_booking_legal_emails(true)")).rows
      .length,
    0,
  );
  const delivery = claimed[0];
  const payload = { to: [delivery.email], text: "Exact saved payload" };
  assert.deepEqual(
    await call("store_booking_legal_email_payload", [
      delivery.id,
      delivery.claim_token,
      JSON.stringify(payload),
    ]),
    payload,
  );
  assert.deepEqual(
    await call("store_booking_legal_email_payload", [
      delivery.id,
      delivery.claim_token,
      JSON.stringify({ ...payload, text: "changed" }),
    ]),
    payload,
  );
  assert.equal(
    await call("finish_booking_legal_email", [
      delivery.id,
      randomUUID(),
      true,
      null,
    ]),
    false,
  );
  assert.equal(
    await call("finish_booking_legal_email", [
      delivery.id,
      delivery.claim_token,
      true,
      null,
    ]),
    true,
  );
  await db.query(
    "update booking_legal_email_deliveries set status='pending',first_attempt_at=now()-interval '25 hours' where id=$1",
    [claimed[1].id],
  );
  await db.query("select * from claim_booking_legal_emails(true)");
  assert.equal(
    (
      await db.query(
        "select status from booking_legal_email_deliveries where id=$1",
        [claimed[1].id],
      )
    ).rows[0].status,
    "needs_review",
  );
  check(
    "delivery leases, immutable request payloads, stale tokens and the 24-hour retry boundary prevent duplicate submissions",
  );

  const legacyConsent = await call("prepare_booking_legal_consent", [
    owner,
    JSON.stringify(documents),
    "[]",
  ]);
  const legacySession = "cs_test_legacy_" + randomUUID(),
    legacyBooking = randomUUID();
  await db.query(
    "insert into booking_checkout_time_choices(checkout_session_id,customer_id,legal_consent_id) values($1,$2,$3)",
    [legacySession, owner, legacyConsent],
  );
  await db.query(
    "insert into bookings values($1,$2,$3,now()+interval '10 days',$4,null)",
    [legacyBooking, owner, pkg, legacySession],
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from account_legal_acceptances where booking_id=$1",
        [legacyBooking],
      )
    ).rows[0].n,
    3,
  );
  assert.equal(await call("_booking_legal_contract", [legacyConsent]), null);
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from booking_legal_email_deliveries where consent_id=$1",
        [legacyConsent],
      )
    ).rows[0].n,
    0,
  );
  check(
    "legacy checkout sessions keep their existing acceptances without invented documents or new emails",
  );
} finally {
  await db.close();
}
