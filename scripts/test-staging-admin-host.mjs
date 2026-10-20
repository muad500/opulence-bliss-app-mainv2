// Explicit isolated-staging checks. Creates and removes only this run's fixture.
// Credentials, recovery tokens, cookies and TOTP seeds remain in memory.
import assert from "node:assert/strict";
import { randomBytes, createHmac } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

if (!process.argv.includes("--run-real-staging"))
  throw Error("Explicit staging flag required");
const env = JSON.parse(
  await readFile(".local-secrets/staging-api.json", "utf8"),
);
const access = JSON.parse(
  await readFile(".local-secrets/staging-webhook-access.json", "utf8"),
);
const url = env.NEXT_PUBLIC_SUPABASE_URL;
assert.equal(url, "https://comwdjprdedmsnxtvuuk.supabase.co");
const publicOrigin =
  "https://opulence-bliss-app-mainv2-git-codex-staging-muad500s-projects.vercel.app";
let staffOrigin;
const headers = {
  "x-vercel-protection-bypass": access.vercelAutomationBypassSecret,
};
const results = [];
function pass(label) {
  results.push(label);
  console.log("PASS " + label);
}
async function need(value) {
  const result = await value;
  if (result.error)
    throw Error(
      "Staging fixture operation failed (" +
        (result.error.code ?? result.error.status ?? "unknown") +
        ")",
    );
  return result.data;
}
const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const created = [];
function totp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret.toUpperCase().replace(/=+$/, "")]
    .map((c) => alphabet.indexOf(c).toString(2).padStart(5, "0"))
    .join("");
  const key = Buffer.from(
    (bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)),
  );
  const count = Buffer.alloc(8);
  count.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const hash = createHmac("sha1", key).update(count).digest();
  return String(
    (hash.readUInt32BE(hash.at(-1) & 15) & 0x7fffffff) % 1000000,
  ).padStart(6, "0");
}
async function web(origin, path, cookie = "") {
  return fetch(origin + path, {
    redirect: "manual",
    headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) },
    signal: AbortSignal.timeout(45000),
  });
}
try {
  const entry = await web(publicOrigin, "/staff/login");
  assert.equal(entry.status, 307);
  staffOrigin = new URL(entry.headers.get("location")).origin;
  assert.match(
    staffOrigin,
    /^https:\/\/opulence-bliss-app-mainv2-[a-z0-9]+-muad500s-projects\.vercel\.app$/,
  );
  assert.notEqual(publicOrigin, staffOrigin);
  assert.equal(
    (await web(staffOrigin, "/")).headers.get("location"),
    publicOrigin + "/",
  );
  pass("Staging has separate staff/public hosts on its own deployment");
  for (const path of [
    "/staff/login",
    "/staff/mfa",
    "/staff/forgot-password",
    "/admin",
    "/admin/settings?page=2",
  ]) {
    const response = await web(publicOrigin, path);
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), staffOrigin + path);
    assert.equal(response.headers.get("set-cookie"), null);
  }
  pass(
    "Public staging redirects staff routes before auth and preserves the path/query",
  );
  for (const path of ["/book", "/account", "/provider/login", "/login"])
    assert.equal(
      (await web(staffOrigin, path)).headers.get("location"),
      publicOrigin + path,
    );
  pass(
    "Staff staging sends customer/cleaner routes to the public staging website",
  );
  for (const path of ["/", "/book", "/login", "/provider/login"])
    assert.equal((await web(publicOrigin, path)).status, 200);
  const login = await (await web(staffOrigin, "/staff/login")).text();
  assert.ok(
    login.includes("Admin login") && login.includes("/staff/forgot-password"),
  );
  assert.ok(
    !login.includes("Book a service") && !login.includes("data-website-header"),
  );
  pass(
    "Public pages still load; staff login has recovery and no public navigation",
  );
  const recovery = await (
    await web(staffOrigin, "/staff/forgot-password")
  ).text();
  assert.ok(recovery.includes(staffOrigin + "/staff/callback"));
  pass("Staff recovery form targets the allowed staging staff callback");

  const run = randomBytes(8).toString("hex");
  const email = `qa-admin-host-${run}@example.invalid`;
  const password = randomBytes(30).toString("base64url") + "Aa9!";
  const { user } = await need(
    admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: "[TEST ONLY] Admin host isolation" },
    }),
  );
  created.push(user.id);
  await need(
    admin.from("profiles").upsert({
      id: user.id,
      email,
      role: "admin",
      full_name: "[TEST ONLY] Admin host isolation",
    }),
  );
  const jar = new Map();
  const client = createServerClient(url, env.VISIT_PAYMENTS_GATEWAY_ANON_KEY, {
    cookieOptions: { name: "sb-comwdjprdedmsnxtvuuk-auth-token" },
    auth: {
      storageKey: "sb-comwdjprdedmsnxtvuuk-auth-token",
      autoRefreshToken: false,
    },
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (values) =>
        values.forEach(({ name, value, options }) => {
          assert.equal(options.domain, undefined);
          jar.set(name, value);
        }),
    },
  });
  const cookie = () =>
    [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
  await need(client.auth.signInWithPassword({ email, password }));
  assert.equal(
    (await web(staffOrigin, "/api/admin/social-links", cookie())).status,
    403,
  );
  const passwordOnly = await web(staffOrigin, "/admin", cookie());
  const passwordOnlyText = await passwordOnly.text();
  assert.ok(
    passwordOnly.headers.get("location")?.includes("/staff/mfa") ||
      passwordOnlyText.includes("NEXT_REDIRECT;replace;/staff/mfa;307;"),
  );
  assert.ok(!passwordOnlyText.includes("<h1>Overview</h1>"));
  pass(
    "Real password-only staging staff session cannot open admin pages or APIs",
  );
  const mfaPage = await web(staffOrigin, "/staff/mfa", cookie());
  assert.equal(mfaPage.status, 200);
  const factor = await need(
    client.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `Host isolation QA ${run}`,
    }),
  );
  const currentCode = totp(factor.totp.secret);
  const invalid = await client.auth.mfa.challengeAndVerify({
    factorId: factor.id,
    code: currentCode === "000000" ? "999999" : "000000",
  });
  assert.ok(invalid.error);
  await need(
    client.auth.mfa.challengeAndVerify({
      factorId: factor.id,
      code: currentCode,
    }),
  );
  assert.equal((await client.rpc("is_admin")).data, true);
  assert.equal(
    (await web(staffOrigin, "/api/admin/social-links", cookie())).status,
    200,
  );
  const signedPage = await web(staffOrigin, "/admin", cookie());
  assert.equal(signedPage.status, 200);
  assert.match(await signedPage.text(), /<h1[^>]*>Overview<\/h1>/);
  pass(
    "Actual staging TOTP rejects an invalid code and opens staff pages/APIs after verification",
  );
  const link = await need(
    admin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo: staffOrigin + "/staff/callback" },
    }),
  );
  assert.equal(
    new URL(link.properties.action_link).searchParams.get("redirect_to"),
    staffOrigin + "/staff/callback",
  );
  pass(
    "Supabase accepts the staff recovery callback without falling back to the public site",
  );
  assert.equal(
    (await web(staffOrigin, "/staff/callback?code=invalid")).headers.get(
      "location",
    ),
    staffOrigin + "/staff/login?error=recovery",
  );
  pass("Invalid staff recovery links fail closed on the staff host");
  await need(client.auth.signOut({ scope: "local" }));
  await writeFile(
    "artifacts/admin-host-staging-results.json",
    JSON.stringify(
      { passed: true, staffOrigin, publicOrigin, checks: results },
      null,
      2,
    ) + "\n",
  );
} finally {
  for (const id of created.reverse())
    await need(admin.auth.admin.deleteUser(id));
}
