import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
const require = createRequire(import.meta.url);
const modules = new Map();
function load(file) {
  if (file.endsWith(".json")) return JSON.parse(readFileSync(file, "utf8"));
  if (modules.has(file)) return modules.get(file);
  const compiledModule = { exports: {} };
  const output = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  vm.runInNewContext(output, {
    module: compiledModule,
    exports: compiledModule.exports,
    process,
    console,
    Buffer,
    Headers,
    Request,
    Response,
    AbortSignal,
    fetch,
    Date,
    require(id) {
      if (id === "server-only") return {};
      if (id.startsWith("."))
        return load(`lib/${id.slice(2)}${id.endsWith(".json") ? "" : ".ts"}`);
      return require(id);
    },
  });
  modules.set(file, compiledModule.exports);
  return compiledModule.exports;
}
const scope = load("lib/cleaningScope.ts");
const copy = load("lib/launchOperationsCopy.ts");
const mail = load("lib/launchOperationsMail.ts");
test("all five missing package breakdowns are specific, complete and retain the client's unusual wording", () => {
  const names = [
    "One-Time Essential Clean",
    "Express Clean",
    "Signature Deep Clean",
    "End of Tenancy / Move-In Clean",
    "Guest Ready",
  ];
  for (const name of names) {
    const item = scope.cleaningPackageScope(name);
    assert.ok(item?.purpose && item?.timing && item?.notIncluded);
    assert.ok(item.tasks.length >= 5);
  }
  assert.ok(
    scope
      .cleaningPackageScope("Express Clean")
      .tasks.some((t) => t.work === "detailed dusting, bed changes"),
  );
  assert.equal(
    scope.cleaningPackageScope("Guest Ready").tasks[0].work,
    "strip beds, remake with fresh linen; collect used linen and towels and bag them for laundering; set out clean towels; replace pillows and throws neatly.",
  );
  assert.match(
    scope.cleaningPackageScope("Signature Deep Clean").timing,
    /6 to 8 hours for a 5-bedroom house/,
  );
  assert.match(
    scope.cleaningPackageScope("End of Tenancy / Move-In Clean").notIncluded,
    /We do not guarantee the return of a deposit/,
  );
});
test("complaint emails use the published acknowledgement and reply templates", () => {
  const ack = copy.complaintAcknowledgement({
    reference: "OB-C-TEST",
    receivedAt: "2026-11-03T10:00:00Z",
    handler: "Test Support",
    replyDueAt: "2026-11-17T10:00:00Z",
  });
  assert.match(
    ack,
    /Thank you for contacting Opulence Bliss\. We have received your complaint \(reference OB-C-TEST\)/,
  );
  assert.match(ack, /Test Support is looking into it/);
  const reply = copy.complaintReply({
    reference: "OB-C-TEST",
    checked: "test records",
    findings: "the test facts",
    action: "offer a fair remedy",
  });
  assert.match(reply, /within 14 days/);
  assert.match(reply, /Information Commissioner's Office at ico.org.uk/);
});
test("welcome wording does not pretend missing Cleaner Terms were accepted and includes handyman next steps", () => {
  const text = copy.professionalWelcome({
    firstName: "Alex",
    acceptedAt: "2026-11-03T10:00:00Z",
    documents: [{ title: "Professional Partner Agreement", version: "2.0" }],
    handyman: false,
  });
  assert.match(text, /Professional Partner Agreement \(v2.0\)/);
  assert.doesNotMatch(text, /Cleaner Terms and Conditions/);
  assert.match(
    copy.professionalWelcome({
      firstName: "Alex",
      acceptedAt: "2026-11-03T10:00:00Z",
      documents: [],
      handyman: true,
    }),
    /your Gas Safe or electrical registration where relevant/,
  );
});
test("payment receipts include total, reference and no VAT without claiming a hold", () => {
  const text = copy.paymentReceipt({
    reference: "test-payment",
    bookingId: "test-visit",
    amountPence: 4598,
    paidAt: "2026-11-03T10:00:00Z",
    service: "One-Time Essential Clean",
    kind: "booking",
  });
  assert.match(text, /£45\.98/);
  assert.match(text, /No VAT is charged\./);
  assert.doesNotMatch(text, /held|authoris|after the visit/i);
  assert.throws(() => copy.paymentReceipt({ amountPence: 1.5 }), /Invalid/);
});
test("welcome attaches the exact accepted original PDFs and verifies generated fallback snapshots", async () => {
  const pack = JSON.parse(readFileSync("lib/finalLegalPack.json", "utf8"));
  const crypto = require("node:crypto");
  const d = pack["dbs-data"],
    h = pack["handyman-professional-terms"];
  const docs = [d, h].map((doc) => ({
    ...doc,
    sourceContentHtml: doc.contentHtml,
    contentHash: crypto.createHash("md5").update(doc.contentHtml).digest("hex"),
    displayContentHash: crypto
      .createHash("md5")
      .update(doc.contentHtml)
      .digest("hex"),
  }));
  const payload = await mail.launchOperationsPayload(
    "welcome",
    {
      firstName: "Alex",
      acceptedAt: "2026-11-03T10:00:00Z",
      documents: docs,
      handyman: true,
    },
    "alex@example.invalid",
    "staging@opulencebliss.com",
    "https://staging.example.invalid",
  );
  assert.equal(payload.subject, "Welcome to Opulence Bliss");
  assert.equal(payload.attachments.length, 2);
  for (const [index, attachment] of payload.attachments.entries())
    assert.equal(
      crypto
        .createHash("sha256")
        .update(Buffer.from(attachment.content, "base64"))
        .digest("hex"),
      docs[index].pdfSha256,
    );
  await assert.rejects(
    mail.launchOperationsPayload(
      "welcome",
      { documents: [] },
      "test@example.invalid",
      "test",
      "test",
    ),
    /Accepted professional/,
  );
});
function outboxFixture() {
  const row = {
    id: "mail-fixture",
    claim_token: "lease-fixture",
    email: "alex@example.invalid",
    kind: "receipt",
    context: {
      reference: "payment",
      bookingId: "booking",
      amountPence: 4598,
      paidAt: "2026-11-03T10:00:00Z",
      service: "Express Clean",
      kind: "booking",
    },
    payload: null,
  };
  const calls = [],
    requests = [];
  const admin = {
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === "claim_launch_operation_emails") return { data: [row] };
      if (name === "store_launch_operation_payload") {
        row.payload ??= args.p_payload;
        return { data: row.payload };
      }
      if (name === "finish_launch_operation_email") return { data: true };
      throw Error(name);
    },
  };
  const transport = async (url, options) => {
    requests.push({ url, options });
    return new Response("{}", { status: 200 });
  };
  return { admin, transport, calls, requests, row };
}
test("operations delivery refuses staging recipients outside the allowlist", async () => {
  const f = outboxFixture();
  const r = await mail.deliverLaunchOperationsEmails(
    f.admin,
    {
      RESEND_API_KEY: "test-placeholder",
      EMAIL_FROM: "staging@opulencebliss.com",
      NEXT_PUBLIC_SITE_URL: "https://staging.example.invalid",
      VERCEL_ENV: "preview",
      STAGING_EMAIL_RECIPIENTS: "",
    },
    f.transport,
  );
  assert.equal(r.sent, 0);
  assert.equal(r.failed, 1);
  assert.equal(f.requests.length, 0);
});
test("operations retries reuse the saved payload and the same provider idempotency key", async () => {
  const f = outboxFixture();
  const env = {
    RESEND_API_KEY: "test-placeholder",
    EMAIL_FROM: "staging@opulencebliss.com",
    NEXT_PUBLIC_SITE_URL: "https://staging.example.invalid",
    VERCEL_ENV: "preview",
    STAGING_EMAIL_RECIPIENTS: "alex@example.invalid",
  };
  await mail.deliverLaunchOperationsEmails(f.admin, env, f.transport);
  f.row.context.amountPence = 99999;
  await mail.deliverLaunchOperationsEmails(f.admin, env, f.transport);
  assert.equal(f.requests[0].options.body, f.requests[1].options.body);
  assert.equal(
    f.requests[0].options.headers["Idempotency-Key"],
    "launch-operation/mail-fixture",
  );
  assert.equal(
    f.calls.filter((c) => c.name === "store_launch_operation_payload").length,
    1,
  );
});
test("region and production release scope keep billing worker and dependencies unchanged", () => {
  assert.deepEqual(JSON.parse(readFileSync("vercel.json", "utf8")), {
    regions: ["fra1"],
  });
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(pkg.dependencies.next, "16.4.2");
  assert.match(
    readFileSync("app/api/cron/launch-operations/route.ts", "utf8"),
    /CRON_SECRET/,
  );
});
