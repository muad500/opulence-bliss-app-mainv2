import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest, NextResponse } from "next/server.js";

const require = createRequire(import.meta.url);
async function load(path, mocks = {}) {
  const code = ts.transpileModule(
    await readFile(new URL("../" + path, import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    },
  ).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: (id) => {
      if (id === "@/lib/professionalServices") return services;
      if (id === "@/lib/handymanMarketplace")
        return {
          handymanEnabled: () => true,
          validHandymanTask: (task) => task === "Furniture assembly",
        };
      if (!(id in mocks)) return require(id);
      return "default" in mocks[id]
        ? { __esModule: true, ...mocks[id] }
        : mocks[id];
    },
    process: {
      env: {
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "fixture",
      },
    },
    console,
    Date,
    URL,
    Response,
  });
  return module.exports;
}
const services = await load("lib/professionalServices.ts");
const access = await load("lib/professionalAccess.ts");
const onboarding = await load("lib/providerOnboarding.ts");
const request = (path, body) =>
  new NextRequest(
    "https://example.com" + path,
    body
      ? {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "https://example.com",
          },
          body: JSON.stringify(body),
        }
      : {},
  );
const user = { id: "client", email: "client@example.com", user_metadata: {} };

function database(provider = null) {
  const writes = [];
  return {
    writes,
    auth: { getUser: async () => ({ data: { user } }) },
    from: (table) => {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({
          data: table === "profiles" ? { role: "customer" } : provider,
          error: null,
        }),
        upsert: (value) => {
          writes.push({ table, value });
          return Promise.resolve({ error: null });
        },
      };
      return q;
    },
  };
}

test("mode API refuses pending, rejected, suspended and missing professional memberships", async () => {
  for (const provider of [
    null,
    { id: "p", vetting_status: "pending", is_suspended: false },
    { id: "p", vetting_status: "rejected", is_suspended: false },
    { id: "p", vetting_status: "approved", is_suspended: true },
  ]) {
    const db = database(provider);
    const api = await load("lib/accountApi.ts", {
      "@/lib/professionalAccess": access,
      "@/lib/supabase/server": { createClient: async () => db },
      "@supabase/supabase-js": { createClient: () => db },
    });
    const { POST } = await load("app/api/account/mode/route.ts", {
      "@/lib/accountApi": api,
    });
    const response = await POST(
      request("/api/account/mode", { mode: "professional" }),
    );
    assert.equal(response.status, 403);
    assert.equal(db.writes.length, 0);
    const gated = await api.accountContext(
      request("/api/account/payout-account"),
      { approvedProvider: true },
    );
    assert.equal(gated.status, 403);
    assert.equal(
      (await api.accountContext(request("/api/account/worker-profile"))).user
        .id,
      user.id,
    );
  }
});

test("approved professionals can switch modes; all applicants can keep using their customer account", async () => {
  for (const [provider, mode] of [
    [
      { id: "p", vetting_status: "approved", is_suspended: false },
      "professional",
    ],
    [{ id: "p", vetting_status: "pending", is_suspended: false }, "client"],
  ]) {
    const db = database(provider);
    const api = await load("lib/accountApi.ts", {
      "@/lib/professionalAccess": access,
      "@/lib/supabase/server": { createClient: async () => db },
      "@supabase/supabase-js": { createClient: () => db },
    });
    const { POST } = await load("app/api/account/mode/route.ts", {
      "@/lib/accountApi": api,
    });
    assert.equal(
      (await POST(request("/api/account/mode", { mode }))).status,
      200,
    );
    assert.equal(db.writes[0].value.last_account_mode, mode);
  }
});

test("direct professional URLs and RSC requests cannot bypass approval", async () => {
  for (const provider of [
    null,
    { id: "p", vetting_status: "pending", is_suspended: false },
    { id: "p", vetting_status: "rejected", is_suspended: false },
    { id: "p", vetting_status: "approved", is_suspended: true },
    { id: "p", vetting_status: "approved", is_suspended: false },
  ]) {
    const db = database(provider);
    db.auth.getClaims = async () => ({ data: { claims: { sub: user.id } } });
    const { updateSession } = await load("lib/supabase/proxy.ts", {
      "@supabase/ssr": { createServerClient: () => db },
      "../utils": { hasEnvVars: true },
      "../professionalAccess": access,
    });
    for (const path of [
      "/worker",
      "/worker/availability",
      "/worker/earnings",
      "/worker/job/private",
      "/worker/updates",
    ]) {
      const req = request(path);
      req.headers.set("RSC", "1");
      const res = await updateSession(req);
      if (access.canUseProfessionalTools(provider))
        assert.equal(res.headers.get("location"), null);
      else
        assert.equal(
          new URL(res.headers.get("location")).pathname,
          provider ? "/worker/application" : "/provider/join",
        );
    }
    if (provider)
      for (const path of ["/worker/profile", "/worker/application"])
        assert.equal(
          (await updateSession(request(path))).headers.get("location"),
          null,
        );
  }
});

test("pending menu shows application access with no jobs mode or unlocked working links", async () => {
  const mocks = {
    "next/link": {
      default: ({ href, children, ...props }) =>
        React.createElement("a", { href, ...props }, children),
    },
    "next/navigation": {
      useRouter: () => ({}),
      usePathname: () => "/worker/application",
    },
  };
  const { default: Switch } = await load(
    "components/AccountModeSwitch.tsx",
    mocks,
  );
  const pending = renderToStaticMarkup(
    React.createElement(Switch, {
      mode: "client",
      hasProfessionalAccount: true,
    }),
  );
  assert.match(pending, /My application/);
  assert.doesNotMatch(pending, /My jobs/);
  const fresh = renderToStaticMarkup(
    React.createElement(Switch, { mode: "client" }),
  );
  assert.match(fresh, /Apply as a professional/);
  assert.match(
    renderToStaticMarkup(
      React.createElement(Switch, {
        mode: "client",
        professionalApproved: true,
      }),
    ),
    /My jobs/,
  );
  const { default: Nav } = await load("components/PortalNavigation.tsx", {
    ...mocks,
    "./PortalNavigation.module.css": {},
    "./AccountModeSwitch": { default: Switch },
    "@/lib/supabase/client": { createClient: () => ({}) },
  });
  const html = renderToStaticMarkup(
    React.createElement(Nav, {
      mode: "professional",
      name: "Applicant",
      registered: true,
      approved: false,
    }),
  );
  assert.doesNotMatch(html, /href="\/worker\/(availability|earnings|updates)"/);
  assert.match(html, /aria-disabled="true"/);
  assert.match(html, /Application under review/);
});

const validSignup = {
  fullName: "Example Applicant",
  firstName: "Example",
  lastName: "Applicant",
  salutation: "mr",
  email: user.email,
  phone: "7700900123",
  address: "London",
  dateOfBirth: "1990-01-01",
  weeklyHours: 20,
  residentStatus: "British or Irish citizen",
  utrNumber: null,
  businessName: null,
  selfEmployed: true,
  rightToWork: true,
  currentlySelfEmployed: "no",
  cleaningExperienceYears: 0,
  cleaningExperienceTypes: ["Domestic cleaning"],
  maxTravelDistance: "Up to 5 miles",
  weeklyAvailability: {
    monday: "morning",
    tuesday: "unavailable",
    wednesday: "unavailable",
    thursday: "unavailable",
    friday: "unavailable",
    saturday: "unavailable",
    sunday: "unavailable",
  },
  skills: ["cleaning"],
  areaIds: ["area"],
  professionalAgreementAccepted: true,
  dbsCertificateNumber: "123456789012",
  dbsIssueDate: "2026-10-01",
  dbsCertificateFileName: "certificate.pdf",
  dbsCertificateMimeType: "application/pdf",
};
async function signup(body) {
  const writes = [];
  const db = {
    auth: {
      admin: {
        updateUserById: async () => ({ error: null }),
        createUser: () =>
          assert.fail("existing customer must not get a duplicate account"),
      },
    },
    from: (table) => {
      const q = {
        select: () => q,
        eq: () => q,
        in: () => q,
        maybeSingle: async () => ({
          data: table === "profiles" ? { role: "customer" } : null,
        }),
        single: async () => ({ data: { id: "professional" } }),
        insert: (value) => {
          writes.push({ table, value });
          return q;
        },
        upsert: (value) => {
          writes.push({ table, value });
          return q;
        },
        then: (resolve) =>
          resolve({
            data: table === "legal_documents" ? [] : null,
            error: null,
          }),
      };
      return q;
    },
  };
  const { POST } = await load("app/api/provider-signup/route.ts", {
    "@/lib/providerOnboarding": onboarding,
    "@/lib/accountApi": { isSameOriginMutation: () => true },
    "@/lib/legal": { LEGAL_VERSIONS: {} },
    "@/lib/ukPhone": { normalizeUkPhone: (x) => x, isValidUkPhone: () => true },
    "@/lib/providerDbs": {
      normalizeDbsCertificateNumber: (x) => x,
      isDbsCertificateNumber: () => true,
      isDbsIssueDate: () => true,
      dbsCertificateExtension: () => "pdf",
    },
    "@/lib/supabase/server": { createClient: async () => database() },
    "@supabase/supabase-js": { createClient: () => db },
  });
  return {
    response: await POST(request("/api/provider-signup", body)),
    writes,
  };
}

test("actual signup endpoint accepts blank business name and UTR and creates a pending application", async () => {
  for (const blank of [null, "", "   "]) {
    const { response, writes } = await signup({
      ...validSignup,
      businessName: blank,
      utrNumber: blank,
    });
    assert.equal(
      response.status,
      200,
      JSON.stringify(await response.clone().json()),
    );
    const application = writes.find(
      (x) => x.table === "provider_onboarding_details",
    ).value;
    assert.equal(application.business_name, null);
    assert.equal(application.utr_number, null);
    assert.equal(
      writes.find((x) => x.table === "providers").value.vetting_status,
      "pending",
    );
  }
});

test("restricted statuses, no work permission and malformed UTR fail before any signup write", async () => {
  for (const change of [
    { residentStatus: "Student Visa" },
    { residentStatus: "Asylum Seeker" },
    { rightToWork: false },
    { utrNumber: "123" },
  ]) {
    const { response, writes } = await signup({ ...validSignup, ...change });
    assert.equal(response.status, 400);
    assert.equal(writes.length, 0);
  }
});

test("payout and earnings endpoints deny an unapproved applicant before Stripe or payment reads", async () => {
  const api = {
    accountContext: async (_req, options) => {
      assert.equal(options.approvedProvider, true);
      return NextResponse.json({ error: "Approval required" }, { status: 403 });
    },
    isAccountError: (x) => x instanceof NextResponse,
  };
  for (const file of [
    "app/api/account/payout-account/route.ts",
    "app/api/account/earnings-statement/route.ts",
  ]) {
    const endpoint = await load(file, {
      "@/lib/accountApi": api,
      "@/lib/earningsPeriod": {},
      stripe: {
        default: class {
          constructor() {
            assert.fail("Stripe must not run");
          }
        },
      },
    });
    assert.equal(
      (await endpoint.GET(request("/api/account/payout-account"))).status,
      403,
    );
    if (endpoint.POST)
      assert.equal(
        (await endpoint.POST(request("/api/account/payout-account", {})))
          .status,
        403,
      );
  }
});

test("one signup creates both pending services with one set of shared checks", async () => {
  const { response, writes } = await signup({
    ...validSignup,
    skills: ["cleaning", "handyman"],
    handymanRates: { "Furniture assembly": 3200 },
    coveragePostcodes: ["SW1A"],
    homePostcode: "SW1A 1AA",
  });
  assert.equal(
    response.status,
    200,
    JSON.stringify(await response.clone().json()),
  );
  assert.deepEqual(
    Array.from(writes.find((x) => x.table === "providers").value.services),
    ["cleaning", "handyman"],
  );
  assert.equal(writes.filter((x) => x.table === "providers").length, 1);
  assert.equal(
    writes.filter((x) => x.table === "provider_dbs_checks").length,
    1,
  );
  assert.equal(
    writes.filter((x) => x.table === "provider_onboarding_details").length,
    1,
  );
  assert.equal(
    writes.find((x) => x.table === "provider_task_rates").value[0]
      .hourly_rate_pence,
    3200,
  );
});

test("handyman-only signup does not require cleaning experience", async () => {
  const { response, writes } = await signup({
    ...validSignup,
    skills: ["handyman"],
    cleaningExperienceYears: undefined,
    cleaningExperienceTypes: undefined,
    handymanRates: { "Furniture assembly": 3200 },
    coveragePostcodes: ["SW1A"],
  });
  assert.equal(
    response.status,
    200,
    JSON.stringify(await response.clone().json()),
  );
  assert.equal(
    writes.find((x) => x.table === "provider_onboarding_details").value
      .cleaning_experience_years,
    null,
  );
});
