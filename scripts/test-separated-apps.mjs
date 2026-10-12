import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
const require = createRequire(import.meta.url);
async function load(file, mocks = {}) {
  const source = await readFile(new URL("../" + file, import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    Response,
    URL,
    console,
    require: (id) => {
      if (id.endsWith(".module.css")) return { __esModule: true, default: {} };
      const mock = mocks[id];
      if (mock) return "default" in mock ? { __esModule: true, ...mock } : mock;
      return require(id);
    },
  });
  return module.exports;
}
const experience = await load("lib/mobileExperience.ts");
const mocks = {
  "next/link": {
    default: ({ children, ...props }) =>
      React.createElement("a", props, children),
  },
  "next/navigation": {
    useRouter: () => ({ replace() {}, push() {}, back() {}, refresh() {} }),
    usePathname: () => "/mobile/customer",
  },
  "@/lib/mobileExperience": experience,
  "@/lib/supabase/client": { createClient: () => ({}) },
  "./LoadingState": {
    default: () => React.createElement("p", null, "Loading"),
  },
};

test("customer home and tabs do not offer recruitment, jobs or account-mode labels", async () => {
  const { default: Home } = await load("components/MobileAppHome.tsx", mocks);
  const html = renderToStaticMarkup(
    React.createElement(Home, {
      audience: "customer",
      screen: null,
      name: "",
      signedIn: false,
      nextVisit: null,
    }),
  );
  assert.match(html, /Book a clean/);
  assert.match(html, /Create account/);
  assert.doesNotMatch(
    html,
    /Apply to join|My jobs|client account|worker account|\/provider\/|\/worker\//i,
  );
  assert.deepEqual(
    Array.from(experience.appTabs("customer")).map((t) => t.label),
    ["Home", "Bookings", "Inbox", "Account"],
  );
});

test("worker home has its own sign-in and application, with no customer booking navigation", async () => {
  const { default: Home } = await load("components/MobileAppHome.tsx", mocks);
  const html = renderToStaticMarkup(
    React.createElement(Home, {
      audience: "worker",
      screen: null,
      name: "",
      signedIn: false,
      nextVisit: null,
    }),
  );
  assert.match(html, /Apply to join/);
  assert.match(html, /\/provider\/login/);
  assert.doesNotMatch(html, /Book a clean|\/account\/|CREATE YOUR ACCOUNT/);
  assert.deepEqual(
    Array.from(experience.appTabs("worker")).map((t) => t.label),
    ["Today", "Jobs", "Inbox", "Account"],
  );
});

test("worker app chrome locks job tools while approval is unresolved", async () => {
  const { default: Chrome } = await load("components/MobileAppChrome.tsx", {
    ...mocks,
    "next/navigation": {
      ...mocks["next/navigation"],
      usePathname: () => "/worker/profile",
    },
  });
  const html = renderToStaticMarkup(
    React.createElement(Chrome, { audience: "worker" }),
  );
  assert.match(html, /Jobs, available after approval/);
  assert.match(html, /disabled/);
  assert.doesNotMatch(
    html,
    /href="\/worker\/earnings"|href="\/worker\/availability"|Book a clean|Account mode/,
  );
});

test("application entry and shortcut routing cannot select a different app or offsite URL", () => {
  for (const audience of ["customer", "worker"]) {
    assert.equal(experience.appScreen(audience, "https://example.com"), null);
    assert.equal(experience.appPathAllowed(audience, "/admin"), false);
    assert.equal(experience.appPathAllowed(audience, "/staff/login"), false);
    assert.equal(
      experience.appPathAllowed(
        audience,
        `/mobile/${audience === "customer" ? "worker" : "customer"}`,
      ),
      false,
    );
  }
  assert.equal(experience.audienceForPath("/mobile/customers"), null);
  assert.equal(experience.appPathAllowed("customer", "/account/profile"), true);
  assert.equal(
    experience.appPathAllowed("customer", "/worker/earnings"),
    false,
  );
  assert.equal(
    experience.appPathAllowed("worker", "/worker/application"),
    true,
  );
});

test("app status API is scoped to the authenticated user and does not grant unresolved workers access", async () => {
  for (const state of [
    null,
    { id: "provider", vetting_status: "pending", is_suspended: false },
    {
      id: "provider",
      vetting_status: "approved",
      is_suspended: false,
      service_approvals: { cleaning: "approved" },
    },
    { id: "provider", vetting_status: "approved", is_suspended: true },
  ]) {
    let scoped;
    const { GET } = await load("app/api/mobile/context/route.ts", {
      "@/lib/supabase/server": {
        createClient: async () => ({
          auth: {
            getUser: async () => ({ data: { user: { id: "signed-in-user" } } }),
          },
          from: (table) => {
            assert.equal(table, "providers");
            return {
              select() {
                return this;
              },
              eq(key, value) {
                scoped = [key, value];
                return this;
              },
              maybeSingle: async () => ({ data: state }),
            };
          },
        }),
      },
      "@/lib/professionalAccess": await load("lib/professionalAccess.ts", {
        "./professionalServices": await load("lib/professionalServices.ts"),
      }),
    });
    const response = await GET();
    const body = await response.json();
    assert.deepEqual(scoped, ["profile_id", "signed-in-user"]);
    assert.equal(
      body.canWork,
      state?.vetting_status === "approved" && state?.is_suspended === false,
    );
    assert.match(response.headers.get("Cache-Control"), /no-store/);
  }
});

test("native variants install side by side, have distinct entry links and retain the customer signing identity", async () => {
  const apps = JSON.parse(
    await readFile(new URL("../mobile/apps.json", import.meta.url), "utf8"),
  );
  assert.equal(apps.customer.packageId, "com.opulencebliss.app");
  assert.equal(apps.worker.packageId, "com.opulencebliss.worker");
  assert.notEqual(apps.customer.startUrl, apps.worker.startUrl);
  for (const audience of ["customer", "worker"]) {
    const xml = await readFile(
      new URL(
        `../mobile/android/app/src/${audience}/res/xml/shortcuts.xml`,
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(
      xml,
      new RegExp(apps[audience].packageId.replaceAll(".", "\\.")),
    );
    assert.match(xml, new RegExp(apps[audience].startUrl));
    assert.doesNotMatch(
      xml,
      new RegExp(`/mobile/${audience === "customer" ? "worker" : "customer"}`),
    );
  }
});
