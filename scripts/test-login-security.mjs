import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);

async function load(relativePath, mocks, env = process.env) {
  const source = await readFile(new URL("../" + relativePath, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    require: (id) => {
      if (!(id in mocks)) return require(id);
      const mock = mocks[id];
      return "default" in mock ? { __esModule: true, ...mock } : mock;
    },
    process: { env },
    console,
  }, { filename: relativePath });
  return module.exports;
}

const redirect = (location) => { throw new Error("redirect:" + location); };

function client({ user = null, profile = null, authError = null, profileError = null } = {}) {
  return {
    auth: { getUser: async () => ({ data: { user }, error: authError }) },
    from: () => ({ select: () => ({ eq: () => ({
      maybeSingle: async () => ({ data: profile, error: profileError }),
    }) }) }),
  };
}

async function session(fixture) {
  return load("lib/adminSession.ts", {
    "server-only": {},
    "next/navigation": { redirect },
    "@/lib/supabase/server": { createClient: async () => client(fixture) },
  });
}

test("client and professional login render without demo buttons and retain signup", async () => {
  const { default: RoleLogin } = await load("app/login/RoleLogin.tsx", {
    "next/link": { default: ({ href, children, ...props }) => React.createElement("a", { href, ...props }, children) },
    "@/lib/supabase/client": { createClient: () => ({}) },
    "@/components/GoogleAuthButton": { default: () => null },
  });
  for (const mode of ["client", "provider"]) {
    const html = renderToStaticMarkup(React.createElement(RoleLogin, { mode }));
    assert.doesNotMatch(html, /demo account|class="demo"/i);
    assert.match(html, /Sign up/);
    assert.match(html, /type="password"/);
  }
});

test("anonymous and invalid sessions cannot enter admin pages", async () => {
  for (const fixture of [{}, { user: { id: "admin" }, authError: new Error("expired") }]) {
    const { requireAdminPage } = await session(fixture);
    await assert.rejects(requireAdminPage(), /redirect:\/staff\/login$/);
  }
});

test("client, professional, missing, deleted and failed profile lookups are refused", async () => {
  for (const fixture of [
    { profile: { role: "customer" } },
    { profile: { role: "provider" } },
    { profile: null },
    { profile: { role: "admin", account_deleted_at: "2026-10-05" } },
    { profile: { role: "admin" }, profileError: new Error("lookup failed") },
  ]) {
    const { requireAdminPage } = await session({ user: { id: "user" }, ...fixture });
    await assert.rejects(requireAdminPage(), /redirect:\/staff\/login\?error=access/);
  }
});

test("active administrator can enter and the shared admin layout enforces the guard", async () => {
  const guard = await session({ user: { id: "admin" }, profile: { role: "admin", full_name: "Admin", account_deleted_at: null } });
  assert.equal((await guard.requireAdminPage()).user.id, "admin");
  let calls = 0;
  const { default: AdminLayout } = await load("app/admin/layout.tsx", {
    "@/lib/adminSession": { requireAdminPage: async () => { calls++; return guard.requireAdminPage(); } },
    "@/components/PortalLiveSync": { default: () => null },
  });
  assert.match(renderToStaticMarkup(await AdminLayout({ children: "Private dashboard" })), /Private dashboard/);
  assert.equal(calls, 1);
  const denied = await session({ user: { id: "client" }, profile: { role: "customer" } });
  const { default: DeniedLayout } = await load("app/admin/layout.tsx", {
    "@/lib/adminSession": denied,
    "@/components/PortalLiveSync": { default: () => null },
  });
  await assert.rejects(DeniedLayout({ children: "Private dashboard" }), /redirect:/);
});

test("old admin login redirects to the separate staff login", async () => {
  const { default: LegacyLogin } = await load("app/admin/login/page.tsx", { "next/navigation": { redirect } });
  assert.throws(LegacyLogin, /redirect:\/staff\/login$/);
});

const enabledPreview = {
  VERCEL_ENV: "preview", NODE_ENV: "production",
  DEVELOPMENT_TOOLS_ENABLED: "true", STRIPE_SECRET_KEY: "sk_test_fixture",
};
const tools = await load("lib/developmentTools.ts", {});

test("production never enables development tools; missing configuration fails closed", () => {
  for (const key of [undefined, "sk_test_fixture", "sk_live_fixture", "invalid"]) {
    for (const optIn of [undefined, "false", "true"]) {
      assert.equal(tools.developmentToolsEnabled({
        VERCEL_ENV: "production", NODE_ENV: "development",
        DEVELOPMENT_TOOLS_ENABLED: optIn, STRIPE_SECRET_KEY: key,
      }), false);
    }
  }
  for (const env of [
    {}, { ...enabledPreview, VERCEL_ENV: undefined },
    { ...enabledPreview, DEVELOPMENT_TOOLS_ENABLED: undefined },
    { ...enabledPreview, STRIPE_SECRET_KEY: undefined },
    { ...enabledPreview, STRIPE_SECRET_KEY: "sk_test_" },
    { ...enabledPreview, STRIPE_SECRET_KEY: "sk_live_fixture" },
    { ...enabledPreview, VERCEL_ENV: "unknown" },
  ]) assert.equal(tools.developmentToolsEnabled(env), false);
  assert.equal(tools.developmentToolsEnabled(enabledPreview), true);
  assert.equal(tools.developmentToolsEnabled({
    ...enabledPreview, VERCEL_ENV: undefined, NODE_ENV: "development",
  }), true);
});

const pureDependencies = {
  "@/lib/bookingState": {}, "@/lib/offerRotation": {},
  "@/lib/verificationRenewal": {}, "@/lib/prepaidVisitPayout": {},
  "@/lib/tipPayout": {}, "@/lib/legacyDestinationCapture": {},
  "@/lib/payoutDestination": {}, "@/lib/reviewVisibility": {}, "@/lib/email": {},
  "@/lib/developmentTools": tools, "next/cache": { revalidatePath: () => {} },
};

test("each destructive admin action refuses production before reading or mutating activity", async () => {
  for (const env of [
    { ...enabledPreview, VERCEL_ENV: "production" },
    { ...enabledPreview, STRIPE_SECRET_KEY: undefined },
    { ...enabledPreview, STRIPE_SECRET_KEY: "sk_live_fixture" },
    { ...enabledPreview, DEVELOPMENT_TOOLS_ENABLED: undefined },
  ]) {
    const signedIn = client({ user: { id: "admin" }, profile: { role: "admin" } });
    const from = signedIn.from;
    signedIn.from = (table) => {
      assert.equal(table, "profiles", "activity tables must not be accessed");
      return from(table);
    };
    const actions = await load("app/admin/actions.ts", {
      ...pureDependencies,
      "@/lib/supabase/server": { createClient: async () => signedIn },
      "@supabase/supabase-js": { createClient: () => ({
        rpc: () => assert.fail("reset RPC must not run"),
      }) },
    }, env);
    for (const name of ["wipeReviews", "wipeAvailability", "bringBookingToNow", "resetPrototypeData"]) {
      await assert.rejects(actions[name](), /is disabled/);
    }
  }
});

test("prototype reconciliation cleanup is blocked on production and retains live transfers", async () => {
  async function fixture(env) {
    const closed = [];
    let resetReads = 0;
    const signedIn = client({ user: { id: "admin" }, profile: { role: "admin" } });
    const from = signedIn.from;
    signedIn.from = (table) => table === "profiles" ? from(table) : ({
      select: () => ({ eq: () => ({ in: async () => ({ data: [
        { id: "live", stripe_object_id: "tr_live" },
        { id: "unknown", stripe_object_id: "tr_unknown" },
        { id: "oldTest", stripe_object_id: "tr_oldTest" },
        { id: "newTest", stripe_object_id: "tr_newTest" },
      ] }) }) }),
    });
    signedIn.rpc = async (name, args) => { closed.push(args.p_finding_id); return { error: null }; };
    const actions = await load("app/admin/resolution-actions.ts", {
      ...pureDependencies,
      "stripe": { default: class { transfers = { retrieve: async (id) => ({
        livemode: id === "tr_live" ? true : id === "tr_unknown" ? undefined : false,
        created: id === "tr_newTest" ? 300 : 100,
      }) }; } },
      "@/lib/supabase/server": { createClient: async () => signedIn },
      "@supabase/supabase-js": { createClient: () => ({ rpc: async () => {
        resetReads++; return { data: new Date(200000).toISOString(), error: null };
      } }) },
    }, env);
    return { actions, closed, reads: () => resetReads };
  }
  const prod = await fixture({ ...enabledPreview, VERCEL_ENV: "production" });
  await assert.rejects(prod.actions.closePreResetTransferFindings(), /is disabled/);
  assert.equal(prod.reads(), 0);
  assert.equal(prod.closed.length, 0);
  const preview = await fixture(enabledPreview);
  assert.equal((await preview.actions.closePreResetTransferFindings()).ok, true);
  assert.deepEqual(preview.closed, ["oldTest"]);
});

test("production forced check-in cannot skip the visit window or location check", async () => {
  for (const scheduledAt of [new Date(Date.now() + 86400000).toISOString(), new Date().toISOString()]) {
    const actions = await load("app/worker/actions.ts", {
      ...pureDependencies,
      "stripe": { default: class {} },
      "@/lib/supabase/server": { createClient: async () => client({ user: { id: "worker" } }) },
      "@supabase/supabase-js": { createClient: () => ({
        from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({
          data: { scheduled_at: scheduledAt, address: "SW1A 1AA" },
        }) }) }) }),
        rpc: () => assert.fail("check-in challenge must not be created"),
      }) },
    }, { ...enabledPreview, VERCEL_ENV: "production", ALLOW_EARLY_CHECKIN: "true" });
    const result = await actions.checkInJob("booking", null, null, true);
    assert.equal(result.blocked, true);
    assert.equal(result.canForce, false);
  }
});

test("production admin pages omit development tools even for an administrator", async () => {
  const env = { ...enabledPreview, VERCEL_ENV: "production" };
  const database = {
    auth: { getUser: async () => ({ data: { user: { id: "admin", email: "private" } } }) },
    from: (table) => {
      const query = {
        then: (resolve) => resolve({ data: table === "reconciliation_findings" ? [{
          id: "finding", finding_type: "stripe_transfer_without_local_payout",
          severity: "info", detected_at: new Date().toISOString(),
        }] : [], count: 0, error: null }),
        maybeSingle: async () => ({ data: { role: "admin" } }),
      };
      for (const method of ["select", "eq", "in", "order", "limit", "or"]) query[method] = () => query;
      return query;
    },
  };
  const component = () => null;
  const mocks = {
    "@/lib/developmentTools": tools,
    "@/lib/supabase/server": { createClient: async () => database },
    "next/link": { default: ({ href, children }) => React.createElement("a", { href }, children) },
    "./AdminButtons": { default: () => assert.fail("production must not render reset tools") },
    "./VettingButtons": { default: component }, "./ReviewList": { default: component },
    "./AdminNav": { default: component }, "../AdminNav": { default: component },
    "@/lib/adminReviews": { loadAdminReviews: async () => ({ reviews: [], error: null }) },
    "./DeskControls": { default: component, PrototypeFindingsCleanup: () => assert.fail("cleanup must not render") },
  };
  for (const path of ["app/admin/page.tsx", "app/admin/review/page.tsx"]) {
    const { default: Page } = await load(path, mocks, env);
    const html = renderToStaticMarkup(await Page());
    assert.doesNotMatch(html, /Development tools|Reset tools|Useful between demos/);
  }
});
