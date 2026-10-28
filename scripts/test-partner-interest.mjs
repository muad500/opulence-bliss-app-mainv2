import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import crypto from "node:crypto";
import net from "node:net";
import * as phone from "libphonenumber-js";
function load(file, imports = {}, globals = {}) {
  const compiledModule = { exports: {} };
  const code = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const context = vm.createContext({
    module: compiledModule,
    exports: compiledModule.exports,
    console,
    Buffer,
    Headers,
    Request,
    Response,
    URL,
    Date,
    setTimeout,
    ...globals,
    require: (id) => {
      if (id === "server-only") return {};
      if (id in imports) return imports[id];
      throw Error("Missing " + id);
    },
  });
  new vm.Script(code).runInContext(context);
  return compiledModule.exports;
}
const copy = load("lib/partnerInterestCopy.ts");
const uk = load("lib/ukPhone.ts", { "libphonenumber-js": phone });
const validation = load("lib/partnerInterest.ts", {
  "libphonenumber-js": phone,
  "./ukPhone": uk,
  "./partnerInterestCopy": copy,
});
class NextResponse extends Response {
  static json(body, options) {
    return new NextResponse(JSON.stringify(body), {
      ...options,
      headers: { "content-type": "application/json", ...options?.headers },
    });
  }
}
function formFixture({
  result = { id: "fictional", duplicate: false },
  vercel = "1",
  error = false,
} = {}) {
  const effects = { writes: [], deliveries: [] };
  const { POST } = load(
    "app/api/partner-interest/route.ts",
    {
      "node:crypto": crypto,
      "node:net": net,
      "next/server": { NextResponse },
      "@/lib/accountApi": {
        isSameOriginMutation: (r) =>
          r.headers.get("origin") === r.nextUrl.origin,
      },
      "@/lib/partnerInterest": validation,
      "@/lib/partnerInterestCopy": copy,
      "@/lib/partnerInterestDelivery": {
        deliverPartnerInterestEmails: async (_admin, id) =>
          effects.deliveries.push(id),
      },
      "@supabase/supabase-js": {
        createClient: () => ({
          rpc: async (name, args) => {
            effects.writes.push({ name, args });
            return { data: result, error: error ? {} : null };
          },
        }),
      },
    },
    {
      process: {
        env: {
          VERCEL: vercel,
          SUPABASE_SERVICE_ROLE_KEY: "isolated-unit-credential",
          NEXT_PUBLIC_SUPABASE_URL: "https://staging.example.test",
        },
      },
    },
  );
  const body = {
    fullName: "  Fictional Person  ",
    email: "FIXTURE@EXAMPLE.TEST",
    phone: "020 7946 0123",
    description: "Freelancer",
    consent: true,
    website: "",
  };
  const request = (overrides = {}, headers = {}) => {
    const req = new Request(
      "https://staging.example.test/api/partner-interest",
      {
        method: "POST",
        headers: {
          origin: "https://staging.example.test",
          "content-type": "application/json",
          "x-vercel-forwarded-for": "203.0.113.28",
          "x-forwarded-for": "198.51.100.99",
          ...headers,
        },
        body: JSON.stringify({ ...body, ...overrides }),
      },
    );
    req.nextUrl = new URL(req.url);
    return POST(req);
  };
  return { request, effects };
}
test("UK phone validation normalises national and +44 inputs consistently with site rules", () => {
  for (const number of ["020 7946 0123", "+44 20 7946 0123"])
    assert.equal(
      validation.partnerInterestInput({
        fullName: "Fixture",
        email: "f@example.test",
        phone: number,
        description: "Other",
        consent: true,
      }).input.phone,
      "+442079460123",
    );
  for (const number of ["+1 202 555 0100", "not phone", ""])
    assert.ok(
      validation.partnerInterestInput({
        fullName: "Fixture",
        email: "f@example.test",
        phone: number,
        description: "Other",
        consent: true,
      }).fields.phone,
    );
});
test("valid interest saves exact shared consent and trusted IP, with one confirmation attempt", async () => {
  const f = formFixture();
  const r = await f.request();
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  const args = f.effects.writes[0].args;
  assert.equal(args.p_email, "fixture@example.test");
  assert.equal(args.p_phone, "+442079460123");
  assert.equal(args.p_consent, copy.PARTNER_INTEREST_CONSENT);
  assert.equal(args.p_ip, "203.0.113.28");
  assert.match(args.p_rate_key, /^[a-f0-9]{64}$/);
  assert.deepEqual(f.effects.deliveries, ["fictional"]);
  assert.equal(r.headers.get("set-cookie"), null);
});
test("unchecked consent, invalid description and invalid email stop before any database or mail call", async () => {
  for (const overrides of [
    { consent: false },
    { description: "Invented" },
    { email: "broken" },
  ]) {
    const f = formFixture();
    const r = await f.request(overrides);
    assert.equal(r.status, 400);
    assert.equal(f.effects.writes.length, 0);
    assert.equal(f.effects.deliveries.length, 0);
  }
});
test("honeypot returns indistinguishable success without storing or sending", async () => {
  const f = formFixture();
  const r = await f.request({ website: "spam.example" });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  assert.equal(f.effects.writes.length, 0);
  assert.equal(f.effects.deliveries.length, 0);
});
test("case-insensitive duplicates return thank-you but never wake another email", async () => {
  const f = formFixture({ result: { duplicate: true } });
  const r = await f.request();
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  assert.equal(f.effects.writes[0].args.p_email, "fixture@example.test");
  assert.equal(f.effects.deliveries.length, 0);
});
test("rate-limit rejection is retryable without a mail, cookie or storage write", async () => {
  const f = formFixture({ result: { limited: true } });
  const r = await f.request();
  assert.equal(r.status, 429);
  assert.equal(r.headers.get("retry-after"), "3600");
  assert.equal(r.headers.get("set-cookie"), null);
  assert.equal(f.effects.deliveries.length, 0);
});
test("cross-site requests and missing trusted Production IP fail closed", async () => {
  const f = formFixture();
  assert.equal(
    (await f.request({}, { origin: "https://evil.example" })).status,
    403,
  );
  assert.equal(
    (await f.request({}, { "x-vercel-forwarded-for": "" })).status,
    503,
  );
  assert.equal(f.effects.writes.length, 0);
});
test("an outage produces retryable failure without claiming successful registration", async () => {
  const f = formFixture({ error: true });
  const r = await f.request();
  assert.equal(r.status, 503);
  assert.equal(f.effects.deliveries.length, 0);
});
function mailFixture({ allowed = true, delivered = true, ready = true } = {}) {
  const calls = { send: [], finish: [] };
  const admin = {
    rpc: async (name, args) =>
      name === "claim_partner_interest_emails"
        ? {
            data: [
              {
                id: "queue",
                interest_id: "interest",
                email: allowed ? "fixture@example.test" : "other@example.test",
                claim_token: "claim",
              },
            ],
          }
        : (calls.finish.push(args), { error: null }),
  };
  const env = {
    VERCEL_ENV: "preview",
    STAGING_EMAIL_RECIPIENTS: "fixture@example.test",
  };
  const security = load("lib/accountSecurityAlerts.ts");
  const delivery = load(
    "lib/partnerInterestDelivery.ts",
    {
      "./privateAccountMail": {
        accountMailReady: () => ready,
        sendPrivateAccountMail: async (...args) => (
          calls.send.push(args),
          delivered
        ),
      },
      "./accountSecurityAlerts": security,
      "./partnerInterestCopy": copy,
    },
    { process: { env } },
  );
  return {
    calls,
    run: () => delivery.deliverPartnerInterestEmails(admin, "interest"),
  };
}
test("staging confirmation never sends to a non-allowlisted recipient", async () => {
  const f = mailFixture({ allowed: false });
  const result = await f.run();
  assert.equal(result.held, 1);
  assert.equal(f.calls.send.length, 0);
  assert.equal(f.calls.finish[0].p_outcome, "held");
});
test("confirmation uses approved thank-you wording and stable Resend idempotency identity", async () => {
  const f = mailFixture();
  const result = await f.run();
  assert.equal(result.sent, 1);
  assert.equal(f.calls.send[0][1], copy.PARTNER_INTEREST_THANK_YOU.title);
  assert.equal(
    f.calls.send[0][2],
    Object.values(copy.PARTNER_INTEREST_THANK_YOU).join("\n\n"),
  );
  assert.equal(f.calls.send[0][3], "partner-interest:interest");
  assert.equal(f.calls.finish[0].p_outcome, "sent");
});
test("failed delivery stays retryable and missing sender never claims an email", async () => {
  const f = mailFixture({ delivered: false });
  assert.equal((await f.run()).failed, 1);
  assert.equal(f.calls.finish[0].p_outcome, "retry");
  const off = mailFixture({ ready: false });
  assert.equal((await off.run()).configured, false);
  assert.equal(off.calls.send.length, 0);
  assert.equal(off.calls.finish.length, 0);
});
const operations = load("lib/workerOperations.ts");
function exportFixture({
  guard = false,
  auditFailure = false,
  completionFailure = false,
  pages = [[]],
} = {}) {
  const calls = [];
  const entries = [];
  const admin = {
    from(table) {
      if (table === "partner_interest_export_audits")
        return {
          insert(data) {
            calls.push("audit-start");
            entries.push(data);
            return {
              select: () => ({
                single: async () => ({
                  data: auditFailure ? null : { id: "audit" },
                  error: auditFailure ? {} : null,
                }),
              }),
            };
          },
          update(data) {
            calls.push("audit-complete");
            Object.assign(entries[0], data);
            return {
              eq: () => ({
                select: () => ({
                  single: async () => ({
                    data: completionFailure ? null : { id: "audit" },
                    error: null,
                  }),
                }),
              }),
            };
          },
        };
      assert.equal(table, "partner_interests");
      calls.push("private-read");
      const q = {
        select: () => q,
        order: () => q,
        limit: () => q,
        gt: () => q,
        then: (resolve) => resolve({ data: pages.shift() ?? [], error: null }),
      };
      return q;
    },
  };
  const api = load("app/api/admin/partner-interest/export/route.ts", {
    "next/server": { NextResponse },
    "@/lib/adminApi": {
      adminApi: async () =>
        guard
          ? NextResponse.json({ mfaRequired: true }, { status: 403 })
          : { user: { id: "staff" }, admin },
    },
    "@/lib/workerOperations": operations,
  });
  return {
    calls,
    entries,
    run: () =>
      api.GET(
        new Request(
          "https://staff.example.test/api/admin/partner-interest/export",
        ),
      ),
  };
}
test("Partner CSV export requires staff authenticator access before opening any records", async () => {
  const f = exportFixture({ guard: true });
  assert.equal((await f.run()).status, 403);
  assert.equal(f.calls.length, 0);
});
test("Partner CSV logs the actor before reading, audits every download, and blocks failed audits", async () => {
  const f = exportFixture();
  assert.equal((await f.run()).status, 200);
  assert.deepEqual(f.calls, ["audit-start", "private-read", "audit-complete"]);
  assert.equal(f.entries[0].actor_id, "staff");
  assert.ok(f.entries[0].completed_at);
  assert.equal(f.entries[0].row_count, 0);
  const failure = exportFixture({ auditFailure: true });
  assert.equal((await failure.run()).status, 503);
  assert.deepEqual(failure.calls, ["audit-start"]);
  const incomplete = exportFixture({ completionFailure: true });
  assert.equal((await incomplete.run()).status, 503);
});
test("CSV includes every page, neutralises spreadsheet formulas, and keeps sensitive row data out of the audit", async () => {
  const rows = Array.from({ length: 501 }, (_, i) => ({
    id: String(i).padStart(4, "0"),
    full_name: '=HYPERLINK("bad")',
    email: "fixture@example.test",
  }));
  const f = exportFixture({ pages: [rows.slice(0, 500), rows.slice(500)] });
  const response = await f.run();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /private, no-store/);
  const csv = await response.text();
  assert.match(csv, /'=HYPERLINK/);
  assert.equal(f.entries[0].row_count, 501);
  assert.equal(f.calls.filter((c) => c === "private-read").length, 2);
  assert.doesNotMatch(JSON.stringify(f.entries), /HYPERLINK|fixture@example/);
});
