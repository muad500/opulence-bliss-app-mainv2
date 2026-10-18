// Explicit staging transport test. No bookings, account details or payments change.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { build } from "esbuild";
import { createClient } from "@supabase/supabase-js";

if (!process.argv.includes("--send")) {
  console.log(
    "Prepared only. --send requires the approved staging key and recipient.",
  );
  process.exit(0);
}
try {
  const recipient = "syedmouad@gmail.com";
  const sender = "Opulence Bliss Staging <staging@opulencebliss.com>";
  const site =
    "https://opulence-bliss-app-mainv2-git-codex-staging-muad500s-projects.vercel.app";
  const credential = JSON.parse(
    readFileSync(".local-secrets/staging-resend.json"),
  );
  assert.equal(credential.status, "active");
  assert.equal(credential.environment, "staging");
  assert.equal(credential.domain, "opulencebliss.com");
  assert.ok(credential.RESEND_API_KEY.startsWith("re_"));
  const stage = JSON.parse(readFileSync(".local-secrets/staging-api.json"));
  assert.equal(
    stage.NEXT_PUBLIC_SUPABASE_URL,
    "https://comwdjprdedmsnxtvuuk.supabase.co",
  );
  const resultPath = "artifacts/staging-email-delivery-results.json";
  let state;
  try {
    state = JSON.parse(readFileSync(resultPath, "utf8"));
  } catch {
    state = { run: randomUUID(), accepted: [], batches: [] };
  }
  const save = () =>
    writeFileSync(resultPath, JSON.stringify(state, null, 2) + "\n");
  const bundled = await build({
    stdin: {
      contents:
        'export { sendPrivateAccountMail } from "./lib/privateAccountMail"; export { deliverVisitMatchingNotices } from "./lib/visitMatchingNotices";',
      resolveDir: process.cwd(),
      loader: "ts",
    },
    platform: "node",
    format: "esm",
    bundle: true,
    write: false,
    plugins: [
      {
        name: "server-marker",
        setup(b) {
          b.onResolve({ filter: /^server-only$/ }, () => ({
            path: "server-only",
            namespace: "marker",
          }));
          b.onLoad({ filter: /.*/, namespace: "marker" }, () => ({
            contents: "",
            loader: "js",
          }));
        },
      },
    ],
  });
  const mail = await import(
    "data:text/javascript;base64," +
      Buffer.from(bundled.outputFiles[0].text).toString("base64")
  );
  const originalFetch = globalThis.fetch;
  const transport = async (url, request) => {
    assert.equal(url, "https://api.resend.com/emails");
    const body = JSON.parse(request.body);
    assert.deepEqual(body.to, [recipient]);
    assert.equal(body.from, sender);
    assert.ok(
      request.headers.Authorization === `Bearer ${credential.RESEND_API_KEY}`,
    );
    const response = await originalFetch(url, request);
    if (response.ok) {
      const accepted = await response.clone().json();
      assert.ok(typeof accepted.id === "string");
      state.accepted.push({
        id: accepted.id,
        subject: body.subject,
        recipient,
        sender,
        acceptedAt: new Date().toISOString(),
      });
      save();
    }
    return response;
  };
  const env = {
    RESEND_API_KEY: credential.RESEND_API_KEY,
    ACCOUNT_EMAIL_FROM: sender,
    BOOKING_EMAIL_FROM: sender,
    EMAIL_FROM: sender,
    NEXT_PUBLIC_SITE_URL: site,
    VISIT_PAYMENTS_MODE: "staging",
    STAGING_EMAIL_RECIPIENTS: recipient,
    BOOKING_SMS_ENABLED: "false",
  };
  Object.assign(process.env, env);
  if (!state.accountTransportAccepted) {
    globalThis.fetch = transport;
    const sent = await mail.sendPrivateAccountMail(
      recipient,
      "Opulence Bliss staging — email delivery test",
      "This confirms staging transactional email delivery. No booking, account details or payment were changed. This email was requested by you; it is not marketing.",
      `staging-account-mail/${state.run}`,
    );
    globalThis.fetch = originalFetch;
    assert.equal(sent, true);
    state.accountTransportAccepted = true;
    save();
  }
  const admin = createClient(
    stage.NEXT_PUBLIC_SUPABASE_URL,
    stage.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );
  if (process.argv.includes("--queue")) {
    for (let i = 0; i < 5; i++) {
      const result = await mail.deliverVisitMatchingNotices(
        admin,
        env,
        transport,
      );
      state.batches.push({ ...result, checkedAt: new Date().toISOString() });
      save();
      assert.equal(result.failed, 0);
      if (result.submitted > 0 || result.excluded === 0) break;
    }
  }
  state.deliveryConfirmedInResend = false;
  state.productionChanged = false;
  state.financialOperationsRun = false;
  save();
  console.log(
    JSON.stringify({
      accountMailAccepted: state.accountTransportAccepted,
      acceptedEmails: state.accepted.map((e) => ({
        id: e.id,
        subject: e.subject,
      })),
      batches: state.batches,
      productionChanged: false,
    }),
  );
} catch {
  console.error(
    "Staging email test stopped. No credentials or provider payloads were logged; inspect the saved non-secret result before retrying.",
  );
  process.exitCode = 1;
}
