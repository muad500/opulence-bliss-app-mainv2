import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import { NextRequest } from "next/server.js";

const require = createRequire(import.meta.url);
async function load(path, mocks = {}, env = {}) {
  const source = await readFile(new URL("../" + path, import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: (id) => (id in mocks ? mocks[id] : require(id)),
    URL,
    process: { env, cwd: () => process.cwd() },
  });
  return module.exports;
}
const hosts = await load("lib/adminHosts.ts");

test("legacy redirects cannot run before staff host routing", async () => {
  const { default: config } = await load("next.config.ts");
  assert.equal(config.redirects, undefined);
  const { proxy } = await load(
    "proxy.ts",
    {
      "@/lib/adminHosts": hosts,
      "@/lib/handymanMarketplace": { isHandymanMarketplacePath: () => false },
      "@/lib/supabase/proxy": {
        updateSession: () => assert.fail("Redirects must precede auth"),
      },
    },
    { VERCEL_ENV: "production" },
  );
  for (const path of [
    "/",
    "/services/massage",
    "/blog/benefits-of-massage-at-home",
  ])
    assert.equal(
      (
        await proxy(
          new NextRequest(
            "https://admin.opulencebliss.com" + path + "?source=test",
          ),
        )
      ).headers.get("location"),
      "https://www.opulencebliss.com" + path + "?source=test",
    );
  for (const [path, target] of [
    ["/services/massage", "/services/cleaning"],
    ["/blog/benefits-of-massage-at-home", "/blog"],
  ]) {
    const result = await proxy(
      new NextRequest("https://www.opulencebliss.com" + path + "?source=test"),
    );
    assert.equal(result.status, 308);
    assert.equal(
      result.headers.get("location"),
      "https://www.opulencebliss.com" + target + "?source=test",
    );
  }
});

test("host redirects run before auth or marketplace reads, preserve queries and ignore spoofed forwarded hosts", async () => {
  let sessions = 0;
  const { proxy } = await load(
    "proxy.ts",
    {
      "@/lib/adminHosts": hosts,
      "@/lib/handymanMarketplace": { isHandymanMarketplacePath: () => false },
      "@/lib/supabase/proxy": {
        updateSession: () => {
          sessions++;
          return new Response("session");
        },
      },
    },
    { VERCEL_ENV: "production" },
  );
  for (const path of [
    "/admin",
    "/admin/reviews?page=2",
    "/staff/login",
    "/staff/mfa",
    "/staff/forgot-password",
    "/api/admin/billing-settings",
    "/admin/customers/example.png",
    "/%61dmin/settings",
    "/staff%2Flogin",
  ]) {
    const response = await proxy(
      new NextRequest("https://www.opulencebliss.com" + path, {
        headers: { "x-forwarded-host": "admin.opulencebliss.com" },
      }),
    );
    assert.equal(response.status, 307);
    assert.equal(
      response.headers.get("location"),
      "https://admin.opulencebliss.com" + path,
    );
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal(sessions, 0);
  for (const path of ["/login", "/provider/login", "/book", "/account"])
    assert.equal(
      await (
        await proxy(new NextRequest("https://www.opulencebliss.com" + path))
      ).text(),
      "session",
    );
  assert.equal(sessions, 4);
});

test("staff recovery callback admits only an active admin and ignores open-redirect destinations", async () => {
  for (const fixture of [
    { role: "customer" },
    { role: "provider" },
    { role: "admin", deleted: true },
    { role: "admin", pass: true },
  ]) {
    let signedOut = 0;
    const client = {
      auth: {
        exchangeCodeForSession: async () => ({ error: null }),
        getUser: async () => ({ data: { user: { id: "fixture" } } }),
        signOut: async () => {
          signedOut++;
        },
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                role: fixture.role,
                account_deleted_at: fixture.deleted ? "2026-01-01" : null,
              },
            }),
          }),
        }),
      }),
    };
    const { GET } = await load("app/staff/callback/route.ts", {
      "@/lib/supabase/server": { createClient: async () => client },
    });
    const result = await GET(
      new NextRequest(
        "https://admin.opulencebliss.com/staff/callback?code=fixture&next=https://attacker.example",
      ),
    );
    assert.equal(
      result.headers.get("location"),
      fixture.pass
        ? "https://admin.opulencebliss.com/staff/update-password"
        : "https://admin.opulencebliss.com/staff/login?error=recovery",
    );
    assert.equal(signedOut, fixture.pass ? 0 : 1);
  }
});

test("missing and invalid recovery codes cannot reach staff profile reads", async () => {
  let reads = 0;
  const { GET } = await load("app/staff/callback/route.ts", {
    "@/lib/supabase/server": {
      createClient: async () => ({
        auth: {
          exchangeCodeForSession: async () => ({ error: new Error("expired") }),
        },
        from: () => {
          reads++;
          throw Error("No read expected");
        },
      }),
    },
  });
  for (const query of ["", "?code=expired"])
    assert.equal(
      (
        await GET(
          new NextRequest(
            "https://admin.opulencebliss.com/staff/callback" + query,
          ),
        )
      ).headers.get("location"),
      "https://admin.opulencebliss.com/staff/login?error=recovery",
    );
  assert.equal(reads, 0);
});
