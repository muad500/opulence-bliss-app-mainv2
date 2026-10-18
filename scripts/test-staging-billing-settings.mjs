import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import Stripe from "stripe";
const c = JSON.parse(readFileSync(".local-secrets/staging-api.json")),
  s = JSON.parse(readFileSync(".local-secrets/client-decisions-fixtures.json"));
if (
  c.NEXT_PUBLIC_SUPABASE_URL !== "https://comwdjprdedmsnxtvuuk.supabase.co" ||
  !c.STRIPE_SECRET_KEY.startsWith("sk_test_")
)
  throw Error("Staging required");
const admin = createClient(
    c.NEXT_PUBLIC_SUPABASE_URL,
    c.SUPABASE_SERVICE_ROLE_KEY,
  ),
  stripe = new Stripe(c.STRIPE_SECRET_KEY),
  root = process.env.CLIENT_DECISIONS_TEST_URL ?? "http://localhost:3127";
if (
  ![
    "http://localhost:3127",
    "https://opulence-bliss-app-mainv2-git-codex-staging-muad500s-projects.vercel.app",
  ].includes(root)
)
  throw Error("Named staging only");
const bypass = root.startsWith("https:")
  ? JSON.parse(readFileSync(".local-secrets/staging-webhook-access.json"))
      .vercelAutomationBypassSecret
  : null;
const checks = [];
const ok = (v, label) => {
  if (!v) throw Error(label);
  checks.push({ check: label, passed: true });
  console.log("PASS " + label);
};
async function session(user) {
  const jar = new Map();
  const db = createServerClient(
    c.NEXT_PUBLIC_SUPABASE_URL,
    c.VISIT_PAYMENTS_GATEWAY_ANON_KEY,
    {
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: (arr) => arr.forEach((x) => jar.set(x.name, x.value)),
      },
    },
  );
  const r = await db.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (r.error) throw Error("Fixture sign in");
  return () => [...jar].map(([k, v]) => k + "=" + v).join("; ");
}
const staff = await session(s.users.staff),
  customer = await session(s.users.customer);
async function request(path, who, method = "GET", body) {
  const headers = { Origin: root };
  if (who) headers.Cookie = who();
  if (bypass) headers["x-vercel-protection-bypass"] = bypass;
  if (body) headers["Content-Type"] = "application/json";
  const r = await fetch(root + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000),
  });
  let value = r.headers.get("content-type")?.includes("application/json")
    ? await r.json()
    : await r.text();
  return { status: r.status, value };
}
let current;
try {
  let r = await request("/api/admin/billing-settings", customer);
  ok(r.status === 403, "Client cannot read private admin pay settings");
  r = await request("/api/admin/billing-settings", staff);
  ok(
    r.status === 200 && r.value.cleanerHourlyPence === 1500,
    "Admin settings load the decided £15 hourly pay",
  );
  current = r.value;
  r = await request("/api/admin/billing-settings", staff, "POST", {
    ...current,
    cleanerHourlyPence: -100,
  });
  ok(r.status === 400, "Invalid pay settings are rejected");
  r = await request("/api/admin/billing-settings", staff, "POST", {
    ...current,
    cleanerHourlyPence: 1600,
    productsFeePence: 600,
    tipMinimumPence: 400,
    addonPrices: { ...current.addonPrices, oven: 2500 },
    cancellationRefundPercent: {
      full: 100,
      three_quarter: 80,
      half: 60,
      none: 0,
    },
  });
  ok(
    r.status === 200,
    "Admin can save pay, extras, products, tip minimum and refund bands",
  );
  r = await request(
    "/api/account/visits/" + s.paymentChecks.oneOff.id + "/billing",
    customer,
  );
  ok(
    r.status === 200 &&
      r.value.pricing.productsFeePence === 500 &&
      r.value.pricing.addonPrices.oven === 2000 &&
      !("cleanerHourlyPence" in r.value.pricing),
    "Existing booking API retains original customer prices and hides the pay calculation",
  );
  r = await request(
    "/api/tip?bookingId=" + s.paymentChecks.oneOff.id,
    customer,
  );
  ok(
    r.status === 200 && r.value.minimumPence === 300,
    "An existing booking retains its original £3 minimum tip",
  );
  r = await request("/api/tip", customer, "POST", {
    bookingId: s.paymentChecks.oneOff.id,
    amount: "2.99",
  });
  ok(
    r.status === 400,
    "A tip below the booking minimum is rejected before Stripe checkout",
  );
  for (const regular of [false, true]) {
    const pkg = await admin
      .from("packages")
      .select("id")
      .eq("name", regular ? "Essential Clean" : "One-Time Essential Clean")
      .single();
    const slot = new Date(Date.now() + 25 * 86400000);
    slot.setUTCHours(10, 0, 0, 0);
    r = await request("/api/checkout", customer, "POST", {
      packageId: pkg.data.id,
      postcode: "EC1V 2NX",
      address: "FICTIONAL STAGING API CHECK, London",
      frequency: regular ? "weekly" : "one_time",
      regularVisits: 6,
      saveCardConsent: true,
      durationMinutes: 120,
      home: { propertyType: "flat", bedrooms: 1, bathrooms: 1 },
      slot: slot.toISOString(),
      optionalSlots: [],
      addons: ["oven"],
      bringsProducts: true,
      petsAtHome: false,
      bookingPreferences: {
        howHeard: "Instagram",
        confirmationChannel: "email",
        roomsToClean: "Kitchen",
        accessInstructions: "Fictional concierge",
      },
      earlyStartRequested: true,
    });
    ok(
      r.status === 200,
      "Actual " +
        (regular ? "regular" : "one-off") +
        " checkout API creates a test-only session",
    );
    const id = new URL(r.value.url).pathname.split("/").at(-1);
    const session = await stripe.checkout.sessions.retrieve(id);
    ok(
      regular
        ? session.mode === "setup" && !session.payment_intent
        : session.mode === "payment" && session.amount_total === 7698,
      "Actual checkout uses " +
        (regular ? "setup without a charge" : "current new-booking prices"),
    );
    const choices = await admin
      .from("booking_checkout_time_choices")
      .select("cleaning_extras,booking_preferences")
      .eq("checkout_session_id", id)
      .single();
    ok(
      choices.data.cleaning_extras[0].billingSettings.cleanerHourlyPence ===
        1600 && choices.data.booking_preferences.roomsToClean === "Kitchen",
      "New checkout snapshots settings and rooms/access/referral choices",
    );
    await stripe.checkout.sessions.expire(id);
  }
  r = await request("/admin/settings", staff);
  ok(
    r.status === 200 && r.value.includes("Booking prices and cleaner pay"),
    "Admin Settings page renders for staff",
  );
  writeFileSync(
    "artifacts/client-decisions-settings-http-results.json",
    JSON.stringify({ environment: "staging", checks }, null, 2),
  );
} catch (e) {
  console.error("FAILED: " + e.message);
  process.exitCode = 1;
} finally {
  if (current) {
    const latest = await request("/api/admin/billing-settings", staff);
    const r = await request("/api/admin/billing-settings", staff, "POST", {
      ...current,
      version: latest.value.version,
    });
    ok(
      r.status === 200,
      "Decided staging defaults restored as a new immutable version",
    );
  }
}
