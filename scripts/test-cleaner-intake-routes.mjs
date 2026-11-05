import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { NextRequest, NextResponse } from "next/server.js";
const require = createRequire(import.meta.url);
const origin = "https://staging.example.invalid";
const fictional = {
  website: "",
  fullName: "TEST Applicant",
  email: "applicant@example.invalid",
  phone: "02079460001",
  postcode: "SW1A 1AA",
  areas: ["TEST area"],
  experience: "TEST experience",
  availability: "TEST morning",
  rightToWorkType: "TEST evidence",
  checksAcknowledged: true,
};
function fixture(options = {}) {
  const calls = [];
  const env = {
    VERCEL: "1",
    VERCEL_ENV: "preview",
    CLEANER_STAGE2_ENABLED: "true",
    NEXT_PUBLIC_SUPABASE_URL: "https://comwdjprdedmsnxtvuuk.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "TEST-ONLY-NOT-A-CREDENTIAL",
    ...options.env,
  };
  function load(file) {
    const mod = { exports: {} };
    vm.runInNewContext(
      ts.transpileModule(readFileSync(file, "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText,
      {
        module: mod,
        exports: mod.exports,
        process: { env },
        URL,
        Buffer,
        require(name) {
          if (name === "next/server") return { NextRequest, NextResponse };
          if (name === "@/lib/accountApi")
            return {
              isSameOriginMutation: (r) => r.headers.get("origin") === origin,
            };
          if (name === "@/lib/finalLegalPack")
            return { finalLegalDocument: () => ({ version: "TEST-1" }) };
          if (name === "@supabase/supabase-js")
            return {
              createClient: () => ({
                rpc: async (name, params) => {
                  calls.push([name, params]);
                  return options.fail
                    ? { error: { message: "TEST PRIVATE INTERNAL DATA" } }
                    : { data: { ok: true, limited: options.limited } };
                },
              }),
            };
          if (name.startsWith("@/lib/"))
            return load(resolve("lib", `${name.slice(6)}.ts`));
          if (name.startsWith("./"))
            return load(resolve(dirname(file), `${name}.ts`));
          return require(name);
        },
      },
    );
    return mod.exports;
  }
  const route = load(resolve("app/api/cleaner-applications/route.ts"));
  return { route, calls };
}
function request(body = fictional, headers = {}) {
  return new NextRequest(`${origin}/api/cleaner-applications`, {
    method: "POST",
    headers: {
      origin,
      "Content-Type": "application/json",
      "x-vercel-forwarded-for": "192.0.2.1",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
test("intake refuses Production and wrong database before using service credentials", async () => {
  for (const env of [
    { VERCEL_ENV: "production" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://uiqcsihgqaktpjumyeap.supabase.co" },
  ]) {
    const f = fixture({ env });
    assert.equal((await f.route.POST(request())).status, 404);
    assert.equal(f.calls.length, 0);
  }
});
test("cross-site requests, missing consent and passwords never reach intake", async () => {
  for (const [body, headers, status] of [
    [fictional, { origin: "https://other.example.invalid" }, 403],
    [{ ...fictional, checksAcknowledged: false }, {}, 400],
    [{ ...fictional, password: "TEST password not accepted" }, {}, 400],
  ]) {
    const f = fixture();
    assert.equal((await f.route.POST(request(body, headers))).status, status);
    assert.equal(f.calls.length, 0);
  }
});
test("honeypot has no account, email or record side effects", async () => {
  const f = fixture();
  assert.equal(
    (await f.route.POST(request({ ...fictional, website: "bot" }))).status,
    200,
  );
  assert.equal(f.calls.length, 0);
});
test("oversized and malformed application data are refused", async () => {
  for (const body of ["bad json", "x".repeat(16001)]) {
    const f = fixture();
    assert.ok([400, 413].includes((await f.route.POST(request(body))).status));
    assert.equal(f.calls.length, 0);
  }
});
test("deployment requires a platform-verified IP instead of trusting a client header", async () => {
  const f = fixture();
  assert.equal(
    (
      await f.route.POST(
        request(fictional, {
          "x-vercel-forwarded-for": "bad",
          "x-forwarded-for": "192.0.2.1",
        }),
      )
    ).status,
    503,
  );
  assert.equal(f.calls.length, 0);
});
test("server owns consent wording and status; public response contains no record or login", async () => {
  const f = fixture();
  const response = await f.route.POST(
    request({
      ...fictional,
      declaration: "forged",
      status: "active",
      role: "admin",
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  const [name, params] = f.calls[0];
  assert.equal(name, "intake_cleaner_application");
  assert.match(params.p_declaration, /^\[Onboarding Process 3.1A/);
  assert.equal(params.p_privacy_version, "TEST-1");
  assert.equal(params.p_details.status, undefined);
  assert.equal(params.p_details.role, undefined);
  assert.match(params.p_rate_key, /^[a-f0-9]{64}$/);
});
test("rate-limit and database failures are safe and carry no private detail", async () => {
  const limited = fixture({ limited: true });
  assert.equal((await limited.route.POST(request())).status, 429);
  const failed = fixture({ fail: true });
  const response = await failed.route.POST(request());
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /PRIVATE INTERNAL/);
});
