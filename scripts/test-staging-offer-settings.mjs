// Staging-only staff/MFA and settings integration. Secrets never leave local state.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes, createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
if (!process.argv.includes("--run-real-staging"))
  throw Error("Explicit staging flag required");
const s = JSON.parse(readFileSync(".local-secrets/staging-api.json", "utf8"));
if (s.NEXT_PUBLIC_SUPABASE_URL !== "https://comwdjprdedmsnxtvuuk.supabase.co")
  throw Error("Isolated staging only");
const path = ".local-secrets/f1-offer-fixtures.json",
  state = JSON.parse(readFileSync(path, "utf8"));
const admin = createClient(
  s.NEXT_PUBLIC_SUPABASE_URL,
  s.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const bypass = JSON.parse(
  readFileSync(".local-secrets/staging-webhook-access.json", "utf8"),
).vercelAutomationBypassSecret;
const origin =
  "https://opulence-bliss-app-mainv2-git-codex-staging-muad500s-projects.vercel.app";
const jar = new Map();
const client = createServerClient(
  s.NEXT_PUBLIC_SUPABASE_URL,
  s.VISIT_PAYMENTS_GATEWAY_ANON_KEY,
  {
    cookieOptions: { name: "sb-comwdjprdedmsnxtvuuk-auth-token" },
    auth: { storageKey: "sb-comwdjprdedmsnxtvuuk-auth-token" },
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (rows) => rows.forEach((x) => jar.set(x.name, x.value)),
    },
  },
);
async function need(query) {
  const r = await query;
  if (r.error) throw Error(r.error.message);
  return r.data;
}
function check(v, label) {
  assert.ok(v, label);
  state.results.push(label);
  save();
  console.log("PASS " + label);
}
function save() {
  writeFileSync(path, JSON.stringify(state, null, 2));
  writeFileSync(
    "artifacts/f1-staging-results.json",
    JSON.stringify(
      {
        run: state.run,
        bookings: state.bookings,
        schedulerProof: state.schedulerProof,
        results: [...new Set(state.results)],
      },
      null,
      2,
    ),
  );
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
  const h = createHmac("sha1", bytes).update(count).digest(),
    o = h.at(-1) & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1000000).padStart(6, "0");
}
async function web(
  method = "GET",
  body,
  foreign = false,
  authenticated = true,
) {
  return fetch(origin + "/api/admin/job-offer-settings", {
    method,
    redirect: "manual",
    headers: {
      "x-vercel-protection-bypass": bypass,
      Origin: foreign ? "https://example.invalid" : origin,
      ...(authenticated
        ? { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") }
        : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(45000),
  });
}
if (!state.staff) {
  const email = `qa-f1-${state.run}-staff@example.invalid`,
    password = randomBytes(30).toString("base64url") + "aA9!";
  const { user } = await need(
    admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: "[TEST ONLY F1] Staff" },
    }),
  );
  state.staff = { id: user.id, email, password };
  save();
  await need(
    admin.from("profiles").upsert({
      id: user.id,
      role: "admin",
      email,
      full_name: "[TEST ONLY F1] Staff",
    }),
  );
}
check(
  (await web("GET", undefined, false, false)).status === 401,
  "Unsigned requests cannot read offer settings",
);
await need(
  client.auth.signInWithPassword({
    email: state.staff.email,
    password: state.staff.password,
  }),
);
check(
  (await web()).status === 403,
  "Password-only staff cannot access offer settings without TOTP",
);
if (!state.staff.factor) {
  const factor = await need(
    client.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "F1 test only",
    }),
  );
  state.staff.factor = factor.id;
  state.staff.totp = factor.totp.secret;
  save();
}
await need(
  client.auth.mfa.challengeAndVerify({
    factorId: state.staff.factor,
    code: totp(state.staff.totp),
  }),
);
let response = await web();
check(
  response.status === 200,
  "Staff with verified TOTP can read offer settings",
);
const original = await response.json();
check(
  original.firstWaveSize === 5 && original.secondWaveAfterMinutes === 10,
  "Admin settings default to five cleaners and ten minutes",
);
check(
  (await web("POST", { ...original, firstWaveSize: 0 })).status === 400,
  "Admin rejects an empty or unbounded first wave",
);
check(
  (await web("POST", { ...original, secondWaveAfterMinutes: 0 })).status ===
    400,
  "Admin rejects a zero-minute second wave",
);
check(
  (await web("POST", original, true)).status === 403,
  "Cross-origin settings changes are rejected",
);
let latest = original;
try {
  response = await web("POST", {
    ...original,
    firstWaveSize: 3,
    secondWaveAfterMinutes: 1,
  });
  check(
    response.status === 200,
    "Administrator can edit first-wave size and waiting time",
  );
  latest = await response.json();
  check(
    (await web("POST", original)).status === 409,
    "Stale administrator form cannot overwrite newer offer settings",
  );
  const run = await need(
    admin.rpc("staging_f1_offer_state", { p_booking: state.bookings.timing }),
  );
  check(
    run.run.wave_size === 5 && run.run.wave_wait_minutes === 10,
    "Existing offer runs keep their saved wave settings",
  );
  if (!state.settingsBooking) {
    const slot = new Date(Date.now() + 12 * 86400000);
    slot.setUTCHours(10, 0, 0, 0);
    state.settingsBooking = (
      await need(
        admin
          .from("bookings")
          .insert({
            customer_id: state.users.find((x) => x.kind === "customer").id,
            package_id: state.package,
            scheduled_at: slot.toISOString(),
            duration_minutes: 120,
            status: "offered",
            address: "[TEST ONLY F1] Fictional Place, ZE1 0AA",
            household_notes: "F1 SYNTHETIC TEST ONLY settings",
            customer_email: null,
            offer_expires_at: new Date(slot - 2 * 3600000).toISOString(),
          })
          .select("id")
          .single(),
      )
    ).id;
    save();
  }
  await need(
    admin.rpc("system_initialize_booking_offer_queue", {
      p_booking_id: state.settingsBooking,
      p_provider_ids: [],
    }),
  );
  const saved = await need(
    admin.rpc("staging_f1_offer_state", { p_booking: state.settingsBooking }),
  );
  check(
    saved.run.wave_size === 3 && saved.run.wave_wait_minutes === 1,
    "New offer runs snapshot the edited administrator settings",
  );
} finally {
  const current = await (await web()).json();
  response = await web("POST", {
    ...current,
    firstWaveSize: original.firstWaveSize,
    secondWaveAfterMinutes: original.secondWaveAfterMinutes,
  });
  check(
    response.status === 200,
    "Staging defaults restored to five cleaners and ten minutes",
  );
}
save();
