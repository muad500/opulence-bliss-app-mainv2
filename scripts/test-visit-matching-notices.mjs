import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const cache = new Map();
function load(name) {
  if (cache.has(name)) return cache.get(name).exports;
  const moduleRecord = { exports: {} };
  cache.set(name, moduleRecord);
  const code = ts.transpileModule(readFileSync(`lib/${name}.ts`, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  vm.runInNewContext(code, {
    module: moduleRecord,
    exports: moduleRecord.exports,
    require: (id) => (id.startsWith("./") ? load(id.slice(2)) : require(id)),
    URL,
    AbortSignal,
  });
  return moduleRecord.exports;
}
const { deliverVisitMatchingNotices } = load("visitMatchingNotices");
const notice = {
  id: "fixture-notice",
  claim_token: "fixture-claim",
  channel: "email",
  recipient: "recipient@example.invalid",
  title: "Still finding a cleaner",
  body: "Your visit is not assigned yet.",
  href: "/account/visit/fixture",
  kind: "customer_24h",
  booking_id: "fixture",
  scheduled_at: new Date().toISOString(),
};
const env = {
  RESEND_API_KEY: "fixture-key",
  BOOKING_EMAIL_FROM: "sender@example.invalid",
  NEXT_PUBLIC_SITE_URL: "https://staging.example.invalid",
};
function harness(rows = [notice], allowed = true) {
  const calls = [];
  const admin = {
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === "claim_visit_matching_notices")
        return { data: rows, error: null };
      if (name === "visit_matching_notice_allowed")
        return { data: allowed, error: null };
      return { error: null };
    },
  };
  return { admin, calls };
}

test("email and SMS remain disabled without separate configured credentials", async () => {
  const h = harness([]);
  const result = await deliverVisitMatchingNotices(h.admin, {}, () =>
    assert.fail("No delivery expected"),
  );
  assert.equal(result.emailConfigured, false);
  assert.equal(result.smsEnabled, false);
  assert.equal(h.calls[0].args.p_email_enabled, false);
  assert.equal(h.calls[0].args.p_sms_enabled, false);
});

test("a retried email uses the same idempotency key and records provider acceptance", async () => {
  const keys = [];
  for (const claim_token of ["first-lease", "second-lease"]) {
    const h = harness([{ ...notice, claim_token }]);
    const result = await deliverVisitMatchingNotices(
      h.admin,
      env,
      async (url, request) => {
        assert.equal(url, "https://api.resend.com/emails");
        keys.push(request.headers["Idempotency-Key"]);
        const body = JSON.parse(request.body);
        assert.match(
          body.text,
          /https:\/\/staging.example.invalid\/account\/visit\/fixture/,
        );
        return new Response(
          JSON.stringify({ id: "fixture-provider-reference" }),
          { status: 200 },
        );
      },
    );
    assert.equal(result.submitted, 1);
    assert.equal(h.calls.at(-1).args.p_reference, "fixture-provider-reference");
  }
  assert.deepEqual(keys, [
    "visit-matching/fixture-notice",
    "visit-matching/fixture-notice",
  ]);
});

test("a newly assigned or paused visit cancels a stale warning before contacting the provider", async () => {
  const h = harness([notice], false);
  const result = await deliverVisitMatchingNotices(h.admin, env, () =>
    assert.fail("Stale warning sent"),
  );
  assert.equal(result.submitted, 0);
  assert.equal(h.calls.at(-1).args.p_error, "Notice no longer applies.");
});

test("provider errors never persist credentials, destinations or response bodies", async () => {
  const h = harness();
  const result = await deliverVisitMatchingNotices(h.admin, env, async () => {
    throw new Error(`private ${env.RESEND_API_KEY} ${notice.recipient}`);
  });
  assert.equal(result.failed, 1);
  const error = h.calls.at(-1).args.p_error;
  assert.equal(error, "Notification submission failed or is uncertain.");
  assert.ok(!error.includes(env.RESEND_API_KEY));
  assert.ok(!error.includes(notice.recipient));
});

test("an external URL cannot be smuggled into a booking email", async () => {
  const h = harness([{ ...notice, href: "//foreign.example.invalid" }]);
  const result = await deliverVisitMatchingNotices(h.admin, env, () =>
    assert.fail("Invalid link sent"),
  );
  assert.equal(result.failed, 1);
  assert.equal(h.calls.at(-1).args.p_reference, null);
});

test("staging email fails closed without an approved recipient list", async () => {
  const h = harness([]);
  const result = await deliverVisitMatchingNotices(
    h.admin,
    { ...env, VISIT_PAYMENTS_MODE: "staging" },
    () => assert.fail("Unconfigured staging email must not be sent"),
  );
  assert.equal(result.emailConfigured, false);
  assert.equal(h.calls[0].args.p_email_enabled, false);
});

test("staging permits only the exact approved mailbox and retains excluded notices for audit", async () => {
  const h = harness([
    { ...notice, recipient: "approved@example.invalid" },
    { ...notice, id: "excluded", recipient: "other@example.invalid" },
  ]);
  const recipients = [];
  const result = await deliverVisitMatchingNotices(
    h.admin,
    {
      ...env,
      VISIT_PAYMENTS_MODE: "staging",
      STAGING_EMAIL_RECIPIENTS: " APPROVED@example.invalid ",
    },
    async (_url, request) => {
      recipients.push(...JSON.parse(request.body).to);
      return new Response(JSON.stringify({ id: "accepted-test-email" }));
    },
  );
  assert.deepEqual(recipients, ["approved@example.invalid"]);
  assert.equal(result.submitted, 1);
  assert.equal(result.excluded, 1);
  assert.equal(result.failed, 0);
  const excluded = h.calls
    .filter((call) => call.name === "finish_visit_matching_notice")
    .at(-1);
  assert.equal(excluded.args.p_reference, null);
  assert.match(excluded.args.p_error, /not approved/);
});

test("a staging allowlist cannot accidentally restrict Production delivery", async () => {
  const h = harness();
  const result = await deliverVisitMatchingNotices(
    h.admin,
    {
      ...env,
      VISIT_PAYMENTS_MODE: "production",
      STAGING_EMAIL_RECIPIENTS: "different@example.invalid",
    },
    async () => new Response(JSON.stringify({ id: "production-fixture" })),
  );
  assert.equal(result.submitted, 1);
  assert.equal(result.excluded, 0);
});
