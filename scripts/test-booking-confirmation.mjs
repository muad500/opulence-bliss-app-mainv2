import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
async function confirmation({
  status = "succeeded",
  amount = 4598,
  received = amount,
  metadata = {},
  saved = "1",
  setup = false,
} = {}) {
  const code = ts.transpileModule(
    readFileSync("app/book/success/page.tsx", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    },
  ).outputText;
  const module = { exports: {} };
  const intent = {
    status,
    amount,
    amount_received: received,
    application_fee_amount: 920,
    metadata: {
      package: "One-Time Essential Clean",
      platform_margin: "920",
      provider_amount: "3678",
      ...metadata,
    },
  };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require(id) {
      return id === "stripe"
        ? class {
            checkout = {
              sessions: {
                retrieve: async () => ({
                  mode: setup ? "setup" : "payment",
                  payment_intent: setup ? null : intent,
                  setup_intent: setup ? intent : null,
                }),
              },
            };
          }
        : require(id);
    },
    process: { env: { STRIPE_SECRET_KEY: "sk_test_fixture" } },
    console,
  });
  return renderToStaticMarkup(
    await module.exports.default({
      searchParams: Promise.resolve({ session_id: "cs_fixture", saved }),
    }),
  );
}

test("a paid booking confirmation only shows the customer's actual amount paid", async () => {
  const html = (await confirmation()).replace(/<[^>]*>/g, "");
  assert.match(html, /Amount paid/);
  assert.match(html, /£45.98/);
  assert.match(html, /Payment received/);
  assert.doesNotMatch(
    html,
    /provider will receive|platform|margin|£9.20|£36.78|80%|20%/i,
  );
  assert.doesNotMatch(html, /held, not charged/);
});

test("an uncaptured booking shows the authorised customer total without claiming it was paid", async () => {
  const html = await confirmation({ status: "requires_capture", received: 0 });
  assert.match(html, /Amount authorised/);
  assert.match(html, /£45.98/);
  assert.match(html, /held, not charged/);
  assert.doesNotMatch(
    html,
    /Amount paid|provider will receive|platform keeps/i,
  );
});

test("upfront plans and first-only regular payments accurately describe the amount collected", async () => {
  const upfront = await confirmation({
    amount: 22788,
    metadata: { upfront_regular: "1", regular_visit_count: "6" },
  });
  assert.match(upfront, /£227.88/);
  assert.match(upfront, /all 6 visits are booked and paid upfront/);
  const first = await confirmation({
    amount: 3798,
    metadata: {
      upfront_regular: "1",
      regular_visit_count: "6",
      billing_model: "per_visit",
    },
  });
  assert.match(first, /First visit paid/);
  assert.match(first, /£37.98/);
  assert.match(first, /Each later visit is charged 48 hours/);
  assert.doesNotMatch(first, /all 6 visits are booked and paid upfront/);
});

test("a partial capture displays money actually received and failed payments show no payable amount", async () => {
  const partial = await confirmation({ received: 3000 });
  assert.match(partial, /£30.00/);
  assert.doesNotMatch(partial, /£45.98/);
  const failed = await confirmation({
    status: "requires_payment_method",
    received: 0,
  });
  assert.doesNotMatch(
    failed,
    /Amount paid|Amount authorised|£45.98|provider|platform/i,
  );
});

test("new regular confirmation saves the card and states zero paid today", async () => {
  const html = await confirmation({
    setup: true,
    metadata: {
      upfront_regular: "1",
      regular_visit_count: "6",
      billing_model: "per_visit",
    },
  });
  assert.match(html, /Card saved/);
  assert.match(html, /Amount paid today/);
  assert.match(html, /£0.00/);
  assert.match(html, /Each visit is charged when a cleaner accepts/);
  assert.doesNotMatch(html, /first visit is paid|48 hours|card is held/);
});
