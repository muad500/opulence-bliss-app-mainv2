import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { buildSync } from "esbuild";
const require = createRequire(import.meta.url);
const directory = mkdtempSync(join(tmpdir(), "opulence-notice-test-"));
const file = join(directory, "notice.cjs");
writeFileSync(
  file,
  buildSync({
    entryPoints: ["lib/regularPaymentNotice.ts"],
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
  }).outputFiles[0].text,
);
const { ensureRegularPaymentNotice } = require(file);
const env = {
  RESEND_API_KEY: "re_fixture",
  BOOKING_EMAIL_FROM: "Opulence Bliss Staging <staging@opulencebliss.com>",
  NEXT_PUBLIC_SITE_URL: "https://staging.example.invalid",
  NEXT_PUBLIC_SUPABASE_URL: "https://comwdjprdedmsnxtvuuk.supabase.co",
  STAGING_EMAIL_RECIPIENTS: "allowed@example.invalid",
};
function fixture({ claim = {}, finish = true, status = 200 } = {}) {
  const calls = [],
    requests = [];
  const notice = {
    required: true,
    ready: false,
    id: "notice",
    token: "token",
    recipient: "allowed@example.invalid",
    amountPence: 5298,
    scheduledAt: "2026-11-05T10:00:00Z",
    firstAttemptAt: new Date().toISOString(),
    ...claim,
  };
  const db = {
    async rpc(name, args) {
      calls.push(name);
      if (name === "claim_regular_payment_notice")
        return { data: notice, error: null };
      assert.equal(name, "finish_regular_payment_notice");
      calls.push(args.p_reference ? "email-recorded" : "email-not-sent");
      return { data: finish, error: null };
    },
  };
  const send = async (url, options) => {
    assert.equal(url, "https://api.resend.com/emails");
    calls.push("email");
    requests.push({
      headers: options.headers,
      payload: JSON.parse(options.body),
    });
    return new Response(JSON.stringify({ id: "email_ref" }), { status });
  };
  return { calls, requests, db, send, notice };
}
test("the email with date and amount is accepted and recorded before the charge may proceed", async () => {
  const f = fixture();
  const ready = await ensureRegularPaymentNotice(
    f.db,
    "operation",
    env,
    f.send,
  );
  if (ready) f.calls.push("charge");
  assert.equal(ready, true);
  assert.deepEqual(f.calls, [
    "claim_regular_payment_notice",
    "email",
    "finish_regular_payment_notice",
    "email-recorded",
    "charge",
  ]);
  assert.match(f.requests[0].payload.text, /£52\.98/);
  assert.match(f.requests[0].payload.text, /5 November 2026 at 10:00/);
  assert.deepEqual(f.requests[0].payload.to, ["allowed@example.invalid"]);
});
test("a saved notice or legacy/non-charge operation sends no duplicate email", async () => {
  for (const claim of [{ ready: true }, { required: false }]) {
    const f = fixture({ claim });
    assert.equal(
      await ensureRegularPaymentNotice(f.db, "operation", {}, f.send),
      true,
    );
    assert.deepEqual(f.calls, ["claim_regular_payment_notice"]);
  }
});
test("email failure, missing configuration or a failed database acknowledgement prevents charging", async () => {
  for (const options of [
    { status: 503 },
    { finish: false },
    { missingKey: true },
  ]) {
    const f = fixture(options);
    const configuration = options.missingKey ? {} : env;
    assert.equal(
      await ensureRegularPaymentNotice(
        f.db,
        "operation",
        configuration,
        f.send,
      ),
      false,
    );
    assert.ok(!f.calls.includes("charge"));
  }
});
test("a retry uses exactly the same email idempotency key and payload", async () => {
  const f = fixture({ status: 503 });
  await ensureRegularPaymentNotice(f.db, "operation", env, f.send);
  await ensureRegularPaymentNotice(f.db, "operation", env, f.send);
  assert.equal(f.requests.length, 2);
  assert.deepEqual(f.requests[0], f.requests[1]);
  assert.equal(
    f.requests[0].headers["Idempotency-Key"],
    "regular-payment-notice/notice",
  );
});
test("a concurrent mail lease and an uncertain old request stay blocked", async () => {
  for (const claim of [
    { token: undefined },
    { firstAttemptAt: new Date(Date.now() - 24 * 3600000).toISOString() },
  ]) {
    const f = fixture({ claim });
    assert.equal(
      await ensureRegularPaymentNotice(f.db, "operation", env, f.send),
      false,
    );
    assert.equal(f.requests.length, 0);
  }
});
test("staging cannot send to another customer copied from production", async () => {
  const f = fixture({ claim: { recipient: "not-allowed@example.invalid" } });
  assert.equal(
    await ensureRegularPaymentNotice(f.db, "operation", env, f.send),
    false,
  );
  assert.equal(f.requests.length, 0);
});
