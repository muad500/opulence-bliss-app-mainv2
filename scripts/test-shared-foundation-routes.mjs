import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createRequire } from "node:module";
import { NextRequest, NextResponse } from "next/server.js";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
const require = createRequire(import.meta.url);
const person = "00000000-0000-4000-8000-000000000006";
const plan = "00000000-0000-4000-8000-000000000099";
function load(file, mocks = {}, env = {}) {
  const harnessModule = { exports: {} };
  const code = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const context = vm.createContext({
    module: harnessModule,
    exports: harnessModule.exports,
    Buffer,
    URL,
    Headers,
    Request,
    Response,
    Date,
    setTimeout: (fn) => fn(),
    process: { env },
    require: (name) => {
      if (name in mocks) return mocks[name];
      if (name === "server-only") return {};
      if (name === "next/server") return { NextRequest, NextResponse };
      if (name === "next/link")
        return {
          __esModule: true,
          default: ({ children, ...props }) =>
            React.createElement("a", props, children),
        };
      if (name === "next/navigation")
        return {
          useRouter: () => ({ refresh() {} }),
          usePathname: () => "/admin",
          redirect: (where) => {
            throw Error("redirect:" + where);
          },
        };
      if (name === "@/components/DocumentUpdateAcceptance")
        return load("components/DocumentUpdateAcceptance.tsx", mocks, env);
      if (name.endsWith(".module.css"))
        return {
          __esModule: true,
          default: new Proxy({}, { get: (_, key) => String(key) }),
        };
      if (name.startsWith("@/lib/"))
        return load(name.replace("@/", " ").trim() + ".ts", mocks, env);
      if (name.startsWith("./"))
        return load("lib/" + name.slice(2) + ".ts", mocks, env);
      return require(name);
    },
  });
  vm.runInContext(code, context);
  return harnessModule.exports;
}
const roles = [
  { role: "customer", status: "active", pay_source: "customer" },
  { role: "cleaner", status: "active", pay_source: "cleaner" },
];
function accountMocks(owned = roles, extra = {}) {
  const calls = [];
  return {
    calls,
    mocks: {
      "@/lib/accountApi": {
        accountContext: async () => ({
          user: { id: person },
          admin: {
            rpc: async (...args) => {
              calls.push(args);
              return { data: null, error: null };
            },
          },
        }),
        isAccountError: (x) => x instanceof NextResponse,
        readAccountBody: (r) => r.json(),
      },
      "@/lib/supabase/server": {
        createClient: async () => ({
          rpc: async () => ({ data: owned, error: null }),
        }),
      },
      "@/lib/handymanMarketplace": { handymanEnabled: () => true },
      ...extra,
    },
  };
}
const request = (path, body) =>
  new NextRequest("https://staging.example.invalid" + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-vercel-forwarded-for": "192.0.2.11",
      "user-agent": "TEST ONLY browser",
    },
    body: JSON.stringify(body),
  });
test("role switch accepts an owned role and performs no account or payment write", async () => {
  const f = accountMocks();
  const route = load("app/api/account/roles/route.ts", f.mocks);
  const result = await route.POST(
    request("/api/account/roles", {
      role: "cleaner",
      userId: "attacker-selected",
    }),
  );
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), {
    role: "cleaner",
    href: "/account/roles/cleaner",
  });
  assert.equal(f.calls.length, 0);
});
test("role switch cannot create or activate an unowned role", async () => {
  const f = accountMocks();
  const route = load("app/api/account/roles/route.ts", f.mocks);
  const result = await route.POST(
    request("/api/account/roles", { role: "partner", status: "active" }),
  );
  assert.equal(result.status, 403);
  assert.equal(f.calls.length, 0);
});
test("P9: forged Partner request is denied even if a conflicting old membership exists", async () => {
  const f = accountMocks([
    ...roles,
    { role: "handyman", status: "active" },
    { role: "partner", status: "active" },
  ]);
  const route = load("app/api/account/roles/route.ts", f.mocks);
  assert.equal(
    (await route.POST(request("/api/account/roles", { role: "partner" })))
      .status,
    403,
  );
});
test("unchecked professional document update records nothing", async () => {
  const f = accountMocks();
  const route = load("app/api/account/document-updates/route.ts", f.mocks);
  assert.equal(
    (
      await route.POST(
        request("/api/account/document-updates", {
          role: "cleaner",
          plan,
          checked: false,
        }),
      )
    ).status,
    400,
  );
  assert.equal(f.calls.length, 0);
});
test("document acceptance uses authenticated identity and trusted IP, not request-body claims", async () => {
  const f = accountMocks();
  const route = load("app/api/account/document-updates/route.ts", f.mocks, {
    VERCEL: "1",
  });
  const result = await route.POST(
    request("/api/account/document-updates", {
      role: "cleaner",
      plan,
      checked: true,
      userId: "someone-else",
      ip: "203.0.113.25",
      wording: "forged consent",
    }),
  );
  assert.equal(result.status, 200);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0][0], "accept_role_document_update");
  assert.equal(f.calls[0][1].p_user, person);
  assert.equal(f.calls[0][1].p_ip, "192.0.2.11");
  assert.equal(f.calls[0][1].wording, undefined);
});
test("a document update for an unowned role never reaches the privileged writer", async () => {
  const f = accountMocks();
  const route = load("app/api/account/document-updates/route.ts", f.mocks);
  assert.equal(
    (
      await route.POST(
        request("/api/account/document-updates", {
          role: "handyman",
          plan,
          checked: true,
        }),
      )
    ).status,
    403,
  );
  assert.equal(f.calls.length, 0);
});
test("private ID record remains hidden after a logged denial, even if data is accidentally returned", async () => {
  const f = load("app/api/admin/onboarding/[id]/verification/route.ts", {
    "@/lib/adminApi": {
      adminApi: async () => ({
        client: {
          rpc: async () => ({
            data: {
              allowed: false,
              record: { reference: "SECRET FICTIONAL VALUE" },
            },
            error: null,
          }),
        },
      }),
    },
  });
  const result = await f.POST(
    request("/api/admin/onboarding/test/verification", { type: "photo_id" }),
    { params: Promise.resolve({ id: person }) },
  );
  assert.equal(result.status, 403);
  assert.doesNotMatch(await result.text(), /SECRET/);
});
test("customer notices use the normal sender with a stable idempotency key on retry", async () => {
  const sends = [];
  let claimed = true;
  const mail = load("lib/documentChangeDelivery.ts", {
    "./privateAccountMail": {
      accountMailReady: () => true,
      sendPrivateAccountMail: async (...args) => {
        sends.push(args);
        return true;
      },
    },
    "./accountSecurityAlerts": { securityMailRecipientAllowed: () => true },
    "./adminHosts": {
      deploymentOrigins: () => ({ website: "https://staging.example.invalid" }),
    },
  });
  const admin = {
    rpc: async (name) =>
      name === "claim_document_change_emails"
        ? {
            data: claimed
              ? ((claimed = false),
                [
                  {
                    plan_id: plan,
                    user_id: person,
                    recipient: "fictional@example.invalid",
                    claim_token: "fictional-token",
                    title: "TEST ONLY Terms",
                    version: "1.1",
                    summary: "TEST ONLY clearer wording",
                    effective_at: "2026-12-05T00:00:00Z",
                  },
                ])
              : [],
            error: null,
          }
        : { data: true, error: null },
  };
  const first = await mail.deliverDocumentChangeEmails(admin);
  const second = await mail.deliverDocumentChangeEmails(admin);
  assert.equal(first.sent, 1);
  assert.equal(second.sent, 0);
  assert.equal(sends.length, 1);
  assert.equal(sends[0][3], `document-change:${plan}:${person}`);
  assert.match(sends[0][2], /next book/);
});
test("staging recipient allowlist blocks a notice without making any send attempt", async () => {
  let sends = 0;
  const finishes = [];
  const mail = load("lib/documentChangeDelivery.ts", {
    "./privateAccountMail": {
      accountMailReady: () => true,
      sendPrivateAccountMail: async () => {
        sends++;
        return true;
      },
    },
    "./accountSecurityAlerts": { securityMailRecipientAllowed: () => false },
    "./adminHosts": {
      deploymentOrigins: () => ({ website: "https://staging.example.invalid" }),
    },
  });
  const admin = {
    rpc: async (name, args) => {
      if (name === "claim_document_change_emails")
        return {
          data: [
            {
              plan_id: plan,
              user_id: person,
              recipient: "not-allowed@example.invalid",
              claim_token: "fictional-token",
            },
          ],
          error: null,
        };
      finishes.push(args);
      return { data: true, error: null };
    },
  };
  const result = await mail.deliverDocumentChangeEmails(admin);
  assert.equal(result.failed, 1);
  assert.equal(sends, 0);
  assert.equal(finishes[0].p_sent, false);
});

test("C9: professional update starts unticked, required and unable to submit", () => {
  const Acceptance = load("components/DocumentUpdateAcceptance.tsx").default;
  const html = renderToStaticMarkup(
    React.createElement(Acceptance, {
      role: "cleaner",
      plan,
      title: "TEST ONLY Agreement",
      version: "1.1",
    }),
  );
  assert.match(html, /type="checkbox" required=""/);
  assert.doesNotMatch(html, /checked=""/);
  assert.match(html, /type="submit" disabled=""/);
  assert.match(
    html,
    /I have read and accept TEST ONLY Agreement \(Version 1\.1\)\./,
  );
});

test("H34: a pending trade cannot read pay records through the role page", async () => {
  const Pay = load("app/account/roles/[role]/pay/page.tsx", {
    "@/lib/accountRolesServer": {
      requireAccountRole: async () => ({
        role: { role: "handyman", status: "applied" },
        client: { from: () => assert.fail("Pay data must remain locked") },
      }),
    },
    "@/lib/professionalPortal": {
      privatePortalClient: () => assert.fail("No privileged earnings reads"),
      allHandymanEarnings: () => assert.fail("No earnings reads"),
    },
  }).default;
  const html = renderToStaticMarkup(
    await Pay({ params: Promise.resolve({ role: "handyman" }) }),
  );
  assert.match(html, /Pay tools unlock after this role is approved/);
});

test("staff navigation exposes only tools for the current staff role", () => {
  const Nav = load("app/admin/AdminNav.tsx", {
    "@/lib/supabase/client": { createClient: () => ({}) },
  }).default;
  const onboarding = renderToStaticMarkup(
    React.createElement(Nav, {
      email: "test@example.invalid",
      staffRole: "onboarding",
    }),
  );
  assert.match(onboarding, /href="\/admin\/onboarding"/);
  assert.doesNotMatch(
    onboarding,
    /href="\/admin\/(staff-roles|settings|customers|bookings)"/,
  );
  const developer = renderToStaticMarkup(
    React.createElement(Nav, {
      email: "test@example.invalid",
      staffRole: "developer",
    }),
  );
  assert.doesNotMatch(developer, /href="\/admin\/onboarding"/);
});

test("second sign-off sees activation but no rejection or suspension controls", () => {
  const Review = load("app/admin/ServiceReview.tsx", {
    "./actions": {},
  }).default;
  const html = renderToStaticMarkup(
    React.createElement(Review, {
      id: person,
      approvals: { cleaning: "pending", handyman: "approved" },
      handymanEnabled: true,
      staffRole: "second_signoff",
    }),
  );
  assert.match(html, /Record first review/);
  assert.doesNotMatch(html, />Reject<|>Suspend service<|>Reopen for review</);
});

test("private identity files reject traversal before privileged storage reads", async () => {
  const route = load(
    "app/api/admin/onboarding/[id]/verification/file/route.ts",
    {
      "@/lib/adminApi": {
        adminApi: async () => ({
          client: {
            rpc: async () => ({
              data: {
                allowed: true,
                record: {
                  document_storage_path: `${person}/photo_id/../other.pdf`,
                },
              },
            }),
          },
          admin: {
            storage: {
              from: () => assert.fail("No traversal may reach Storage"),
            },
          },
        }),
      },
    },
  );
  const result = await route.GET(
    new NextRequest(
      `https://admin.example.invalid/api/admin/onboarding/${person}/verification/file?type=photo_id`,
    ),
    { params: Promise.resolve({ id: person }) },
  );
  assert.equal(result.status, 404);
});

test("C10/H34: accepted role documents link to their current approved version in a new tab", async () => {
  const tables = {
    account_role_document_bindings: [
      { document_slug: "professional-partner-agreement" },
    ],
    legal_documents: [
      {
        slug: "professional-partner-agreement",
        title: "TEST ONLY Agreement",
        version: "1.1",
        effective_date: "2026-11-04",
      },
    ],
    account_legal_acceptances: [
      {
        document_slug: "professional-partner-agreement",
        version: "1.1",
        accepted_at: "2026-11-04T00:00:00Z",
      },
    ],
  };
  const client = {
    from(table) {
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        maybeSingle: async () => ({ data: { id: person } }),
        then: (resolve) => resolve({ data: tables[table] ?? [], error: null }),
      };
      return query;
    },
    rpc: async (name) => ({
      data:
        name === "my_role_document_versions"
          ? [
              {
                id: plan,
                document_slug: "professional-partner-agreement",
                version: "1.1",
              },
            ]
          : [],
      error: null,
    }),
  };
  const Page = load("app/account/roles/[role]/documents/page.tsx", {
    "@/lib/accountRolesServer": {
      requireAccountRole: async () => ({
        client,
        user: { id: person },
        role: { role: "cleaner", status: "active" },
      }),
    },
    "@/lib/legalDocuments": { sanitizeLegalHtml: (value) => value },
    "@/lib/professionalPortal": {
      privatePortalClient: () => ({
        from: () => {
          const query = {
            select: () => query,
            eq: () => query,
            in: (_field, types) => {
              assert.equal(types.includes("gas_safe_registration"), false);
              return { data: [], error: null };
            },
          };
          return query;
        },
      }),
    },
  }).default;
  const html = renderToStaticMarkup(
    await Page({ params: Promise.resolve({ role: "cleaner" }) }),
  );
  assert.match(
    html,
    new RegExp(`href="/account/document-changes/${plan}" target="_blank"`),
  );
  assert.match(html, /TEST ONLY Agreement · Version 1\.1/);
  assert.doesNotMatch(
    html,
    /href="\/provider\/join\/policies\/professional-partner-agreement"/,
  );
});
