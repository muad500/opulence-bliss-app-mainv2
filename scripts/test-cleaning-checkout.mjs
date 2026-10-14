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
} = {}) {
  const calls = { sessions: [], staged: [], expired: [] };
  const db = {
    rpc: async () => ({ data: ready }),
    from(table) {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: () => q,
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
    const module = { exports: {} };
    cache.set(path, module.exports);
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
      if (id === "@/lib/accountBilling")
        return { getOrCreateBillingCustomer: async () => "cus_fixture" };
      if (id.startsWith("@/lib/")) return load("lib/" + id.slice(6) + ".ts");
      if (id.startsWith("./")) return load("lib/" + id.slice(2) + ".ts");
      return require(id);
    };
    class FixtureDate extends Date {
      static now() {
        return Date.UTC(2026, 9, 14, 8);
      }
    }
    vm.runInNewContext(code, {
      module,
      exports: module.exports,
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
    cache.set(path, module.exports);
    return module.exports;
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
  assert.equal(
    h.calls.staged[0].cleaning_extras[0].cardConsentVersion,
    "visit-billing-v1",
  );
});
test("new regular checkout charges the first of six visits only, with £5 products on each visit", async () => {
  const h = harness({ perVisit: true, regular: true });
  const response = await h.checkout();
  assert.equal(response.status, 200, JSON.stringify(await response.json()));
  assert.equal(h.calls.sessions[0].line_items[0].price_data.unit_amount, 8098);
  assert.equal(h.calls.staged[0].cleaning_extras.length, 6);
  for (const scope of h.calls.staged[0].cleaning_extras) {
    assert.equal(scope.netPence, 8098);
    assert.equal(
      scope.lineItems.find((line) => line.id === "products").amountPence,
      500,
    );
  }
});
test("saving-card consent and an active scheduler are required before new checkout", async () => {
  const h = harness({ perVisit: true });
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
