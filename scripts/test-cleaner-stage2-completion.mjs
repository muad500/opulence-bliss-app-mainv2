import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { webcrypto } from "node:crypto";
import { NextRequest, NextResponse } from "next/server.js";
const require = createRequire(import.meta.url);
const uuid = "00000000-0000-4000-8000-000000000001";
const origin = "https://test-stage2-branch.vercel.app";
function fixture(options = {}) {
  const calls = [],
    network = [];
  const env = {
    VERCEL_ENV: "preview",
    CLEANER_STAGE2_ENABLED: "true",
    CLEANER_SECURE_DBS_DECISIONS_ENABLED: "true",
    VERCEL_URL: "test-stage2.vercel.app",
    VERCEL_BRANCH_URL: "test-stage2-branch.vercel.app",
    NEXT_PUBLIC_SUPABASE_URL: "https://comwdjprdedmsnxtvuuk.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "TEST_NOT_A_REAL_KEY",
    RESEND_API_KEY: "TEST_NOT_A_REAL_KEY",
    ACCOUNT_EMAIL_FROM: "Opulence Bliss Staging <staging@opulencebliss.com>",
    STAGING_EMAIL_RECIPIENTS: "owner@example.invalid",
    STRIPE_SECRET_KEY: "sk_test_TEST_NOT_A_REAL_KEY",
    ...options.env,
  };
  async function rpc(name, args) {
    calls.push([name, args]);
    if (options.rpcFail)
      return { error: { message: "TEST PRIVATE INTERNAL ERROR" } };
    const data =
      name === "claim_cleaner_onboarding_emails"
        ? (options.queue ?? [])
        : name === "prepare_cleaner_onboarding_email"
          ? args.p_payload
          : name === "open_cleaner_secure_decision"
            ? {
                decision: "TEST decision",
                reasons: "TEST reasons",
                reference: uuid,
              }
            : name === "cleaner_passed_setup_context"
              ? options.passed === false
                ? null
                : {
                    applicationId: uuid,
                    email: "owner@example.invalid",
                    fullName: "TEST Applicant",
                    phone: "+442079460001",
                  }
              : name === "own_cleaner_stage2_setup"
                ? {
                    providerId: uuid,
                    status: options.status ?? "assessment_passed",
                  }
                : true;
    return { data };
  }
  const client = {
    rpc,
    auth: {
      admin: {
        generateLink: async (value) => {
          calls.push(["generateLink", value]);
          return {
            data: {
              user: { id: uuid },
              properties: { hashed_token: "TEST_HASH" },
            },
          };
        },
      },
    },
    from(table) {
      const chain = {
        select() {
          return chain;
        },
        eq() {
          return chain;
        },
        is() {
          return chain;
        },
        update(data) {
          calls.push(["update", table, data]);
          return chain;
        },
        upsert(data) {
          calls.push(["upsert", table, data]);
          return chain;
        },
        async maybeSingle() {
          return {
            data:
              table === "profiles"
                ? options.existing
                  ? { id: uuid, role: "customer" }
                  : null
                : { stripe_account_id: options.accountId ?? "acct_TEST" },
          };
        },
        async single() {
          return {
            data: { stripe_account_id: options.accountId ?? "acct_TEST" },
          };
        },
        then(done) {
          return Promise.resolve({ data: null }).then(done);
        },
      };
      return chain;
    },
  };
  const payout = {
    ready: options.payoutReady ?? true,
    account: { id: "acct_TEST" },
    stripe: {
      accounts: {
        update: async (...args) => calls.push(["stripeSchedule", ...args]),
      },
      v2: {
        core: {
          accountLinks: {
            create: async () => ({
              livemode: false,
              url: "https://connect.stripe.com/TEST",
            }),
          },
        },
      },
    },
  };
  function load(file) {
    const compiled = { exports: {} };
    vm.runInNewContext(
      ts.transpileModule(readFileSync(file, "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true,
        },
      }).outputText,
      {
        module: compiled,
        exports: compiled.exports,
        process: { env },
        URL,
        Buffer,
        File,
        FormData,
        Response,
        AbortSignal,
        Date,
        fetch: async (url, input) => {
          network.push([url, input]);
          return new Response("{}", { status: 200 });
        },
        require(name) {
          if (name === "server-only") return {};
          if (name === "next/server") return { NextRequest, NextResponse };
          if (name === "@supabase/supabase-js")
            return {
              createClient: () => {
                calls.push(["client"]);
                return client;
              },
            };
          if (name === "@/lib/accountApi")
            return {
              isSameOriginMutation: (r) => r.headers.get("origin") === origin,
              accountContext: async () =>
                options.denied
                  ? NextResponse.json({ error: "Sign in" }, { status: 401 })
                  : { user: { id: uuid }, admin: client, providerId: uuid },
              isAccountError: (v) => v instanceof NextResponse,
              normaliseGbPhone: (v) => (v ? "+442079460001" : null),
            };
          if (name === "@/lib/adminApi")
            return {
              adminApi: async () =>
                options.denied
                  ? NextResponse.json(
                      { error: "Authenticator required" },
                      { status: 403 },
                    )
                  : {
                      client,
                      admin: client,
                      user: { id: uuid },
                      staffRole: "manager",
                    },
            };
          if (name === "@/lib/supabase/server")
            return { createClient: async () => client };
          if (name === "@/lib/cleanerSetupStripe")
            return {
              cleanerSetupPayoutAccount: async () => {
                calls.push(["payoutCheck"]);
                return payout;
              },
            };
          if (name === "@/lib/accountAcceptanceServer")
            return {
              prepareAccountAcceptance: async () => {
                calls.push(["prepareAcceptance"]);
                return {};
              },
              saveAccountAcceptance: async () => calls.push(["saveAcceptance"]),
            };
          if (name === "./launchOperationsMail")
            return {
              launchOperationsPayload: async (kind, context) => {
                calls.push(["acceptedAttachments", context]);
                return {
                  attachments: [
                    { filename: "TEST-accepted-v1.0.pdf", content: "VEVTVA==" },
                  ],
                };
              },
            };
          if (name.endsWith(".json"))
            return JSON.parse(
              readFileSync(
                name.startsWith("@/")
                  ? name.slice(2)
                  : resolve(dirname(file), name),
                "utf8",
              ),
            );
          if (name.startsWith("@/lib/"))
            return load(resolve("lib", name.slice(6) + ".ts"));
          if (name.startsWith("./"))
            return load(resolve(dirname(file), name + ".ts"));
          return require(name);
        },
      },
      { filename: file },
    );
    return compiled.exports;
  }
  return { load, calls, network, client, env };
}

test("private evidence rejects executable files and oversized multipart bodies", async () => {
  const files = fixture().load("lib/privateDocumentUpload.ts");
  await assert.rejects(() =>
    files.privateDocumentFile(
      new File(["<svg></svg>"], "pretend.pdf", { type: "application/pdf" }),
    ),
  );
  await assert.rejects(() =>
    files.privateDocumentFile(
      new File([new Uint8Array(4 * 1024 * 1024 + 1)], "TEST.pdf"),
    ),
  );
  const result = await files.privateDocumentFile(
    new File(["%PDF-1.7\nTEST fictional document"], "../TEST.pdf"),
  );
  assert.equal(result.mime, "application/pdf");
  assert.doesNotMatch(result.name, /[\\/]/);
  await assert.rejects(() =>
    files.privateDocumentForm(
      new Request("https://test.invalid", {
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=TEST" },
        body: new Uint8Array(4 * 1024 * 1024 + 65537),
      }),
    ),
  );
});

async function edgeFixture(envOverrides = {}) {
  let handler;
  const network = [];
  const env = {
    SUPABASE_URL: "https://comwdjprdedmsnxtvuuk.supabase.co",
    VISIT_PAYMENTS_CRON_SECRET: "TEST-not-a-secret",
    SUPABASE_SERVICE_ROLE_KEY: "TEST-not-a-key",
    ...envOverrides,
  };
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(
        "supabase/functions/cleaner-stage2-recovery/index.ts",
        "utf8",
      ),
      {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText,
    {
      Deno: { env: { get: (key) => env[key] }, serve: (fn) => (handler = fn) },
      TextEncoder,
      crypto: webcrypto,
      Response,
      Request,
      AbortSignal,
      fetch: async (url, options) => {
        network.push([url, options]);
        return Response.json({ processed: 0, followups: 0 });
      },
    },
  );
  return { handler, network };
}
function edgeRequest(input, secret = "TEST-not-a-secret") {
  return new Request("https://test.invalid", {
    method: "POST",
    headers: { "x-cleaner-stage2-secret": secret },
    body: JSON.stringify(input),
  });
}
test("permanent recovery refuses Production and unauthorised callers before network access", async () => {
  const production = await edgeFixture({
    SUPABASE_URL: "https://uiqcsihgqaktpjumyeap.supabase.co",
  });
  assert.equal((await production.handler(edgeRequest({}))).status, 404);
  assert.equal(production.network.length, 0);
  const staging = await edgeFixture();
  assert.equal((await staging.handler(edgeRequest({}, "wrong"))).status, 401);
  assert.equal(staging.network.length, 0);
});
test("recovery can contact only the project Preview with private headers and no secret output", async () => {
  const f = await edgeFixture();
  assert.equal(
    (
      await f.handler(
        edgeRequest({
          origin: "https://evil.invalid",
          protectionBypass: "TEST",
        }),
      )
    ).status,
    400,
  );
  const result = await f.handler(
    edgeRequest({
      origin:
        "https://opulence-bliss-app-mainv2-TEST-muad500s-projects.vercel.app".toLowerCase(),
      protectionBypass: "TEST-bypass",
    }),
  );
  assert.equal(result.status, 200);
  assert.equal(f.network.length, 1);
  assert.doesNotMatch(await result.text(), /TEST-bypass|TEST-not-a-key/);
  assert.equal(f.network[0][1].redirect, "error");
  assert.match(f.network[0][1].headers.Authorization, /^Bearer [a-f0-9]{64}$/);
  assert.doesNotMatch(f.network[0][0], /bypass|secret|token/);
});
function request(path, body, cookie = "") {
  return new NextRequest(origin + path, {
    method: body ? "POST" : "GET",
    headers: {
      origin,
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
test("all new applicant routes refuse Production before touching credentials", async () => {
  for (const file of [
    "app/api/cleaner-assessment/setup/route.ts",
    "app/api/cleaner-decision/route.ts",
    "app/api/cleaner-setup/route.ts",
  ]) {
    const f = fixture({ env: { VERCEL_ENV: "production" } });
    const route = f.load(file);
    assert.equal(
      (
        await route.POST(
          request("/test", { action: "open", access: "a".repeat(64) }),
        )
      ).status,
      404,
    );
    assert.equal(f.calls.length, 0);
  }
});
test("secure decision view needs a personal credential and rejects cross-site requests", async () => {
  const f = fixture();
  const route = f.load("app/api/cleaner-decision/route.ts");
  assert.equal((await route.GET(request("/api/cleaner-decision"))).status, 401);
  assert.equal(
    (
      await route.POST(
        new NextRequest(origin + "/api/cleaner-decision", {
          method: "POST",
          headers: { origin: "https://outside.example.invalid" },
          body: "{}",
        }),
      )
    ).status,
    403,
  );
  assert.equal(f.calls.length, 0);
});
test("decision exchange sets only an HttpOnly secure strict cookie and never echoes its secret", async () => {
  const f = fixture();
  const route = f.load("app/api/cleaner-decision/route.ts");
  const token = "a".repeat(64);
  const response = await route.POST(
    request("/api/cleaner-decision", { action: "open", access: token }),
  );
  assert.equal(response.status, 200);
  assert.doesNotMatch(await response.text(), new RegExp(token));
  const cookie = response.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /Secure/i);
  assert.match(cookie, /SameSite=strict/i);
  assert.ok(
    f.calls.find(
      ([name, args]) =>
        name === "open_cleaner_secure_decision" && args.p_hash !== token,
    ),
  );
});
test("expired or refused decisions disclose no internal data", async () => {
  const f = fixture({ rpcFail: true });
  const response = await f.load("app/api/cleaner-decision/route.ts").POST(
    request("/api/cleaner-decision", {
      action: "open",
      access: "a".repeat(64),
    }),
  );
  assert.equal(response.status, 403);
  assert.doesNotMatch(await response.text(), /PRIVATE INTERNAL/);
});
test("limited access cannot prepare an account before passing", async () => {
  const f = fixture({ passed: false });
  const response = await f
    .load("app/api/cleaner-assessment/setup/route.ts")
    .POST(
      request(
        "/test",
        {},
        "__Host-opulence-cleaner-assessment=" + "a".repeat(64),
      ),
    );
  assert.equal(response.status, 403);
  assert.ok(!f.calls.some((c) => c[0] === "generateLink"));
});
test("passed handoff keeps an existing identity and its metadata", async () => {
  const f = fixture({ existing: true });
  const response = await f
    .load("app/api/cleaner-assessment/setup/route.ts")
    .POST(
      request(
        "/test",
        {},
        "__Host-opulence-cleaner-assessment=" + "a".repeat(64),
      ),
    );
  assert.equal(response.status, 200);
  const link = f.calls.find((c) => c[0] === "generateLink")[1];
  assert.equal(link.type, "magiclink");
  assert.equal(link.options, undefined);
  assert.ok(f.calls.some((c) => c[0] === "link_cleaner_passed_account"));
});
test("setup refuses missing consent before saving evidence or changing schedules", async () => {
  const f = fixture();
  const response = await f
    .load("app/api/cleaner-setup/route.ts")
    .POST(request("/test", { action: "accept", consents: {} }));
  assert.equal(response.status, 400);
  assert.ok(
    !f.calls.some((c) => ["saveAcceptance", "stripeSchedule"].includes(c[0])),
  );
});
test("checklist endpoint cannot accept device-supplied staff or timestamps", async () => {
  const f = fixture();
  const response = await f
    .load("app/api/admin/cleaner-applications/route.ts")
    .POST(
      request("/test", {
        action: "checklist",
        applicationId: uuid,
        group: "deskScreening",
        item: "application-record",
        checked: true,
        note: "TEST factual evidence note",
        actor: "FORGED",
        recordedAt: "2000-01-01",
      }),
    );
  assert.equal(response.status, 200);
  const args = f.calls.find((c) => c[0] === "staff_tick_cleaner_checklist")[1];
  assert.deepEqual(Object.keys(args).sort(), [
    "p_application",
    "p_checked",
    "p_group",
    "p_item",
    "p_note",
  ]);
});
test("E04 stays disabled until the secure-view switch is enabled", async () => {
  const f = fixture({ env: { CLEANER_SECURE_DBS_DECISIONS_ENABLED: "false" } });
  const response = await f
    .load("app/api/admin/cleaner-applications/route.ts")
    .POST(
      request("/test", { action: "publish_decision", applicationId: uuid }),
    );
  assert.equal(response.status, 409);
  assert.ok(!f.calls.some((c) => c[0] === "staff_publish_cleaner_decision"));
});
test("email worker refuses Production, multiple recipients and a production sender", async () => {
  for (const env of [
    { VERCEL_ENV: "production" },
    { STAGING_EMAIL_RECIPIENTS: "one@example.invalid,two@example.invalid" },
    { ACCOUNT_EMAIL_FROM: "hello@opulencebliss.com" },
  ]) {
    const f = fixture({ env });
    const result = await f
      .load("lib/cleanerOnboardingMail.ts")
      .deliverCleanerOnboardingEmails(f.client);
    assert.equal(result.configured, false);
    assert.equal(f.network.length, 0);
    assert.equal(f.calls.length, 0);
  }
});
test("frozen E04 cannot bypass its disabled switch", async () => {
  const f = fixture({
    env: { CLEANER_SECURE_DBS_DECISIONS_ENABLED: "false" },
    queue: [
      {
        id: uuid,
        email: "owner@example.invalid",
        wording_version: "1.0",
        template_key: "dbsDecisionNotice",
        context: {},
        claim_token: uuid,
        delivery_payload: {
          from: "Opulence Bliss Staging <staging@opulencebliss.com>",
          to: ["owner@example.invalid"],
          subject: "TEST",
          text: "TEST",
        },
      },
    ],
  });
  const result = await f
    .load("lib/cleanerOnboardingMail.ts")
    .deliverCleanerOnboardingEmails(f.client);
  assert.equal(result.sent, 0);
  assert.equal(f.network.length, 0);
});
test("application confirmation uses the unchanged approved copy and approved inbox only", async () => {
  const f = fixture({
    queue: [
      {
        id: uuid,
        email: "owner@example.invalid",
        wording_version: "1.0",
        template_key: "applicationReceived",
        full_name: "TEST Fictional Applicant",
        application_id: uuid,
        context: {},
        claim_token: uuid,
      },
    ],
  });
  const result = await f
    .load("lib/cleanerOnboardingMail.ts")
    .deliverCleanerOnboardingEmails(f.client);
  assert.equal(result.sent, 1);
  const payload = JSON.parse(f.network[0][1].body);
  assert.deepEqual(payload.to, ["owner@example.invalid"]);
  assert.equal(
    payload.subject,
    "[STAGING TEST] We have received your cleaner application",
  );
  const catalog = JSON.parse(
    readFileSync("content/cleaner-onboarding-drafts.json", "utf8"),
  );
  const expected = catalog.emails[0].paragraphs
    .join("\n\n")
    .replaceAll("{{first_name}}", "TEST")
    .replaceAll("{{application_reference}}", uuid)
    .replaceAll("{{privacy_url}}", origin + "/legal/privacy");
  assert.equal(payload.text, expected);
  assert.ok(f.calls.some((c) => c[0] === "prepare_cleaner_onboarding_email"));
});
test("welcome reuses accepted-version PDF attachments without changing their snapshots", async () => {
  const documents = [
    { slug: "dbs-data", version: "1.0", pdfSha256: "TEST fingerprint" },
  ];
  const f = fixture({
    queue: [
      {
        id: uuid,
        email: "owner@example.invalid",
        wording_version: "1.0",
        template_key: "stage2Welcome",
        full_name: "TEST Fictional Applicant",
        application_id: uuid,
        context: {
          accepted_at: "TEST date",
          acceptedAt: "2026-11-06T10:00:00Z",
          accepted_documents: "TEST accepted documents",
          documents,
        },
        claim_token: uuid,
      },
    ],
  });
  const result = await f
    .load("lib/cleanerOnboardingMail.ts")
    .deliverCleanerOnboardingEmails(f.client);
  assert.equal(result.sent, 1);
  assert.deepEqual(
    f.calls.find((c) => c[0] === "acceptedAttachments")[1].documents,
    documents,
  );
  assert.equal(
    JSON.parse(f.network[0][1].body).attachments[0].filename,
    "TEST-accepted-v1.0.pdf",
  );
});

test("a reopened invitation waits for the old page-leave request before starting", async () => {
  const effects = [];
  const calls = [];
  const storage = new Map([
    ["opulence-cleaner-active-assessment", "old-attempt"],
  ]);
  let finishOldRequest;
  const oldRequest = new Promise((done) => (finishOldRequest = done));
  const compiled = { exports: {} };
  const element = (type, props) => ({ type, props });
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync("app/cleaner-assessment/screen.tsx", "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
        },
      },
    ).outputText,
    {
      module: compiled,
      exports: compiled.exports,
      URLSearchParams,
      Date,
      sessionStorage: {
        getItem: (key) => storage.get(key),
        setItem: (key, value) => storage.set(key, value),
        removeItem: (key) => storage.delete(key),
      },
      window: {
        location: {
          hash: "#invitation=TEST_fresh_invitation",
          pathname: "/cleaner-assessment",
        },
        history: { replaceState: () => calls.push("fragment removed") },
      },
      fetch: async (_url, request) => {
        calls.push(request.method);
        return request.method === "PATCH"
          ? oldRequest
          : {
              ok: true,
              json: async () => ({
                phase: "questions",
                attemptId: "new-attempt",
                serverTime: new Date().toISOString(),
              }),
            };
      },
      require(name) {
        if (name === "react/jsx-runtime")
          return { jsx: element, jsxs: element };
        if (name === "react")
          return {
            useState: (value) => [value, () => {}],
            useRef: (current) => ({ current }),
            useCallback: (callback) => callback,
            useEffect: (callback) => effects.push(callback),
          };
        if (name.endsWith(".css")) return {};
        if (name === "@/lib/cleanerAssessmentPolicy")
          return { CLEANER_ASSESSMENT_COPY: { rules: [] } };
        throw Error(`Unexpected client dependency: ${name}`);
      },
    },
  );
  const tree = compiled.exports.default();
  const findStart = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "button" && node.props.children === "Start assessment")
      return node;
    for (const child of [node.props?.children].flat(Infinity)) {
      const found = findStart(child);
      if (found) return found;
    }
  };
  effects[0]();
  findStart(tree).props.onClick();
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(calls, ["PATCH"]);
  finishOldRequest({ ok: false });
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(calls, ["PATCH", "POST", "fragment removed"]);
  assert.equal(
    storage.get("opulence-cleaner-active-assessment"),
    "new-attempt",
  );
});
