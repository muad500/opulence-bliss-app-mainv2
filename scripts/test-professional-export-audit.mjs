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
  const source = await readFile(new URL("../" + path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(compiled, {
    module: loadedModule,
    exports: loadedModule.exports,
    URLSearchParams,
    require: (id) => {
      if (id in mocks) return mocks[id];
      if (id.endsWith(".module.css")) return { __esModule: true, default: {} };
      if (id === "next/link")
        return {
          __esModule: true,
          default: ({ children, ...props }) =>
            React.createElement("a", props, children),
        };
      return require(id);
    },
  });
  return loadedModule.exports;
}
const operations = await load("lib/workerOperations.ts");
const request = () =>
  new NextRequest(
    "https://staff.example.test/api/admin/professional-earnings-export?from=2026-04-06&to=2027-04-06",
  );

function database({
  insertFails = false,
  completionMissing = false,
  exportFails = false,
  pages = [[]],
} = {}) {
  const calls = [];
  const entries = [];
  return {
    calls,
    entries,
    from(table) {
      assert.equal(table, "professional_export_audits");
      return {
        insert(value) {
          calls.push("audit-start");
          if (!insertFails) entries.push({ ...value, id: entries.length + 1 });
          return {
            select: () => ({
              single: async () => ({
                data: insertFails ? null : entries.at(-1),
                error: insertFails ? new Error("unavailable") : null,
              }),
            }),
          };
        },
        update(value) {
          return {
            eq: (_, id) => ({
              select: () => ({
                single: async () => {
                  calls.push("audit-complete");
                  if (completionMissing) return { data: null, error: null };
                  const entry = entries.find((row) => row.id === id);
                  Object.assign(entry, value);
                  return { data: { id }, error: null };
                },
              }),
            }),
          };
        },
      };
    },
    async rpc(name) {
      assert.equal(name, "professional_earnings_export");
      calls.push("read-private-data");
      if (exportFails) return { data: null, error: new Error("unavailable") };
      return { data: pages.shift() ?? [], error: null };
    },
  };
}
async function route(admin, guard) {
  return (
    await load("app/api/admin/professional-earnings-export/route.ts", {
      "@/lib/adminApi": {
        adminApi: async () =>
          guard ?? { user: { id: "authenticated-staff" }, admin },
      },
      "@/lib/workerOperations": operations,
    })
  ).GET;
}

test("CSV access records the authenticated actor before reading data and logs every request", async () => {
  const db = database();
  const get = await route(db);
  for (let i = 0; i < 2; i++) {
    const response = await get(request());
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control"), /private, no-store/);
    assert.match(await response.text(), /Professional ID/);
  }
  assert.equal(db.entries.length, 2);
  assert.deepEqual(db.calls, [
    "audit-start",
    "read-private-data",
    "audit-complete",
    "audit-start",
    "read-private-data",
    "audit-complete",
  ]);
  for (const entry of db.entries) {
    assert.equal(entry.actor_id, "authenticated-staff");
    assert.equal(entry.starts_on, "2026-04-06");
    assert.equal(entry.ends_before, "2027-04-06");
    assert.equal(entry.professional_count, 0);
  }
});

test("an audit insertion failure never reads or releases private CSV data", async () => {
  const db = database({ insertFails: true });
  const response = await (await route(db))(request());
  assert.equal(response.status, 503);
  assert.deepEqual(db.calls, ["audit-start"]);
  assert.doesNotMatch(await response.text(), /Legal name|UTR|Date of birth/);
});

test("an export failure retains the staff/time request as incomplete and returns no CSV", async () => {
  const db = database({ exportFails: true });
  const response = await (await route(db))(request());
  assert.equal(response.status, 503);
  assert.equal(db.entries[0].professional_count, -1);
  assert.deepEqual(db.calls, ["audit-start", "read-private-data"]);
});

test("a missing completion audit blocks CSV release even without a database error", async () => {
  const db = database({ completionMissing: true });
  const response = await (await route(db))(request());
  assert.equal(response.status, 503);
  assert.equal(db.entries[0].professional_count, -1);
  assert.doesNotMatch(await response.text(), /Legal name|UTR|Date of birth/);
});

test("the audit counts all pages of an export without copying private row values into the log", async () => {
  const rows = Array.from({ length: 501 }, (_, i) => ({
    provider_id: `pro-${i}`,
    legal_name: "Fictional professional",
    net_paid_pence: 1500,
    transfer_count: 1,
  }));
  const db = database({ pages: [rows.slice(0, 500), rows.slice(500)] });
  const response = await (await route(db))(request());
  assert.equal(response.status, 200);
  assert.equal(db.entries[0].professional_count, 501);
  assert.equal(
    db.calls.filter((call) => call === "read-private-data").length,
    2,
  );
  assert.doesNotMatch(
    JSON.stringify(db.entries),
    /Fictional professional|net_paid_pence|legal_name/,
  );
});

test("staff/MFA refusal returns before opening the private audit or export", async () => {
  const db = database();
  const response = await (
    await route(db, NextResponse.json({ mfaRequired: true }, { status: 403 }))
  )(request());
  assert.equal(response.status, 403);
  assert.deepEqual(db.calls, []);
});

test("the staff audit view shows identity and time, retains filters and excludes exported personal values", async () => {
  let authorised = false;
  const { default: Log } = await load(
    "app/admin/worker-operations/ExportAuditLog.tsx",
    {
      "@/lib/adminSession": {
        requireAdminPage: async () => {
          authorised = true;
        },
      },
      "@/lib/professionalPortal": {
        privatePortalClient: () => {
          assert.ok(authorised);
          const query = {
            select: () => query,
            order: () => query,
            range: async (from, to) => {
              assert.equal(from, 30);
              assert.equal(to, 59);
              return {
                error: null,
                count: 90,
                data: [
                  {
                    id: 1,
                    actor_id: "staff-id",
                    actor: [
                      {
                        full_name: "Audit Staff",
                        email: "staff@example.invalid",
                      },
                    ],
                    created_at: "2026-10-26T12:00:00Z",
                    starts_on: "2026-04-06",
                    ends_before: "2027-04-06",
                    professional_count: -1,
                    date_of_birth: "DO-NOT-RENDER",
                    utr: "DO-NOT-RENDER",
                  },
                ],
              };
            },
          };
          return { from: () => query };
        },
      },
    },
  );
  const html = renderToStaticMarkup(
    await Log({ page: 2, reliabilityPage: 3, provider: "provider-filter" }),
  );
  assert.match(html, /Audit Staff/);
  assert.match(html, /staff@example.invalid/);
  assert.match(html, /datetime="2026-10-26T12:00:00Z"/i);
  assert.match(html, /CSV generation not completed/);
  assert.match(html, /auditPage=1&amp;page=3&amp;provider=provider-filter/);
  assert.match(html, /auditPage=3&amp;page=3&amp;provider=provider-filter/);
  assert.doesNotMatch(html, /DO-NOT-RENDER/);
});
