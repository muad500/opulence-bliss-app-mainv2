import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import vm from "node:vm";
import ts from "typescript";
import { NextRequest, NextResponse } from "next/server.js";
const require = createRequire(import.meta.url);
const catalog = JSON.parse(
  readFileSync("content/cleaner-onboarding-drafts.json", "utf8"),
);
function compile(file, mocks = {}, env = {}) {
  const module = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    {
      module,
      exports: module.exports,
      process: { env },
      URL,
      require: (name) =>
        Object.hasOwn(mocks, name) ? mocks[name] : require(name),
    },
  );
  return module.exports;
}
test("single editable catalog accounts for all references and explicitly stays a draft", () => {
  assert.equal(catalog.status, "draft");
  assert.equal(catalog.statusLabel, "Draft – awaiting client approval");
  assert.equal(catalog.emails.length, 10);
  assert.equal(catalog.checklists.length, 12);
  const entries = [
    ...catalog.emails,
    ...catalog.declarations,
    ...catalog.checklists,
  ];
  assert.equal(new Set(entries.map((e) => e.code)).size, entries.length);
  assert.equal(entries.filter((e) => e.legacyKey).length, 10);
  assert.equal(
    catalog.checklists.reduce((n, c) => n + c.items.length, 0),
    64,
  );
  for (const entry of entries) {
    assert.ok(entry.reference && entry.basis.length && entry.notes.length);
    assert.equal(entry.published, undefined);
  }
});
test("generated public labels and complete report stay in sync with the canonical file", () => {
  execFileSync(
    process.execPath,
    ["scripts/prepare-cleaner-onboarding-review.mjs", "--check"],
    { stdio: "pipe" },
  );
  const report = readFileSync(
    "docs/cleaner-onboarding-client-review.md",
    "utf8",
  );
  for (const entry of [
    ...catalog.emails,
    ...catalog.declarations,
    ...catalog.checklists,
  ])
    assert.ok(report.includes(entry.code) && report.includes(entry.title));
});
test("ordinary rejection does not acquire assessment-specific deadlines or sensitive merge fields", () => {
  const rejection = catalog.emails.find((e) => e.id === "applicationRejected");
  const text = rejection.paragraphs.join("\n");
  assert.doesNotMatch(text, /(?:14|fourteen)[ -]days|(?:3|three)[ -]months/i);
  assert.doesNotMatch(
    text,
    /\{\{(?:offence|certificate|dbs|medical)[a-z_]*\}\}/i,
  );
  assert.ok(
    rejection.notes.some((note) => note.includes("Not for assessment failure")),
  );
  const dbs = catalog.emails.find((e) => e.id === "dbsDecisionNotice");
  assert.ok(dbs.paragraphs.some((p) => p.includes("{{secure_decision_url}}")));
  assert.ok(dbs.notes.some((p) => p.includes("not claimed to be implemented")));
});
test("editing/review cannot silently send drafts or waive existing stage gates", () => {
  const metadata = compile(
    "lib/cleanerOnboardingDraftMetadata.ts",
  ).CLEANER_ONBOARDING_PENDING_SOURCES;
  const guard = compile("lib/cleanerOnboardingPlaceholders.ts", {
    "./cleanerOnboardingDraftMetadata": {
      CLEANER_ONBOARDING_PENDING_SOURCES: metadata,
    },
  });
  for (const email of catalog.emails)
    assert.throws(
      () =>
        guard.requirePublishedOnboardingWording({
          wording: email.paragraphs.join("\n"),
          version: catalog.version,
          published: true,
          approvalStatus: catalog.status,
        }),
      /awaiting client approval/,
    );
  for (const file of [
    "app/api/admin/cleaner-onboarding-drafts/route.ts",
    "lib/cleanerOnboardingDraftsServer.ts",
  ])
    assert.doesNotMatch(
      readFileSync(file, "utf8"),
      /api\.resend|sendPrivateAccountMail|\.insert\(|\.update\(|export (?:async )?function POST/,
    );
  const panel = readFileSync(
    "app/admin/cleaner-onboarding-drafts/page.tsx",
    "utf8",
  );
  assert.match(panel, /type="checkbox" disabled/);
  assert.match(panel, /await requireAdminPage\("onboarding"\)/);
});
function routeFixture(options = {}) {
  let catalogReads = 0,
    guards = 0;
  const enabled = compile("lib/cleanerOnboardingDraftReview.ts");
  const format = compile("lib/cleanerOnboardingDraftFormat.ts");
  const env = {
    VERCEL_ENV: "preview",
    NEXT_PUBLIC_SUPABASE_URL: "https://comwdjprdedmsnxtvuuk.supabase.co",
    ...options.env,
  };
  const route = compile(
    "app/api/admin/cleaner-onboarding-drafts/route.ts",
    {
      "next/server": { NextRequest, NextResponse },
      "@/lib/adminApi": {
        adminApi: async (_request, permission) => {
          guards++;
          assert.equal(permission, "onboarding");
          return options.denied
            ? NextResponse.json(
                { error: "Complete authenticator sign-in" },
                { status: 403 },
              )
            : { staffRole: "manager" };
        },
      },
      "@/lib/cleanerOnboardingDraftReview": {
        cleanerOnboardingDraftReviewEnabled: () =>
          enabled.cleanerOnboardingDraftReviewEnabled(env),
      },
      "@/lib/cleanerOnboardingDraftsServer": {
        cleanerOnboardingDraftCatalog: () => {
          catalogReads++;
          return catalog;
        },
      },
      "@/lib/cleanerOnboardingDraftFormat": format,
    },
    env,
  );
  return { route, counts: () => ({ catalogReads, guards }) };
}
const request = () =>
  new NextRequest(
    "https://staging.example.invalid/api/admin/cleaner-onboarding-drafts",
  );
test("Production download refuses before reading drafts or staff credentials", async () => {
  const f = routeFixture({ env: { VERCEL_ENV: "production" } });
  assert.equal((await f.route.GET(request())).status, 404);
  assert.deepEqual(f.counts(), { guards: 0, catalogReads: 0 });
});
test("failed staff authenticator/role check reveals no draft body", async () => {
  const f = routeFixture({ denied: true });
  assert.equal((await f.route.GET(request())).status, 403);
  assert.equal(f.counts().catalogReads, 0);
});
test("authorised staff download is complete, draft-labelled and uncacheable", async () => {
  const f = routeFixture();
  const response = await f.route.GET(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.match(response.headers.get("content-disposition"), /^attachment;/);
  const text = await response.text();
  for (const entry of [
    ...catalog.emails,
    ...catalog.declarations,
    ...catalog.checklists,
  ])
    assert.ok(text.includes(entry.title));
  assert.ok(text.includes(catalog.statusLabel));
  assert.equal(f.route.POST, undefined);
});
