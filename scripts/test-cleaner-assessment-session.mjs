// Real route execution with fictional capabilities and isolated database calls.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { NextRequest, NextResponse } from "next/server.js";
const require = createRequire(import.meta.url);
const invitation = "a".repeat(64);
const session = "b".repeat(64);
const attemptId = "00000000-0000-4000-8000-000000000001";
const cookie = "__Host-opulence-cleaner-assessment";
function fixture(options = {}) {
  const calls = [];
  const env = {
    VERCEL_ENV: "preview",
    CLEANER_STAGE2_ENABLED: "true",
    NEXT_PUBLIC_SUPABASE_URL: "https://comwdjprdedmsnxtvuuk.supabase.co",
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
        require: (name) => {
          if (name === "server-only") return {};
          if (name === "next/server") return { NextRequest, NextResponse };
          if (name === "@supabase/supabase-js")
            return {
              createClient: () => ({
                rpc: async (name, params) => {
                  calls.push({ name, params });
                  return options.fail
                    ? { error: { message: "TEST PRIVATE DATABASE ERROR" } }
                    : {
                        data: {
                          attemptId,
                          phase: options.phase ?? "questions",
                        },
                      };
                },
              }),
            };
          if (name === "@/lib/accountApi")
            return {
              isSameOriginMutation: (r) =>
                r.headers.get("origin") === r.nextUrl.origin,
            };
          if (name === "@/lib/cleanerApplication")
            return load("lib/cleanerApplication.ts");
          if (name === "./ukPhone") return load("lib/ukPhone.ts");
          return require(name);
        },
      },
    );
    return mod.exports;
  }
  return { route: load("app/api/cleaner-assessment/session/route.ts"), calls };
}
function request(method, data, extraHeaders = {}) {
  return new NextRequest(
    "https://staging.example.invalid/api/cleaner-assessment/session",
    {
      method,
      headers: {
        origin: "https://staging.example.invalid",
        "content-type": "application/json",
        ...extraHeaders,
      },
      body: JSON.stringify(data),
    },
  );
}
test("assessment prototype is inaccessible on Production even when flagged on", async () => {
  const f = fixture({ env: { VERCEL_ENV: "production" } });
  assert.equal(
    (await f.route.POST(request("POST", { invitation, rulesAccepted: true })))
      .status,
    404,
  );
  assert.equal(f.calls.length, 0);
});
test("assessment prototype refuses a different database and disabled flag", async () => {
  for (const env of [
    { NEXT_PUBLIC_SUPABASE_URL: "https://example.invalid" },
    { CLEANER_STAGE2_ENABLED: "false" },
  ]) {
    const f = fixture({ env });
    assert.equal(
      (await f.route.POST(request("POST", { invitation, rulesAccepted: true })))
        .status,
      404,
    );
    assert.equal(f.calls.length, 0);
  }
});
test("cross-site assessment mutations are refused", async () => {
  const f = fixture();
  assert.equal(
    (
      await f.route.POST(
        request(
          "POST",
          { invitation, rulesAccepted: true },
          { origin: "https://other.example.invalid" },
        ),
      )
    ).status,
    403,
  );
  assert.equal(f.calls.length, 0);
});
test("starting requires an invitation capability and explicit rules acceptance", async () => {
  for (const data of [
    { invitation, rulesAccepted: false },
    { invitation: "bad", rulesAccepted: true },
  ]) {
    const f = fixture();
    assert.equal((await f.route.POST(request("POST", data))).status, 400);
    assert.equal(f.calls.length, 0);
  }
});
test("limited session uses a secure HttpOnly cookie and passes only hashes to the server", async () => {
  const f = fixture();
  const response = await f.route.POST(
    request("POST", {
      invitation,
      rulesAccepted: true,
      userId: "TEST ignored",
      score: 15,
    }),
  );
  assert.equal(response.status, 200);
  const saved = response.cookies.get(cookie);
  assert.match(saved.value, /^[a-f0-9]{64}$/);
  assert.equal(saved.httpOnly, true);
  assert.equal(saved.secure, true);
  assert.equal(saved.sameSite, "strict");
  assert.equal(saved.path, "/");
  assert.notEqual(f.calls[0].params.p_invitation_hash, invitation);
  assert.notEqual(f.calls[0].params.p_session_hash, saved.value);
  assert.deepEqual(Object.keys(f.calls[0].params).sort(), [
    "p_invitation_hash",
    "p_rules_accepted",
    "p_session_hash",
  ]);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});
test("commands cannot use a submitted session or score instead of their cookie", async () => {
  const f = fixture();
  assert.equal(
    (
      await f.route.PATCH(
        request("PATCH", {
          attemptId,
          action: "heartbeat",
          session,
          score: 15,
        }),
      )
    ).status,
    401,
  );
  assert.equal(f.calls.length, 0);
});
test("device cannot submit marks, timing, status or identity to the command RPC", async () => {
  const f = fixture();
  const response = await f.route.PATCH(
    request(
      "PATCH",
      {
        attemptId,
        action: "heartbeat",
        score: 15,
        correct: true,
        userId: "TEST",
        receivedAt: "TEST",
        phase: "passed",
      },
      { cookie: `${cookie}=${session}` },
    ),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(f.calls[0].params).sort(), [
    "p_action",
    "p_attempt",
    "p_choice",
    "p_position",
    "p_session_hash",
    "p_writing",
  ]);
  assert.notEqual(f.calls[0].params.p_session_hash, session);
});
test("finished or failed assessment clears its limited login cookie", async () => {
  const f = fixture({ phase: "failed" });
  const response = await f.route.PATCH(
    request(
      "PATCH",
      { attemptId, action: "page_left" },
      { cookie: `${cookie}=${session}` },
    ),
  );
  assert.equal(response.cookies.get(cookie).maxAge, 0);
});
test("writing review retains the limited session for waiting on a human mark", async () => {
  const f = fixture({ phase: "writing_review" });
  const response = await f.route.PATCH(
    request(
      "PATCH",
      { attemptId, action: "heartbeat" },
      { cookie: `${cookie}=${session}` },
    ),
  );
  assert.equal(response.status, 200);
  assert.equal(response.cookies.get(cookie), undefined);
});
test("database errors never expose internal data or answer details", async () => {
  const f = fixture({ fail: true });
  const response = await f.route.POST(
    request("POST", { invitation, rulesAccepted: true }),
  );
  assert.equal(response.status, 403);
  assert.doesNotMatch(await response.text(), /PRIVATE DATABASE/);
});
