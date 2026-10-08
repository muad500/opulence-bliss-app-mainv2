import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import { NextRequest } from "next/server.js";
import { bookingTools } from "./retell-booking-tools.mjs";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
function load(path, mocks = {}, env = {}, cache = new Map()) {
  const filename = resolve(root, path);
  if (cache.has(filename)) return cache.get(filename).exports;
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const testModule = { exports: {} }; cache.set(filename, testModule);
  vm.runInNewContext(compiled, {
    module: testModule, exports: testModule.exports, process: { env }, Buffer, URL, Date, console,
    require: (id) => {
      if (id === "server-only") return {};
      if (id in mocks) return mocks[id];
      if (id.startsWith("@/")) return load(id.slice(2) + ".ts", mocks, env, cache);
      if (id.startsWith(".")) return load(resolve(dirname(filename), id) + ".ts", mocks, env, cache);
      return require(id);
    },
  }, { filename });
  return testModule.exports;
}

const token = "a".repeat(64);
const requestId = "11111111-1111-4111-8111-111111111111";
const slot = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10) + "T09:00:00.000Z";
const args = { confirmed: true, customer_name: "Caller <b>", email: "caller@example.com", phone: "+447912345678", service_id: "one-off", postcode: "SW3 1AA", address: "10 Example Street, London", property_type: "flat", bedrooms: 1, bathrooms: 1, slot, duration_minutes: 120, frequency: "one_time", visits: 1 };
const quote = { service: "One-Time Essential Clean", total_gbp: 45.98, visits: 1, price_per_visit_gbp: 45.98 };

function memoryDb() {
  const tables = { voice_booking_requests: [], bookings: [] };
  let inserts = 0;
  const db = { tables, get inserts() { return inserts; }, from: (name) => {
    let action = "select", patch, filters = [];
    const execute = () => {
      let data = tables[name].filter((row) => filters.every(([key, value]) => row[key] === value));
      if (action === "insert") {
        if (tables[name].some((row) => row.fingerprint === patch.fingerprint)) return { data: null, error: { code: "23505" } };
        inserts++;
        const row = { id: requestId, customer_id: null, email_sent_at: null, checkout_session_id: null, early_start_requested_at: null, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 86400000).toISOString(), ...patch };
        tables[name].push(row); data = [row];
      } else if (action === "update") data.forEach((row) => Object.assign(row, patch));
      return { data, error: null };
    };
    const q = {
      select: () => q, eq: (key, value) => { filters.push([key, value]); return q; },
      is: (key, value) => { filters.push([key, value]); return q; },
      insert: (value) => { action = "insert"; patch = value; return q; },
      update: (value) => { action = "update"; patch = value; return q; },
      single: async () => { const r = execute(); return { ...r, data: r.data?.[0] ?? null }; },
      maybeSingle: async () => { const r = execute(); return { ...r, data: r.data?.[0] ?? null }; },
      then: (yes, no) => Promise.resolve(execute()).then(yes, no),
    }; return q;
  } }; return db;
}

function service(send) {
  return load("lib/voiceBookingServer.ts", {
    "@/lib/assistantBookingServer": { prepareAssistantBooking: async () => quote },
    "@/lib/email": { sendEmail: send },
  }, { NEXT_PUBLIC_SITE_URL: "https://site.example" });
}

test("saved requests do not confirm bookings; repeated and concurrent calls reuse one request/email key", async () => {
  const db = memoryDb(); const sent = [];
  const api = service(async (email) => { sent.push(email); return { ok: true }; });
  const [first, second] = await Promise.all([api.createVoiceRequest(db, "agent", "call_12345678", args), api.createVoiceRequest(db, "agent", "call_12345678", args)]);
  assert.equal(first.request_id, second.request_id);
  assert.equal(db.inserts, 1);
  assert.equal(first.status, "awaiting_payment");
  assert.equal(new Set(sent.map((email) => email.idempotencyKey)).size, 1);
  assert.match(sent[0].body, /Caller &lt;b&gt;/);
  assert.ok(!JSON.stringify(first).includes(db.tables.voice_booking_requests[0].access_token));
  const again = await api.createVoiceRequest(db, "agent", "call_12345678", args);
  assert.equal(again.request_id, first.request_id);
  assert.equal(db.inserts, 1);
});

test("a failed email remains pending and can be retried without another booking request", async () => {
  const db = memoryDb(); let works = false; let sends = 0;
  const api = service(async () => { sends++; return { ok: works }; });
  const first = await api.createVoiceRequest(db, "agent", "call_12345678", args);
  assert.equal(first.email_sent, false); assert.match(first.note, /could not be sent/);
  works = true;
  const second = await api.createVoiceRequest(db, "agent", "call_12345678", args);
  assert.equal(second.email_sent, true); assert.equal(sends, 2); assert.equal(db.inserts, 1);
});

test("status is scoped to the call and confirms only the entire persisted paid booking", async () => {
  const db = memoryDb(); const api = service(async () => ({ ok: true }));
  await api.createVoiceRequest(db, "agent", "call_12345678", args);
  await assert.rejects(api.voiceRequestStatus(db, "agent", "another_call", requestId), /does not belong/);
  assert.equal((await api.voiceRequestStatus(db, "agent", "call_12345678", requestId)).status, "awaiting_payment");
  const row = db.tables.voice_booking_requests[0]; row.customer_id = "customer"; row.checkout_session_id = "cs_test";
  assert.equal((await api.voiceRequestStatus(db, "agent", "call_12345678", requestId)).status, "awaiting_payment");
  row.quote = { ...quote, visits: 6 };
  db.tables.bookings.push({ id: "b1", checkout_session_id: "cs_test", customer_id: "customer" });
  assert.equal((await api.voiceRequestStatus(db, "agent", "call_12345678", requestId)).status, "processing");
  for (let i = 2; i <= 6; i++) db.tables.bookings.push({ id: `b${i}`, checkout_session_id: "cs_test", customer_id: "customer" });
  assert.equal((await api.voiceRequestStatus(db, "agent", "call_12345678", requestId)).status, "confirmed");
  db.tables.bookings[0].status = "cancelled";
  assert.equal((await api.voiceRequestStatus(db, "agent", "call_12345678", requestId)).status, "changed");
});

test("browser checkout refuses anonymous, unverified, wrong-email, unreviewed and cross-origin requests", async () => {
  for (const fixture of [ { user: null }, { user: { id: "u", email: "caller@example.com" } }, { user: { id: "u", email: "other@example.com", email_confirmed_at: "yes" } }, { reviewConfirmed: false }, { origin: "https://other.example" } ]) {
    let started = false;
    const db = memoryDb();
    const server = service(async () => ({ ok: true }));
    await server.createVoiceRequest(db, "agent", "call_12345678", args);
    const row = db.tables.voice_booking_requests[0]; row.access_token = token;
    const { POST } = load("app/api/voice-booking/checkout/route.ts", {
      "@/lib/supabase/server": { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: "user" in fixture ? fixture.user : { id: "u", email: "caller@example.com", email_confirmed_at: "yes" } } }) } }) },
      "@/lib/customerCheckoutServer": { createCustomerCheckout: async () => { started = true; } },
      "@/lib/voiceBookingServer": { voiceBookingAdmin: () => db, voiceRequestByToken: async () => row },
    });
    const response = await POST(new NextRequest("https://site.example/api/voice-booking/checkout", { method: "POST", headers: { origin: fixture.origin ?? "https://site.example", "Content-Type": "application/json" }, body: JSON.stringify({ token, reviewConfirmed: fixture.reviewConfirmed ?? true, earlyStartRequested: true }) }));
    assert.ok(response.status >= 400); assert.equal(started, false);
  }
});

test("browser checkout uses the saved details, remembers the session and resumes without creating another", async () => {
  const db = memoryDb(); const api = service(async () => ({ ok: true }));
  await api.createVoiceRequest(db, "agent", "call_12345678", args);
  const row = db.tables.voice_booking_requests[0]; row.access_token = token;
  let starts = 0; let captured;
  const Stripe = class { checkout = { sessions: { retrieve: async () => ({ id: "cs_test", status: "open", url: "https://checkout.stripe.com/test", client_reference_id: "u" }) } }; };
  const { POST } = load("app/api/voice-booking/checkout/route.ts", {
    stripe: { __esModule: true, default: Stripe },
    "@/lib/supabase/server": { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "u", email: "caller@example.com", email_confirmed_at: "yes" } } }) } }) },
    "@/lib/voiceBookingServer": { voiceBookingAdmin: () => db, voiceRequestByToken: async () => row },
    "@/lib/customerCheckoutServer": { createCustomerCheckout: async (request, options) => { starts++; captured = { body: await request.json(), options }; return Response.json({ url: "https://checkout.stripe.com/test", sessionId: "cs_test" }); } },
  });
  const request = () => new NextRequest("https://site.example/api/voice-booking/checkout", { method: "POST", headers: { origin: "https://site.example", "Content-Type": "application/json" }, body: JSON.stringify({ token, reviewConfirmed: true, earlyStartRequested: true, packageId: "forged", address: "forged" }) });
  assert.equal((await POST(request())).status, 200);
  assert.equal(captured.body.packageId, "one-off");
  assert.equal(captured.body.address, args.address);
  assert.equal(captured.options.expectedTotalPence, 4598);
  assert.equal(captured.options.idempotencyKey, `voice-booking-${requestId}`);
  assert.equal((await POST(request())).status, 200); assert.equal(starts, 1);
});

test("Retell settings contain all four signed POST functions with matching names and bounded parameters", () => {
  const tools = bookingTools("https://site.example");
  assert.equal(tools.length, 4);
  for (const tool of tools) { assert.equal(tool.method, "POST"); assert.equal(tool.args_at_root, false); assert.equal(tool.speak_during_execution, false); assert.equal(tool.url, "https://site.example/api/retell/booking"); }
  assert.ok(tools.find((tool) => tool.name === "create_voice_booking").parameters.required.includes("confirmed"));
});
