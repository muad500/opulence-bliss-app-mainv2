import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
const native = createRequire(import.meta.url);
function compile(file, require, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
    { module, exports: module.exports, require, ...globals },
  );
  return module.exports;
}
const copy = compile("lib/cleaningPaymentCopy.ts", native);
const policyGuidance = compile("lib/cleaningPolicyGuidance.ts", native);
function harness({ embeddingFails = false, writeFails = false } = {}) {
  const state = { embeddings: 0, writes: [], deletes: 0 };
  const db = {
    from(table) {
      if (table === "packages")
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          order: async () => ({
            data: [
              {
                name: "Essential Clean",
                price: 37.98,
                duration_minutes: 120,
                service_type: "clean",
                billing_type: "per_visit",
              },
            ],
          }),
        };
      assert.equal(table, "ai_docs");
      return {
        select() {
          return this;
        },
        in: async () => ({
          data: [
            { id: "existing-payment-document", title: "How payment works" },
          ],
        }),
        delete() {
          state.deletes++;
          throw Error("Must never delete existing knowledge");
        },
        upsert: async (rows) => {
          state.writes.push(rows);
          return { error: writeFails ? { message: "offline" } : null };
        },
      };
    },
  };
  const route = compile(
    "app/api/ai/seed/route.ts",
    (id) =>
      id === "@/lib/cleaningPolicyGuidance"
        ? policyGuidance
        : id === "@/lib/cleaningPaymentCopy"
          ? copy
          : id === "next/server"
            ? { NextResponse: { json: Response.json } }
            : id === "@supabase/supabase-js"
              ? { createClient: () => db }
              : native(id),
    {
      process: {
        env: {
          CRON_SECRET: "fixture-cron",
          GEMINI_API_KEY: "fixture-embedding",
          NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
          SUPABASE_SERVICE_ROLE_KEY: "fixture",
        },
      },
      fetch: async (url, options) => {
        state.embeddings++;
        assert.ok(
          !url.includes("fixture-embedding"),
          "No key in embedding URL",
        );
        assert.equal(options.headers["x-goog-api-key"], "fixture-embedding");
        return embeddingFails
          ? { ok: false, status: 503 }
          : {
              ok: true,
              json: async () => ({
                embedding: { values: Array(768).fill(0.1) },
              }),
            };
      },
    },
  );
  const req = (auth) => ({
    nextUrl: new URL("https://example.invalid/api/ai/seed"),
    headers: new Headers(auth ? { Authorization: "Bearer fixture-cron" } : {}),
  });
  return { route, state, req };
}
test("new regular checkout contract remains setup-only with acceptance timing for every visit", () => {
  const source = readFileSync("app/api/checkout/route.ts", "utf8");
  assert.match(source, /const saveRegularCard = perVisit && regular/);
  assert.match(source, /mode: saveRegularCard \? "setup" : "payment"/);
  assert.match(
    source,
    /chargeTiming: regular \? "acceptance" : "checkout_then_48h"/,
  );
  const sql = readFileSync(
    "supabase/migrations/20261018001000_cleaning_pay_and_booking_terms.sql",
    "utf8",
  );
  assert.match(
    sql,
    /Preserve the 48h model for old bookings; new regular visits become due on assignment/,
  );
});
test("seed requires the existing secret and makes no requests when unauthorised", async () => {
  const h = harness();
  assert.equal((await h.route.POST(h.req(false))).status, 401);
  assert.equal(h.state.embeddings, 0);
  assert.equal(h.state.writes.length, 0);
});
test("reseed embeds all documents then atomically upserts accurate payment knowledge, retaining IDs", async () => {
  const h = harness(),
    res = await h.route.POST(h.req(true));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(h.state.writes.length, 1);
  const rows = h.state.writes[0];
  assert.equal(body.documents, rows.length);
  assert.equal(h.state.embeddings, rows.length);
  assert.equal(h.state.deletes, 0);
  const payment = rows.find((r) => r.title === "How payment works");
  assert.equal(payment.id, "existing-payment-document");
  assert.ok(payment.content.includes(copy.ONE_OFF_PAYMENT_COPY));
  assert.ok(payment.content.includes(copy.REGULAR_PAYMENT_COPY));
  assert.ok(payment.content.includes(copy.LEGACY_SCHEDULED_VISIT_PAYMENT_COPY));
  for (const row of rows.filter((r) =>
    [
      "What happens on the day",
      "How providers get paid",
      "Provider availability and offers",
    ].includes(r.title),
  ))
    assert.doesNotMatch(
      row.content,
      /card is charged.*check|captures the authorised|client is not charged$/i,
    );
});
test("embedding outage preserves the existing knowledge and never reports success", async () => {
  const h = harness({ embeddingFails: true }),
    res = await h.route.POST(h.req(true));
  assert.equal(res.status, 500);
  assert.equal(h.state.writes.length, 0);
  assert.equal(h.state.deletes, 0);
});
test("database upsert failure returns an error rather than a false reseed success", async () => {
  const h = harness({ writeFails: true }),
    res = await h.route.POST(h.req(true));
  assert.equal(res.status, 500);
  assert.equal(h.state.deletes, 0);
  assert.ok(!(await res.json()).ok);
});
