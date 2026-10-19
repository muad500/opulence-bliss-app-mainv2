import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import { createRequire } from "node:module";
const nativeRequire = createRequire(import.meta.url);
const { NextRequest, NextResponse } = nativeRequire("next/server");
const code = ts.transpileModule(
  await readFile(
    new URL("../lib/handymanQuoteServer.ts", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  },
).outputText;
function harness(kind = "charge") {
  const job = {
    id: "job",
    customer_id: "customer",
    provider_id: "provider",
    quote_mode: true,
    status: kind === "transfer" ? "payment_pending" : "checkout_pending",
    payout_account_id: "acct_own",
    total_pence: 12500,
    paid_pence: 0,
    refunded_pence: 0,
  };
  const op = {
    id: "op",
    job_id: "job",
    quote_id: "quote",
    kind,
    amount_pence: kind === "transfer" ? 10000 : 12500,
    status: "queued",
    operation_key: "accept:quote",
    parameters: null,
    session_id: null,
    payment_intent: null,
    charge_id: null,
    stripe_ref: null,
    source_id: kind === "charge" ? null : "source",
    claim_token: null,
  };
  const source = {
    id: "source",
    job_id: "job",
    kind: kind === "reversal" ? "transfer" : "charge",
    status: "succeeded",
    payment_intent: "pi_source",
    charge_id: "ch_source",
    stripe_ref: "tr_source",
    amount_pence: 12500,
  };
  const provider = {
    id: "provider",
    profile_id: "worker",
    stripe_account_id: "acct_own",
  };
  const tables = {
    handyman_jobs: [job],
    handyman_quote_operations: [op, source],
    providers: [provider],
    handyman_invitations: [],
  };
  const calls = { create: 0, transfer: 0, refund: 0, reversal: 0, rpc: [] };
  const sessions = [],
    transfers = [],
    refunds = [],
    reversals = [],
    intents = new Map();
  let loseCreate = false,
    loseAck = false,
    enabled = true;
  class Query {
    constructor(rows) {
      this.rows = rows;
      this.filters = [];
    }
    select() {
      return this;
    }
    eq(k, v) {
      this.filters.push((r) => r[k] === v);
      return this;
    }
    in(k, v) {
      this.filters.push((r) => v.includes(r[k]));
      return this;
    }
    order() {
      return this;
    }
    limit() {
      return this;
    }
    get() {
      return this.rows.filter((r) => this.filters.every((f) => f(r)));
    }
    async single() {
      const rows = this.get();
      return {
        data: rows[0] ?? null,
        error: rows.length === 1 ? null : Error("missing"),
      };
    }
    async maybeSingle() {
      const rows = this.get();
      return {
        data: rows[0] ?? null,
        error: rows.length > 1 ? Error("multiple rows") : null,
      };
    }
    then(resolve, reject) {
      return Promise.resolve({ data: this.get(), error: null }).then(
        resolve,
        reject,
      );
    }
  }
  const admin = {
    from: (name) => new Query(tables[name] ?? []),
    async rpc(name, p) {
      calls.rpc.push({ name, p });
      const row = tables.handyman_quote_operations.find((o) => o.id === p.p_id);
      if (name === "handyman_claim_operation") {
        if (row.status === "processing")
          return { data: null, error: Error("leased") };
        row.parameters ??= p.p_parameters;
        row.status = "processing";
        row.claim_token = "token";
        return { data: structuredClone(row), error: null };
      }
      if (name === "handyman_record_operation") {
        if (loseAck && p.p_status === "succeeded") {
          loseAck = false;
          return { data: null, error: Error("lost database response") };
        }
        if (row.claim_token !== p.p_token)
          return { data: null, error: Error("wrong token") };
        row.status = p.p_status;
        row.claim_token = null;
        row.last_error = p.p_error;
        if (
          row.kind === "charge" &&
          ["pending", "succeeded"].includes(p.p_status)
        )
          row.session_id = p.p_ref;
        if (p.p_status === "succeeded") {
          row.stripe_ref = p.p_ref;
          row.payment_intent = p.p_intent;
          row.charge_id = p.p_charge;
        }
        return { data: null, error: null };
      }
      if (name === "handyman_quote_eligible")
        return { data: true, error: null };
      if (name === "handyman_stripe_review") {
        job.status = "disputed";
        return { data: null, error: null };
      }
      throw Error("unexpected RPC " + name);
    },
  };
  const stripe = {
    charges: {
      async retrieve() {
        return {
          payment_intent: source.payment_intent,
          amount: source.amount_pence,
          paid: true,
          captured: true,
          currency: "gbp",
          livemode: false,
          disputed: false,
          amount_refunded: 0,
        };
      },
    },
    accounts: {
      async retrieve() {
        return { capabilities: { transfers: "active" } };
      },
    },
    checkout: {
      sessions: {
        async *list() {
          yield* sessions;
        },
        async retrieve(id) {
          return sessions.find((s) => s.id === id);
        },
        async create(p) {
          calls.create++;
          const s = {
            id: "cs_" + calls.create,
            status: "open",
            payment_status: "unpaid",
            mode: "payment",
            livemode: false,
            customer: p.customer,
            client_reference_id: p.client_reference_id,
            metadata: p.metadata,
            url: "https://checkout.stripe.test/session",
          };
          sessions.push(s);
          if (loseCreate) {
            loseCreate = false;
            throw Error("lost create response");
          }
          return s;
        },
        async expire(id) {
          const s = sessions.find((s) => s.id === id);
          s.status = "expired";
          return s;
        },
      },
    },
    paymentIntents: {
      async retrieve(id) {
        return intents.get(id);
      },
    },
    refunds: {
      async *list() {
        yield* refunds;
      },
      async create(p) {
        calls.refund++;
        const r = {
          id: "re_" + calls.refund,
          status: "succeeded",
          amount: p.amount,
          currency: "gbp",
          payment_intent: p.payment_intent,
          metadata: p.metadata,
        };
        refunds.push(r);
        return r;
      },
    },
    transfers: {
      async *list() {
        yield* transfers;
      },
      async create(p) {
        calls.transfer++;
        const t = {
          id: "tr_" + calls.transfer,
          ...p,
          reversed: false,
          amount_reversed: 0,
        };
        transfers.push(t);
        return t;
      },
      async *listReversals() {
        yield* reversals;
      },
      async createReversal(id, p) {
        calls.reversal++;
        const r = {
          id: "trr_" + calls.reversal,
          amount: p.amount,
          metadata: p.metadata,
        };
        reversals.push(r);
        return r;
      },
    },
  };
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    process,
    fetch,
    AbortSignal,
    console,
    require(name) {
      if (name === "server-only") return {};
      if (name === "./accountBilling")
        return { getOrCreateBillingCustomer: async () => "cus_own" };
      if (name === "./handymanMarketplace")
        return { handymanEnabled: () => enabled };
      throw Error("unexpected import " + name);
    },
  });
  const checkout = {
    user: { id: "customer" },
    origin: "https://staging.example.invalid",
  };
  function paid() {
    const s = sessions[0];
    s.status = "complete";
    s.payment_status = "paid";
    s.payment_intent = "pi_paid";
    const pi = {
      id: "pi_paid",
      status: "succeeded",
      capture_method: "automatic",
      livemode: false,
      transfer_group: "handyman_quote_job",
      amount: op.amount_pence,
      amount_received: op.amount_pence,
      currency: "gbp",
      customer: "cus_own",
      metadata: { ...s.metadata },
      latest_charge: "ch_paid",
    };
    intents.set(pi.id, pi);
    return pi;
  }
  return {
    job,
    tables,
    op,
    source,
    provider,
    calls,
    sessions,
    transfers,
    refunds,
    stripe,
    admin,
    exports,
    checkout,
    paid,
    loseCreate() {
      loseCreate = true;
    },
    loseAck() {
      loseAck = true;
    },
    disable() {
      enabled = false;
    },
  };
}
test("quote checkout charges only the accepted fixed total; no hold, VAT or destination charge", async () => {
  const h = harness();
  const r = await h.exports.processHandymanQuoteOperation(
    h.admin,
    h.stripe,
    "op",
    h.checkout,
  );
  assert.ok(r.url);
  assert.equal(h.op.parameters.line_items[0].price_data.unit_amount, 12500);
  assert.equal(h.op.parameters.payment_intent_data.capture_method, "automatic");
  assert.equal(h.op.parameters.payment_intent_data.transfer_data, undefined);
  assert.equal(
    h.op.parameters.payment_intent_data.application_fee_amount,
    undefined,
  );
  assert.equal(h.calls.transfer, 0);
});
test("unknown create response reconciles the old session, even without an idempotency cache", async () => {
  const h = harness();
  h.loseCreate();
  await assert.rejects(() =>
    h.exports.processHandymanQuoteOperation(
      h.admin,
      h.stripe,
      "op",
      h.checkout,
    ),
  );
  await h.exports.processHandymanQuoteOperation(
    h.admin,
    h.stripe,
    "op",
    h.checkout,
  );
  assert.equal(h.calls.create, 1);
});
test("webhook accepts server-verified paid totals once and rejects forged ownership", async () => {
  const h = harness();
  await h.exports.processHandymanQuoteOperation(
    h.admin,
    h.stripe,
    "op",
    h.checkout,
  );
  const pi = h.paid();
  await h.exports.finalizeHandymanQuoteCheckout(
    h.admin,
    h.stripe,
    h.sessions[0],
    pi,
  );
  const acknowledgements = h.calls.rpc.filter(
    (c) =>
      c.name === "handyman_record_operation" && c.p.p_status === "succeeded",
  ).length;
  await h.exports.finalizeHandymanQuoteCheckout(
    h.admin,
    h.stripe,
    h.sessions[0],
    pi,
  );
  assert.equal(
    h.calls.rpc.filter(
      (c) =>
        c.name === "handyman_record_operation" && c.p.p_status === "succeeded",
    ).length,
    acknowledgements,
  );
  h.sessions[0].client_reference_id = "somebody_else";
  await assert.rejects(() =>
    h.exports.finalizeHandymanQuoteCheckout(
      h.admin,
      h.stripe,
      h.sessions[0],
      pi,
    ),
  );
});
test("wrong amount, currency, destination or unpaid status cannot finalise", async () => {
  for (const change of [
    { amount: 1 },
    { currency: "eur" },
    { transfer_data: { destination: "acct_test" } },
    { capture_method: "manual" },
    { status: "requires_payment_method" },
  ]) {
    const h = harness();
    await h.exports.processHandymanQuoteOperation(
      h.admin,
      h.stripe,
      "op",
      h.checkout,
    );
    const pi = { ...h.paid(), ...change };
    await assert.rejects(() =>
      h.exports.finalizeHandymanQuoteCheckout(
        h.admin,
        h.stripe,
        h.sessions[0],
        pi,
      ),
    );
    assert.notEqual(h.op.status, "succeeded");
  }
});
test("cancellation expires open checkout and never creates a replacement", async () => {
  const h = harness();
  await h.exports.processHandymanQuoteOperation(
    h.admin,
    h.stripe,
    "op",
    h.checkout,
  );
  h.job.status = "cancel_pending";
  await h.exports.processHandymanQuoteOperation(h.admin, h.stripe, "op");
  assert.equal(h.op.status, "expired");
  assert.equal(h.calls.create, 1);
});
test("a payment racing cancellation is recorded, not silently lost or charged twice", async () => {
  const h = harness();
  await h.exports.processHandymanQuoteOperation(
    h.admin,
    h.stripe,
    "op",
    h.checkout,
  );
  h.paid();
  h.job.status = "cancel_pending";
  await h.exports.processHandymanQuoteOperation(h.admin, h.stripe, "op");
  assert.equal(h.op.status, "succeeded");
  assert.equal(h.calls.create, 1);
});
test("payout uses only the assigned own account and captured source charge", async () => {
  const h = harness("transfer");
  await h.exports.processHandymanQuoteOperation(h.admin, h.stripe, "op");
  assert.equal(h.transfers[0].destination, "acct_own");
  assert.equal(h.transfers[0].source_transaction, "ch_source");
  assert.equal(h.transfers[0].amount, 10000);
});
test("unknown successful transfer reconciles after database acknowledgement failure", async () => {
  const h = harness("transfer");
  h.loseAck();
  await assert.rejects(() =>
    h.exports.processHandymanQuoteOperation(h.admin, h.stripe, "op"),
  );
  await h.exports.processHandymanQuoteOperation(h.admin, h.stripe, "op");
  assert.equal(h.calls.transfer, 1);
  assert.equal(h.op.status, "succeeded");
});
test("missing or changed connected account holds payout without any test fallback", async () => {
  for (const account of [null, "acct_different"]) {
    const h = harness("transfer");
    h.provider.stripe_account_id = account;
    await assert.rejects(
      () => h.exports.processHandymanQuoteOperation(h.admin, h.stripe, "op"),
      /Provider payout account is not configured/,
    );
    assert.equal(h.calls.transfer, 0);
    assert.equal(h.op.last_error, "Provider payout account is not configured");
  }
});
test("refund and transfer reversals reconcile once rather than double-returning money", async () => {
  for (const kind of ["refund", "reversal"]) {
    const h = harness(kind);
    h.loseAck();
    await assert.rejects(() =>
      h.exports.processHandymanQuoteOperation(h.admin, h.stripe, "op"),
    );
    await h.exports.processHandymanQuoteOperation(h.admin, h.stripe, "op");
    assert.equal(h.calls[kind], 1);
    assert.equal(h.op.status, "succeeded");
  }
});
test("disabled marketplace fails before using financial APIs", async () => {
  const h = harness();
  h.disable();
  await assert.rejects(
    () =>
      h.exports.processHandymanQuoteOperation(
        h.admin,
        h.stripe,
        "op",
        h.checkout,
      ),
    /disabled/,
  );
  assert.equal(h.calls.create, 0);
});
test("payment-free drafts do not start background card checkouts", async () => {
  const h = harness();
  await h.exports.processHandymanQuoteOperation(h.admin, h.stripe, "op");
  assert.equal(h.calls.create, 0);
  assert.equal(h.calls.rpc.length, 0);
});

test("private requests are visible only to their owner, assigned professional or currently invited eligible professional", async () => {
  const h = harness();
  h.job.status = "posted";
  assert.equal(
    await h.exports.accessibleQuoteJob(h.admin, "job", "stranger", "uninvited"),
    null,
  );
  assert.equal(
    (await h.exports.accessibleQuoteJob(h.admin, "job", "customer", null)).id,
    "job",
  );
  h.tables.handyman_invitations.push({
    job_id: "job",
    provider_id: "invited",
    notified_at: "2026-10-20",
    outcome: "offered",
  });
  assert.equal(
    (
      await h.exports.accessibleQuoteJob(
        h.admin,
        "job",
        "other_worker",
        "invited",
      )
    ).id,
    "job",
  );
  h.tables.handyman_invitations[0].outcome = "lost";
  assert.equal(
    await h.exports.accessibleQuoteJob(
      h.admin,
      "job",
      "other_worker",
      "invited",
    ),
    null,
  );
});
test("a disputed payment can reconcile an existing transfer, but cannot create another", async () => {
  const h = harness("transfer");
  h.loseAck();
  await assert.rejects(() =>
    h.exports.processHandymanQuoteOperation(h.admin, h.stripe, "op"),
  );
  h.job.status = "disputed";
  await h.exports.processHandymanQuoteOperation(h.admin, h.stripe, "op");
  assert.equal(h.calls.transfer, 1);
  const empty = harness("transfer");
  empty.job.status = "disputed";
  empty.op.status = "held";
  await assert.rejects(
    () =>
      empty.exports.processHandymanQuoteOperation(
        empty.admin,
        empty.stripe,
        "op",
      ),
    /Reconcile/,
  );
  assert.equal(empty.calls.transfer, 0);
});
test("a live-mode payment is refused even if a preview is misconfigured", async () => {
  const h = harness();
  await h.exports.processHandymanQuoteOperation(
    h.admin,
    h.stripe,
    "op",
    h.checkout,
  );
  const pi = h.paid();
  pi.livemode = true;
  await assert.rejects(() =>
    h.exports.finalizeHandymanQuoteCheckout(
      h.admin,
      h.stripe,
      h.sessions[0],
      pi,
    ),
  );
  assert.notEqual(h.op.status, "succeeded");
});
test("card disputes and out-of-band refunds hold new payouts for admin review", async () => {
  for (const fields of [{ disputed: true }, { amount_refunded: 1 }]) {
    const h = harness("transfer");
    const original = h.stripe.charges.retrieve;
    h.stripe.charges.retrieve = async () => ({
      ...(await original()),
      ...fields,
    });
    await assert.rejects(
      () => h.exports.processHandymanQuoteOperation(h.admin, h.stripe, "op"),
      /admin review/,
    );
    assert.equal(h.calls.transfer, 0);
    assert.equal(h.job.status, "disputed");
  }
});
test("quote detail renders fixed totals, material scope, consent and explicit revision approval", async () => {
  const React = nativeRequire("react"),
    { renderToStaticMarkup } = nativeRequire("react-dom/server");
  const source = await readFile(
    new URL("../components/HandymanJobDetail.tsx", import.meta.url),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  let data = {
    job: {
      id: "job",
      task_name: "Furniture assembly",
      description: "Assemble the bookcase",
      postcode: "E14 1AA",
      address: "",
      preferred_dates: ["2026-10-25"],
      status: "posted",
      selected_quote_id: null,
      total_pence: 0,
      paid_pence: 0,
      refunded_pence: 0,
    },
    role: "customer",
    quotes: [
      {
        id: "quote",
        kind: "quote",
        status: "sent",
        display_name: "Synthetic professional",
        scope: "Bookcase assembly including all timber and fixings",
        total_pence: 12500,
        duration_minutes: 120,
        earliest_at: "2026-10-25T10:00:00Z",
      },
    ],
    files: [],
    visits: [],
    operations: [],
    review: null,
    termsVersion: "2026-09-28",
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    console,
    Intl,
    Date,
    require(name) {
      if (name === "react")
        return {
          ...React,
          useState: (init) => [init === null ? data : init, () => {}],
          useEffect: () => {},
          useCallback: (fn) => fn,
        };
      if (name === "next/link")
        return {
          __esModule: true,
          default: ({ children, ...props }) =>
            React.createElement("a", props, children),
        };
      if (name === "next/image")
        return { __esModule: true, default: () => null };
      if (name === "@/lib/handymanMarketplace")
        return { handymanTaskLabel: (v) => v };
      if (name === "@/lib/handymanQuotes")
        return { handymanMoney: (v) => "£" + (v / 100).toFixed(2) };
      if (name.endsWith(".module.css"))
        return {
          __esModule: true,
          default: new Proxy({}, { get: (_, p) => String(p) }),
        };
      return nativeRequire(name);
    },
  });
  const render = () =>
    renderToStaticMarkup(
      React.createElement(exports.default, { id: "job", portal: "customer" }),
    );
  const posted = render();
  assert.match(posted, /£125.00 total, including materials/);
  assert.match(posted, /Accept quote &amp; pay/);
  assert.match(posted, /Handyman Terms/);
  assert.match(posted, /disabled=""/);
  assert.doesNotMatch(posted, /name="hourly/);
  data = {
    ...data,
    job: { ...data.job, status: "in_progress", selected_quote_id: "old" },
    quotes: [{ ...data.quotes[0], kind: "revision" }],
  };
  assert.match(render(), /Approve revised quote/);
});
async function api(path, mocks) {
  const module = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(
      await readFile(new URL("../" + path, import.meta.url), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true,
        },
      },
    ).outputText,
    {
      module,
      exports: module.exports,
      process,
      console,
      crypto,
      require(name) {
        if (name in mocks) return mocks[name];
        if (name === "next/server") return { NextRequest, NextResponse };
        throw Error("unexpected route import " + name);
      },
    },
  );
  return module.exports;
}
test("job posting rejects client-supplied prices and identities before any write", async () => {
  let writes = 0,
    mutating = false;
  const route = await api("app/api/handyman/jobs/route.ts", {
    "@/lib/handymanServer": {
      handymanContext: async (_r, mutation) => {
        mutating = mutation;
        return { user: { id: "signed_in_customer" } };
      },
      isAccountError: (v) => v instanceof NextResponse,
    },
    "@/lib/accountApi": { readAccountBody: async (r) => r.json() },
    "@/lib/handymanQuotes": {
      handymanPostcode: (v) => v,
      handymanPreferredDates: (v) => v,
    },
    "@/lib/handymanMarketplace": { regulatedHandymanDescription: () => false },
    "@/lib/handymanQuoteServer": {
      handymanRpc: async () => {
        writes++;
        return { id: "job", status: "draft" };
      },
    },
  });
  for (const extra of [
    { price: 1 },
    { providerId: "self" },
    { hourlyRate: 0 },
    { customerId: "another" },
  ]) {
    const r = await route.POST(
      new NextRequest("https://staging.example.invalid/api/handyman/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestKey: "00000000-0000-0000-0000-000000000001",
          task: "Furniture assembly",
          description: "Assemble furniture safely",
          postcode: "E14 1AA",
          preferredDates: ["2026-10-25"],
          ...extra,
        }),
      }),
    );
    assert.equal(r.status, 400);
  }
  assert.equal(writes, 0);
  assert.equal(mutating, true);
});
test("unauthenticated job posting and unapproved quote invitations are denied", async () => {
  const denied = await api("app/api/handyman/jobs/route.ts", {
    "@/lib/handymanServer": {
      handymanContext: async () =>
        NextResponse.json({ error: "Sign in" }, { status: 401 }),
      isAccountError: (v) => v instanceof NextResponse,
    },
    "@/lib/accountApi": {},
    "@/lib/handymanQuotes": {},
    "@/lib/handymanMarketplace": {},
    "@/lib/handymanQuoteServer": {},
  });
  assert.equal(
    (
      await denied.POST(
        new NextRequest("https://staging.example.invalid/api/handyman/jobs", {
          method: "POST",
        }),
      )
    ).status,
    401,
  );
  const pending = await api("app/api/handyman/offers/route.ts", {
    "@/lib/handymanServer": {
      handymanContext: async () => ({
        providerId: "pending",
        professionalApproved: false,
      }),
      isAccountError: () => false,
    },
    "@/lib/handymanQuoteServer": {},
  });
  assert.equal(
    (
      await pending.GET(
        new NextRequest("https://staging.example.invalid/api/handyman/offers"),
      )
    ).status,
    403,
  );
});
test("staff MFA guard runs before any admin evidence, settings or financial access; disabled feature returns 404", async () => {
  let enabled = true,
    guards = 0;
  const route = await api("app/api/handyman/admin/route.ts", {
    "@/lib/adminApi": {
      adminApi: async () => {
        guards++;
        return NextResponse.json(
          { error: "Authenticator required" },
          { status: 403 },
        );
      },
    },
    "@/lib/handymanMarketplace": { handymanEnabled: () => enabled },
    "@/lib/handymanQuoteServer": {},
    "@/lib/handymanServer": {},
  });
  const url =
    "https://staging.example.invalid/api/handyman/admin?job=00000000-0000-0000-0000-000000000001";
  assert.equal((await route.GET(new NextRequest(url))).status, 403);
  assert.equal(
    (await route.POST(new NextRequest(url, { method: "POST" }))).status,
    403,
  );
  enabled = false;
  assert.equal((await route.GET(new NextRequest(url))).status, 404);
  assert.equal(guards, 2);
});
