import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { NextRequest, NextResponse } = require("next/server");
const Stripe = require("stripe");
const signatureStripe = new Stripe("sk_test_webhook_contract");
const secret = "whsec_handyman_contract";
const sources = new Map();
for (const path of [
  "app/api/stripe/webhook/route.ts",
  "lib/handymanWebhook.ts",
]) {
  sources.set(
    path,
    ts.transpileModule(await readFile(path, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
  );
}
function harness({
  enabled = true,
  kind = "booking",
  failReview = false,
} = {}) {
  const calls = {
    charge: 0,
    intent: 0,
    review: 0,
    cleaning: 0,
    quote: 0,
    legacy: 0,
  };
  const admin = {
    from() {
      throw Error("Unrelated event accessed marketplace database");
    },
  };
  const stripe = {
    webhooks: signatureStripe.webhooks,
    charges: {
      async retrieve(id) {
        calls.charge++;
        return {
          id,
          livemode: false,
          metadata: {},
          payment_intent: { metadata: { kind } },
        };
      },
    },
    paymentIntents: {
      async retrieve(id) {
        calls.intent++;
        return { id, metadata: { kind } };
      },
    },
  };
  function load(path) {
    const module = { exports: {} };
    vm.runInNewContext(sources.get(path), {
      exports: module.exports,
      module,
      process: {
        env: {
          STRIPE_SECRET_KEY: "sk_test_contract",
          STRIPE_WEBHOOK_SECRET: secret,
        },
      },
      console: { log() {}, error() {} },
      require(id) {
        if (id === "server-only") return {};
        if (id === "next/server") return { NextRequest, NextResponse };
        if (id === "stripe")
          return function () {
            return stripe;
          };
        if (id === "@supabase/supabase-js")
          return { createClient: () => admin };
        if (id.endsWith("handymanMarketplace"))
          return { handymanEnabled: () => enabled };
        if (id.endsWith("handymanWebhook"))
          return load("lib/handymanWebhook.ts");
        if (id.endsWith("handymanQuoteServer"))
          return {
            async reviewHandymanQuoteDispute() {
              calls.review++;
              if (failReview) throw Error("Relevant dispute must retry");
            },
            async finalizeHandymanQuoteCheckout() {
              calls.quote++;
            },
          };
        if (id.endsWith("handymanServer"))
          return {
            async finalizeHandymanCheckout() {
              calls.legacy++;
            },
          };
        if (id.endsWith("finalizeCustomerCheckout"))
          return {
            async finalizeCustomerCheckout() {
              calls.cleaning++;
            },
          };
        if (id.endsWith("finalizeTipCheckout"))
          return {
            async finalizeTipCheckout() {
              calls.cleaning++;
            },
          };
        if (id.endsWith("accountSecurityAlerts"))
          return { stripePayoutAccountChanged: () => false };
        if (id.endsWith("subscriptions")) return {};
        if (id.endsWith("finalizePerVisitCheckout")) return {};
        if (id.endsWith("visitBillingServer")) return {};
        throw Error("Unexpected module " + id);
      },
    });
    return module.exports;
  }
  const route = load("app/api/stripe/webhook/route.ts");
  return {
    calls,
    async send(type, object, validSignature = true) {
      const payload = JSON.stringify({
        id: "evt_test",
        object: "event",
        type,
        data: { object },
      });
      const signature = signatureStripe.webhooks.generateTestHeaderString({
        payload,
        secret,
      });
      return route.POST(
        new NextRequest("https://staging.invalid/api/stripe/webhook", {
          method: "POST",
          body: payload,
          headers: {
            "stripe-signature": validSignature ? signature : "invalid",
          },
        }),
      );
    },
  };
}
for (const enabled of [true, false]) {
  for (const kind of ["booking", "visit_charge", "tip", "unrelated"]) {
    test(`cleaning/unrelated dispute (${kind}), marketplace ${enabled}: 200 without handyman storage`, async () => {
      const h = harness({ enabled, kind });
      assert.equal(
        (
          await h.send("charge.dispute.created", {
            charge: "ch_cleaning",
            livemode: false,
          })
        ).status,
        200,
      );
      assert.equal(h.calls.review, 0);
      assert.equal(h.calls.charge, enabled ? 1 : 0);
    });
  }
  for (const kind of ["booking", "tip"]) {
    test(`cleaning checkout still finalises, marketplace ${enabled}, kind ${kind}`, async () => {
      const h = harness({ enabled, kind });
      assert.equal(
        (
          await h.send("checkout.session.completed", {
            mode: "payment",
            client_reference_id: "booking",
            payment_intent: "pi_cleaning",
            metadata: { kind },
          })
        ).status,
        200,
      );
      assert.equal(h.calls.cleaning, 1);
      assert.equal(h.calls.quote + h.calls.legacy + h.calls.review, 0);
    });
  }
}
for (const kind of ["handyman", "handyman_quote"]) {
  test(`disabled ${kind} checkout is 200 without any Stripe or database calls`, async () => {
    const h = harness({ enabled: false, kind });
    assert.equal(
      (
        await h.send("checkout.session.completed", {
          mode: "payment",
          client_reference_id: "job",
          payment_intent: "pi_job",
          metadata: { kind },
        })
      ).status,
      200,
    );
    assert.deepEqual(Object.values(h.calls), [0, 0, 0, 0, 0, 0]);
  });
  test(`disabled ${kind} intent is 200 without retrieving it`, async () => {
    const h = harness({ enabled: false, kind });
    assert.equal(
      (
        await h.send("payment_intent.succeeded", {
          id: "pi_job",
          metadata: { kind },
        })
      ).status,
      200,
    );
    assert.equal(h.calls.intent, 0);
  });
}
test("disabled marketplace ignores quote disputes, including missing charge objects", async () => {
  const h = harness({
    enabled: false,
    kind: "handyman_quote",
    failReview: true,
  });
  for (const object of [{ charge: "ch_quote" }, { charge: null }, {}]) {
    assert.equal((await h.send("charge.dispute.created", object)).status, 200);
  }
  assert.equal(h.calls.charge + h.calls.review, 0);
});
test("enabled quote dispute opens the resolution case; relevant errors request a retry", async () => {
  for (const failReview of [false, true]) {
    const h = harness({ kind: "handyman_quote", failReview });
    assert.equal(
      (
        await h.send("charge.dispute.created", {
          charge: "ch_quote",
          livemode: false,
        })
      ).status,
      failReview ? 500 : 200,
    );
    assert.equal(h.calls.review, 1);
  }
});
test("quote checkout routes only to its finaliser", async () => {
  const h = harness({ kind: "handyman_quote" });
  assert.equal(
    (
      await h.send("checkout.session.completed", {
        mode: "payment",
        client_reference_id: "job",
        payment_intent: "pi_quote",
        metadata: { kind: "handyman_quote" },
      })
    ).status,
    200,
  );
  assert.equal(h.calls.quote, 1);
  assert.equal(h.calls.cleaning + h.calls.legacy, 0);
});
test("unrelated valid events are acknowledged; invalid signatures remain rejected", async () => {
  const h = harness();
  assert.equal(
    (await h.send("charge.updated", { id: "ch_unrelated" })).status,
    200,
  );
  assert.equal((await h.send("charge.dispute.created", {}, false)).status, 400);
});
