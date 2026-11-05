// Staff routes execute against isolated, fictional auth/RPC substitutes only.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { NextRequest, NextResponse } from "next/server.js";
const require = createRequire(import.meta.url);
const uuid = "00000000-0000-4000-8000-000000000001";
function fixture(options = {}) {
  const calls = [];
  const mod = { exports: {} };
  const env = {
    VERCEL_ENV: "preview",
    CLEANER_STAGE2_ENABLED: "true",
    NEXT_PUBLIC_SUPABASE_URL: "https://comwdjprdedmsnxtvuuk.supabase.co",
    CRON_SECRET: "TEST-ONLY-NOT-A-REAL-SECRET",
    ...options.env,
  };
  function load(file) {
    const m = { exports: {} };
    vm.runInNewContext(
      ts.transpileModule(readFileSync(file, "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText,
      {
        module: m,
        exports: m.exports,
        process: { env },
        URL,
        Buffer,
        Response,
        require: (name) => {
          if (name === "@/lib/cleanerAssessmentDelivery")
            return {
              deliverCleanerAssessmentDecisions: async () => ({
                sent: 0,
                failed: 0,
                configured: false,
              }),
            };
          if (name === "next/server") return { NextRequest, NextResponse };
          if (name === "@/lib/cleanerApplication")
            return load("lib/cleanerApplication.ts");
          if (name === "./ukPhone") return load("lib/ukPhone.ts");
          if (name === "@supabase/supabase-js")
            return {
              createClient: () => ({
                rpc: async (name) => {
                  calls.push([name]);
                  return options.rpcFail
                    ? { error: { message: "TEST PRIVATE INTERNAL ERROR" } }
                    : {
                        data:
                          name === "purge_expired_cleaner_applications"
                            ? { assessments: 0, applications: 0 }
                            : 1,
                      };
                },
              }),
            };
          if (name === "@/lib/adminApi")
            return {
              adminApi: async (request, permission) => {
                calls.push(["staff-guard", permission]);
                if (options.denied)
                  return NextResponse.json(
                    { error: "TEST authentication required" },
                    { status: 401 },
                  );
                return {
                  staffRole: "manager",
                  client: {
                    rpc: async (name, params) => {
                      calls.push([name, params]);
                      if (options.rpcFail)
                        return {
                          error: { message: "TEST PRIVATE INTERNAL ERROR" },
                        };
                      return {
                        data: name.endsWith("settings")
                          ? { confirmAutomaticFail: false }
                          : [],
                      };
                    },
                  },
                  admin: {
                    rpc: () => {
                      throw Error(
                        "The staff console must not use the service-role client",
                      );
                    },
                  },
                };
              },
            };
          return require(name);
        },
      },
    );
    return m.exports;
  }
  mod.exports = load(
    options.route ?? "app/api/admin/cleaner-assessment/route.ts",
  );
  return { route: mod.exports, calls };
}
function request(body) {
  return new NextRequest(
    "https://staging.example.invalid/api/admin/cleaner-assessment",
    {
      method: body ? "POST" : "GET",
      headers: {
        origin: "https://staging.example.invalid",
        "content-type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
}
test("assessment staff console is inaccessible on production", async () => {
  const f = fixture({ env: { VERCEL_ENV: "production" } });
  assert.equal((await f.route.GET(request())).status, 404);
  assert.equal(f.calls.length, 0);
});
test("staff authentication denial prevents every console RPC", async () => {
  const f = fixture({ denied: true });
  assert.equal((await f.route.GET(request())).status, 401);
  assert.deepEqual(f.calls, [["staff-guard", "onboarding"]]);
});
test("overview uses bounded RPCs with the caller's staff session only", async () => {
  const f = fixture();
  assert.equal((await f.route.GET(request())).status, 200);
  assert.deepEqual(
    f.calls.map((x) => x[0]),
    [
      "staff-guard",
      "staff_cleaner_assessment_settings",
      "staff_cleaner_assessment_overview",
    ],
  );
});
test("marking routes only the supplied decision and logged reason, not scores", async () => {
  const f = fixture();
  const response = await f.route.POST(
    request({
      action: "mark_writing",
      attemptId: uuid,
      passed: true,
      reason: "TEST human assessment reason",
      score: 15,
      correct: true,
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(f.calls[1][0], "staff_mark_cleaner_writing");
  assert.deepEqual(Object.keys(f.calls[1][1]).sort(), [
    "p_attempt",
    "p_passed",
    "p_reason",
  ]);
});
test("human marking and Manager decisions require a reason", async () => {
  const f = fixture();
  assert.equal(
    (
      await f.route.POST(
        request({
          action: "review",
          attemptId: uuid,
          decision: "reopen",
          reason: "",
        }),
      )
    ).status,
    400,
  );
  assert.equal(f.calls.length, 1);
});
test("adjustments never forward medical details or free-text reasons", async () => {
  const f = fixture();
  assert.equal(
    (
      await f.route.POST(
        request({
          action: "adjustment",
          applicationId: uuid,
          multiplier: 2,
          reason: "TEST medical detail must not be stored",
        }),
      )
    ).status,
    200,
  );
  assert.deepEqual(Object.keys(f.calls[1][1]).sort(), [
    "p_application",
    "p_multiplier",
  ]);
});
test("staff cannot call arbitrary RPCs through the console", async () => {
  const f = fixture();
  assert.equal(
    (
      await f.route.POST(
        request({
          action: "activate_provider",
          reason: "TEST ignored action",
          applicationId: uuid,
        }),
      )
    ).status,
    400,
  );
  assert.equal(f.calls.length, 1);
});
test("staff RPC failures do not expose private internal errors", async () => {
  const f = fixture({ rpcFail: true });
  const result = await f.route.POST(
    request({
      action: "automatic_fail",
      enabled: true,
      reason: "TEST reason for setting",
    }),
  );
  assert.equal(result.status, 409);
  assert.doesNotMatch(await result.text(), /PRIVATE INTERNAL/);
});
const cronRoute = "app/api/cron/cleaner-assessments/route.ts";
const cronRequest = (authorization) =>
  new NextRequest(
    "https://staging.example.invalid/api/cron/cleaner-assessments",
    { headers: authorization ? { authorization } : {} },
  );
test("assessment recovery refuses production before reading credentials or calling the database", async () => {
  const f = fixture({ route: cronRoute, env: { VERCEL_ENV: "production" } });
  assert.equal((await f.route.GET(cronRequest())).status, 404);
  assert.equal(f.calls.length, 0);
});
test("assessment recovery requires the configured scheduler secret", async () => {
  for (const authorization of [undefined, "Bearer wrong"]) {
    const f = fixture({ route: cronRoute });
    assert.equal((await f.route.GET(cronRequest(authorization))).status, 401);
    assert.equal(f.calls.length, 0);
  }
});
test("authorised staging recovery returns only a processed count", async () => {
  const f = fixture({ route: cronRoute });
  const response = await f.route.GET(
    cronRequest("Bearer TEST-ONLY-NOT-A-REAL-SECRET"),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    processed: 1,
    retention: { assessments: 0, applications: 0 },
    decisions: { sent: 0, failed: 0, configured: false },
  });
  assert.deepEqual(f.calls, [
    ["sweep_cleaner_assessments"],
    ["purge_expired_cleaner_applications"],
  ]);
});
test("recovery failures reveal no private database details", async () => {
  const f = fixture({ route: cronRoute, rpcFail: true });
  const response = await f.route.GET(
    cronRequest("Bearer TEST-ONLY-NOT-A-REAL-SECRET"),
  );
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /PRIVATE INTERNAL/);
});
