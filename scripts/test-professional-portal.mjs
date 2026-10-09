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
const link = ({ href, children, ...props }) =>
  React.createElement("a", { href, ...props }, children);
const notFound = () => {
  throw new Error("not found");
};
const redirect = (url) => {
  throw new Error("redirect:" + url);
};
async function load(path, mocks = {}) {
  const source = await readFile(new URL("../" + path, import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  const defaults = {
    "next/link": { default: link },
    "next/navigation": { notFound, redirect },
    "@/components/WorkerCleaningJobs": {
      default: () => React.createElement("p", null, "Cleaning offers"),
    },
  };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    process,
    console,
    URL,
    Response,
    require: (id) => {
      const mock = mocks[id] ?? defaults[id];
      if (mock) return "default" in mock ? { __esModule: true, ...mock } : mock;
      if (id.endsWith(".module.css")) return { __esModule: true, default: {} };
      return require(id);
    },
  });
  return module.exports;
}
const services = await load("lib/professionalServices.ts");
const provider = {
  id: "own-provider",
  services: ["cleaning", "handyman"],
  service_approvals: { cleaning: "approved", handyman: "pending" },
};

test("All, Cleaning and Handyman filters render their own work and keep pending service separate", async () => {
  for (const filter of ["all", "cleaning", "handyman"]) {
    let reads = 0;
    const { default: Page } = await load("app/worker/jobs/page.tsx", {
      "@/lib/professionalServices": services,
      "@/lib/handymanMarketplace": { handymanEnabled: () => true },
      "@/lib/professionalPortal": {
        professionalPortal: async () => ({ provider, admin: "private-client" }),
        allHandymanEarnings: async (client, id) => {
          assert.equal(client, "private-client");
          assert.equal(id, "own-provider");
          reads++;
          return [];
        },
      },
    });
    const html = renderToStaticMarkup(
      await Page({ searchParams: Promise.resolve({ service: filter }) }),
    );
    assert.equal(html.includes("Cleaning offers"), filter !== "handyman");
    assert.equal(html.includes("Handyman jobs"), filter !== "cleaning");
    assert.equal(reads, filter === "cleaning" ? 0 : 1);
    if (filter !== "cleaning")
      assert.match(html, /Handyman approval is pending/);
  }
});

test("disabled marketplace hides professional signup, service controls, job filters and reads", async () => {
  const { default: Page } = await load("app/worker/jobs/page.tsx", {
    "@/lib/professionalServices": services,
    "@/lib/handymanMarketplace": { handymanEnabled: () => false },
    "@/lib/professionalPortal": {
      professionalPortal: async () => ({ provider }),
      allHandymanEarnings: async () => {
        throw Error("Must not read handyman jobs");
      },
    },
  });
  const html = renderToStaticMarkup(
    await Page({ searchParams: Promise.resolve({}) }),
  );
  assert.doesNotMatch(html, /handyman/i);
  await assert.rejects(
    () => Page({ searchParams: Promise.resolve({ service: "handyman" }) }),
    /not found/,
  );
  const { default: Applications } = await load(
    "components/ProfessionalServiceApplications.tsx",
  );
  const applications = renderToStaticMarkup(
    React.createElement(Applications, {
      approvals: provider.service_approvals,
      handymanEnabled: false,
      onAdded: async () => {},
    }),
  );
  assert.doesNotMatch(applications, /handyman/i);
  const { default: Picker } = await load(
    "components/ProfessionalServicePicker.tsx",
  );
  const picker = renderToStaticMarkup(
    React.createElement(Picker, {
      value: ["cleaning"],
      onChange: () => {},
      handymanEnabled: false,
    }),
  );
  assert.doesNotMatch(picker, /handyman/i);
});

test("adding a service calls the additive RPC, with no writes to shared checks or working hours", async () => {
  const calls = [];
  const { POST } = await load("app/api/account/services/route.ts", {
    "next/server": { NextRequest, NextResponse },
    "@/lib/professionalServices": services,
    "@/lib/handymanMarketplace": { handymanEnabled: () => true },
    "@/lib/accountApi": {
      accountContext: async () => ({
        user: { id: "own-user" },
        admin: {
          rpc: async (name, args) => {
            calls.push({ name, args });
            return { error: null };
          },
        },
      }),
      isAccountError: () => false,
      readAccountBody: (request) => request.json(),
      accountError: (error, status) => NextResponse.json({ error }, { status }),
    },
  });
  const response = await POST(
    new NextRequest("https://staging.example/api/account/services", {
      method: "POST",
      body: JSON.stringify({ service: "handyman" }),
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "request_professional_service");
  assert.equal(calls[0].args.p_user, "own-user");
  assert.equal(calls[0].args.p_service, "handyman");
});

test("professional handyman detail restricts private reads to the signed-in provider", async () => {
  const filters = [];
  const query = {
    select: () => query,
    eq: (field, value) => {
      filters.push([field, value]);
      return query;
    },
    maybeSingle: async () => ({ data: null, error: null }),
  };
  const { default: Page } = await load(
    "app/worker/jobs/handyman/[id]/page.tsx",
    {
      "@/lib/handymanMarketplace": { handymanEnabled: () => true },
      "@/components/HandymanJobDetail": { default: () => null },
      "@/lib/professionalPortal": {
        professionalPortal: async () => ({
          provider,
          admin: { from: () => query },
        }),
      },
    },
  );
  await assert.rejects(
    () => Page({ params: Promise.resolve({ id: "other-job" }) }),
    /not found/,
  );
  assert.deepEqual(filters, [
    ["id", "other-job"],
    ["provider_id", "own-provider"],
  ]);
});
