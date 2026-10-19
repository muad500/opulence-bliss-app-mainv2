// Explicit, disposable staging-only integration test. Never uses real users or
// live Stripe. Credentials are supplied in memory by the operator, not logged.
import assert from "node:assert/strict";
import { randomBytes, createHmac, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
if (!process.argv.includes("--run-real-staging"))
  throw Error("Use --run-real-staging explicitly");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (url !== "https://comwdjprdedmsnxtvuuk.supabase.co")
  throw Error("Only the isolated staging database is allowed");
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const root =
  "https://opulence-bliss-app-mainv2-git-codex-staging-muad500s-projects.vercel.app";
const users = [];
const results = [];
const check = (value, label) => {
  assert.ok(value, label);
  results.push(label);
  console.log("PASS " + label);
};
const need = async (p) => {
  const r = await p;
  if (r.error) throw Error("Fixture operation failed: " + r.error.message);
  return r.data;
};
const run = randomBytes(6).toString("hex");
async function person(
  role,
  email = `qa-security-${run}-${role}@example.invalid`,
) {
  const password = randomBytes(30).toString("base64url") + "aA9!";
  const { user } = await need(
    admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: "[TEST ONLY] Security check" },
    }),
  );
  users.push(user.id);
  await need(
    admin
      .from("profiles")
      .upsert({
        id: user.id,
        role,
        email,
        full_name: "[TEST ONLY] Security check",
      }),
  );
  return { id: user.id, email, password };
}
function totp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.toUpperCase().replace(/=+$/, ""))
    bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const bytes = Buffer.from(
    (bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)),
  );
  const count = Buffer.alloc(8);
  count.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac("sha1", bytes).update(count).digest();
  const off = h.at(-1) & 15;
  return String((h.readUInt32BE(off) & 0x7fffffff) % 1000000).padStart(6, "0");
}
async function signIn(person) {
  const jar = new Map();
  const client = createServerClient(url, anon, {
    cookieOptions: { name: "sb-comwdjprdedmsnxtvuuk-auth-token" },
    auth: { storageKey: "sb-comwdjprdedmsnxtvuuk-auth-token" },
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (rows) => rows.forEach((row) => jar.set(row.name, row.value)),
    },
  });
  await need(client.auth.signInWithPassword(person));
  return {
    client,
    cookie: () => [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
  };
}
async function web(path, session) {
  return fetch(root + path, {
    redirect: "manual",
    headers: {
      Cookie: session.cookie(),
      "x-vercel-protection-bypass": process.env.STAGING_VERCEL_BYPASS,
    },
    signal: AbortSignal.timeout(45000),
  });
}
try {
  const customer = await person("customer");
  const count = async () => {
    const rows = await need(
      admin
        .from("account_security_alerts")
        .select("id")
        .eq("user_id", customer.id),
    );
    return rows.length;
  };
  let before = await count();
  await need(
    admin
      .from("profiles")
      .update({
        full_name: "[TEST ONLY] Changed name",
        phone: "+442079460951",
        address: "Fictional address",
        postcode: "SW1A 1AA",
      })
      .eq("id", customer.id),
  );
  check(
    (await count()) === before + 1,
    "Name/phone/address change queues one private alert per transaction",
  );
  before = await count();
  await need(
    admin
      .from("profiles")
      .update({ full_name: "[TEST ONLY] Changed name" })
      .eq("id", customer.id),
  );
  check((await count()) === before, "Unchanged values do not queue alerts");
  await need(
    admin
      .from("account_profile_details")
      .upsert({
        user_id: customer.id,
        photo_url: "https://example.invalid/test-photo.png",
      }),
  );
  check((await count()) === before + 1, "Saved photo change queues an alert");
  before = await count();
  const address = randomUUID();
  await need(
    admin
      .from("customer_addresses")
      .insert({
        id: address,
        user_id: customer.id,
        line1: "Fictional test address",
        city: "London",
        postcode: "SW1A 1AA",
      }),
  );
  await need(
    admin
      .from("customer_addresses")
      .update({ label: "[TEST ONLY] Address label" })
      .eq("id", address),
  );
  await need(admin.from("customer_addresses").delete().eq("id", address));
  check(
    (await count()) === before + 3,
    "Add, edit and remove address each queue an alert",
  );
  before = await count();
  const provider = randomUUID();
  await need(
    admin
      .from("providers")
      .insert({
        id: provider,
        profile_id: customer.id,
        services: ["cleaning"],
        display_name: "[TEST ONLY] Security provider",
      }),
  );
  await need(
    admin
      .from("providers")
      .update({
        payout_schedule: "monthly",
        stripe_account_id: `acct_security_${run}`,
      })
      .eq("id", provider),
  );
  check(
    (await count()) === before + 1,
    "Saved payout account/schedule change queues an alert",
  );
  before = await count();
  await need(
    admin.auth.admin.updateUserById(customer.id, {
      password: randomBytes(30).toString("hex") + "aA9!",
    }),
  );
  check(
    (await count()) === before + 1,
    "Actual password change queues an alert",
  );
  const privateClient = createClient(url, anon, {
    auth: { persistSession: false },
  });
  const signed = await signIn(customer).catch(() => null); // Old password must no longer work.
  check(signed === null, "Old password no longer signs in after change");
  const anonymous = await privateClient
    .from("account_security_alerts")
    .select("*");
  check(!!anonymous.error, "Anonymous clients cannot read alert recipients");

  const staff = await person("admin"),
    session = await signIn(staff);
  check(
    (await session.client.rpc("is_admin")).data === false,
    "Password-only admin has no database admin privilege",
  );
  const duplicate = await session.client.rpc(
    "professional_duplicate_warnings",
    { p_provider: provider },
  );
  check(
    !duplicate.error && duplicate.data.length === 0,
    "Legacy admin-only RPC does not leak data at AAL1",
  );
  if (process.env.STAGING_VERCEL_BYPASS) {
    const page = await web("/admin", session);
    check(
      [303, 307, 308].includes(page.status) &&
        new URL(page.headers.get("location"), root).pathname === "/staff/mfa",
      "Password-only admin page redirects to authenticator setup",
    );
    check(
      (await web("/api/admin/social-links", session)).status === 403,
      "Password-only admin API is denied",
    );
  }
  const factor = await need(
    session.client.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `QA security ${run}`,
    }),
  );
  check(
    (await session.client.rpc("is_admin")).data === false,
    "Enrolling without verification does not unlock admin",
  );
  const code = totp(factor.totp.secret);
  const wrong = await session.client.auth.mfa.challengeAndVerify({
    factorId: factor.id,
    code: code === "000000" ? "999999" : "000000",
  });
  check(!!wrong.error, "Incorrect authenticator code is refused");
  await need(
    session.client.auth.mfa.challengeAndVerify({ factorId: factor.id, code }),
  );
  check(
    (await session.client.rpc("is_admin")).data === true,
    "Verified authenticator unlocks database admin privileges",
  );
  if (process.env.STAGING_VERCEL_BYPASS) {
    check(
      (await web("/api/admin/social-links", session)).status === 200,
      "Verified authenticator unlocks admin API",
    );
    check(
      (await web("/admin", session)).status === 200,
      "Verified authenticator opens admin dashboard",
    );
  }
  const current = await session.client.auth.getSession();
  const stale = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Authorization: `Bearer ${current.data.session.access_token}` },
    },
  });
  await need(session.client.auth.mfa.unenroll({ factorId: factor.id }));
  check(
    (await stale.rpc("is_admin")).data === false,
    "Removing the factor revokes admin even for a stale AAL2 token",
  );
  console.log(
    JSON.stringify({
      environment: "isolated staging",
      checks: results.length,
      passed: true,
    }),
  );
} finally {
  // Only IDs created by this run are disposable; existing users are never altered.
  for (const id of users.reverse()) {
    await need(admin.from("providers").delete().eq("profile_id", id));
    await need(admin.auth.admin.deleteUser(id));
  }
}
