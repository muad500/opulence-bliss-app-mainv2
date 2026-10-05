import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);

async function load(relativePath, mocks) {
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
    process,
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
