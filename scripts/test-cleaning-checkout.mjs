import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest, NextResponse } from "next/server.js";
const require = createRequire(import.meta.url);
function harness({
  ready = true,
  stageError = false,
  perVisit = false,
  regular = false,
  legalError = false,
} = {}) {
  const calls = { sessions: [], staged: [], expired: [] };
  const db = {
    rpc: async (name) =>
      name === "prepare_booking_legal_consent_v2"
        ? {
            data: legalError ? null : "00000000-0000-4000-8000-000000000001",
            error: legalError ? { code: "40001" } : null,
          }
        : { data: ready },
    from(table) {
      const q = {
        select: () => q,
        eq: () => q,
        in: () => q,
        maybeSingle: () => q,
        order: () => q,
        limit: () => q,
        single: () => q,
        upsert: async (row) => {
          calls.staged.push(row);
          return { error: stageError ? { message: "fixture" } : null };
        },
        then(resolve) {
          resolve({
            data:
              table === "packages"
                ? {
                    name: regular
                      ? "Essential Clean"
                      : "One-Time Essential Clean",
                    price: 45.98,
                    duration_minutes: 120,
                    service_type: "cleaning",
                  }
                : table === "legal_documents"
                  ? ["terms", "privacy", "cancellation-refund"].map((slug) => ({
                      slug,
                      version: "1.0",
                      updated_at: "2026-10-21T00:00:00Z",
                      content_html: "<p>Fixture</p>",
                    }))
                  : table === "profiles"
                    ? { role: "customer", phone: "+447400123456" }
                    : table === "service_areas"
                      ? [{ postcode_prefixes: ["EC1V"] }]
                      : null,
          });
        },
      };
      return q;
    },
  };
  const cache = new Map();
  function load(path) {
    if (cache.has(path)) return cache.get(path);
    const loaded = { exports: {} };
    cache.set(path, loaded.exports);
    const code = ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText;
    const resolve = (id) => {
      if (id === "next/server") return { NextRequest, NextResponse };
      if (id === "stripe")
        return class {
          checkout = {
            sessions: {
              create: async (payload) => {
                calls.sessions.push(payload);
                return {
                  id: "cs_fixture",
                  url: "https://checkout.stripe.com/fixture",
                };
              },
              expire: async (id) => calls.expired.push(id),
            },
          };
        };
      if (id === "@supabase/supabase-js") return { createClient: () => db };
      if (id === "@/lib/supabase/server")
        return {
          createClient: async () => ({
            ...db,
            auth: {
              getUser: async () => ({
                data: {
                  user: {
                    id: "customer-fixture",
                    email: "fixture@example.invalid",
                  },
                },
              }),
            },
          }),
        };
      if (id === "server-only") return {};
      if (id === "@/lib/cleaningBillingSettings")
        return {
          currentCleaningBillingTerms: async () =>
            load("lib/cleaningBillingTerms.ts").DEFAULT_CLEANING_BILLING_TERMS,
        };
      if (id === "@/lib/accountBilling")
        return { getOrCreateBillingCustomer: async () => "cus_fixture" };
      if (id.startsWith("@/lib/")) return load("lib/" + id.slice(6) + ".ts");
      if (id.endsWith(".json")) return JSON.parse(readFileSync("lib/" + id.slice(2), "utf8"));
      if (id.startsWith("./")) return load("lib/" + id.slice(2) + ".ts");
      return require(id);
    };
    class FixtureDate extends Date {
      static now() {
        return Date.UTC(2026, 9, 14, 8);
      }
    }
    vm.runInNewContext(code, {
      module: loaded,
      exports: loaded.exports,
      require: resolve,
      process: {
        env: {
          NEXT_PUBLIC_SUPABASE_URL: "https://fixture.supabase.co",
          SUPABASE_SERVICE_ROLE_KEY: "fixture",
          STRIPE_SECRET_KEY: "sk_test_fixture",
          CLEANING_PAY_PER_VISIT_ENABLED: String(perVisit),
        },
      },
      crypto: { randomUUID: () => "fixture" },
      Date: FixtureDate,
      console: { error: () => {} },
    });
    cache.set(path, loaded.exports);
    return loaded.exports;
  }
  const route = load("app/api/checkout/route.ts");
  return {
    calls,
    async checkout(overrides = {}) {
      return route.POST(
        new NextRequest("https://staging.example.invalid/api/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            packageId: "fixture",
            postcode: "EC1V 2NX",
            address: "128 City Road",
            frequency: regular ? "weekly" : "one_time",
            regularVisits: 6,
            saveCardConsent: true,
            legalAccepted: true,
            legalDocuments: ["terms", "cancellation-refund", "privacy"].map(
              (slug) => ({
                slug,
                version: "1.0",
                updatedAt: "2026-10-21T00:00:00Z",
              }),
            ),
            durationMinutes: 120,
            home: { propertyType: "flat", bedrooms: 1, bathrooms: 1 },
            slot: "2026-10-20T09:00:00.000Z",
            optionalSlots: [],
            earlyStartRequested: true,
            addons: ["oven", "fridge"],
            bringsProducts: true,
            petsAtHome: true,
            ...overrides,
          }),
        }),
      );
    },
  };
}
test("new one-off checkout charges in full automatically and saves consent without assigning cleaner pay", async () => {
  const h = harness({ perVisit: true });
  const response = await h.checkout();
  assert.equal(response.status, 200);
  const session = h.calls.sessions[0];
  assert.equal(session.line_items[0].price_data.unit_amount, 8098);
  assert.equal(session.payment_intent_data.capture_method, "automatic");
  assert.equal(session.payment_intent_data.setup_future_usage, "off_session");
  assert.equal(session.payment_intent_data.transfer_data, undefined);
  assert.equal(session.payment_intent_data.metadata.provider_amount, "0");
  assert.equal(h.calls.staged[0].legal_consent_required, true);
  assert.equal(
    h.calls.staged[0].legal_consent_id,
    session.metadata.legal_consent_id,
  );
  assert.equal(
    h.calls.staged[0].cleaning_extras[0].cardConsentVersion,
    "visit-billing-v1",
  );
});
test("checkout cannot create a Stripe session without the required legal tick or valid document versions", async () => {
  for (const overrides of [
    { legalAccepted: false },
    { legalAccepted: undefined },
    { legalDocuments: [] },
    { legalDocuments: [{ slug: "terms", version: "forged" }] },
  ]) {
    const h = harness({ perVisit: true });
    const response = await h.checkout(overrides);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "legal_consent_required");
    assert.equal(h.calls.sessions.length, 0);
  }
});
test("published-version changes block payment and require a fresh tick", async () => {
  const h = harness({ perVisit: true, legalError: true });
  const response = await h.checkout();
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "legal_documents_changed");
  assert.equal(h.calls.sessions.length, 0);
});
test("new regular checkout saves a card without charging, with £5 products on each visit", async () => {
  const h = harness({ perVisit: true, regular: true });
  const response = await h.checkout();
  assert.equal(response.status, 200, JSON.stringify(await response.json()));
  assert.equal(h.calls.sessions[0].mode, "setup");
  assert.equal(h.calls.sessions[0].line_items, undefined);
  assert.equal(h.calls.sessions[0].payment_intent_data, undefined);
  assert.equal(
    h.calls.sessions[0].setup_intent_data.metadata.billing_model,
    "per_visit",
  );
  assert.equal(h.calls.staged[0].cleaning_extras.length, 6);
  for (const scope of h.calls.staged[0].cleaning_extras) {
    assert.equal(scope.netPence, 8098);
    assert.equal(scope.chargeTiming, "acceptance");
    assert.equal(scope.billingSettings.cleanerHourlyPence, 1500);
    assert.equal(
      scope.lineItems.find((line) => line.id === "products").amountPence,
      500,
    );
  }
});
test("regular card consent and an active scheduler are required before new checkout", async () => {
  const h = harness({ perVisit: true, regular: true });
  assert.equal((await h.checkout({ saveCardConsent: false })).status, 400);
  assert.equal(h.calls.sessions.length, 0);
  const stopped = harness({ perVisit: true, ready: false });
  assert.equal((await stopped.checkout()).status, 503);
  assert.equal(stopped.calls.sessions.length, 0);
});
test("checkout prices extras on the server, holds a one-off card and stages full scope", async () => {
  const h = harness();
  const response = await h.checkout();
  assert.equal(response.status, 200, JSON.stringify(await response.json()));
  assert.equal(h.calls.sessions[0].line_items[0].price_data.unit_amount, 8098);
  assert.equal(
    h.calls.sessions[0].payment_intent_data.capture_method,
    "manual",
  );
  assert.equal(
    h.calls.sessions[0].payment_intent_data.transfer_data,
    undefined,
  );
  assert.equal(h.calls.staged[0].cleaning_extras[0].durationMinutes, 240);
  assert.equal(h.calls.staged[0].cleaning_extras[0].petsAtHome, true);
});
test("tampered extras, missing pets and time overruns never create a checkout", async () => {
  for (const overrides of [
    { addons: ["oven", "oven"] },
    { petsAtHome: null },
    { slot: "2026-10-20T17:00:00.000Z" },
    { durationMinutes: 480 },
  ]) {
    const h = harness();
    assert.equal((await h.checkout(overrides)).status, 400);
    assert.equal(h.calls.sessions.length, 0);
  }
});
test("missing migration prevents authorisation; failed staging expires the unpaid checkout", async () => {
  const unready = harness({ ready: false });
  assert.equal((await unready.checkout()).status, 503);
  assert.equal(unready.calls.sessions.length, 0);
  const failed = harness({ stageError: true });
  assert.equal((await failed.checkout()).status, 503);
  assert.deepEqual(failed.calls.expired, ["cs_fixture"]);
});
