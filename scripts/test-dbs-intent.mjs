import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
const require = createRequire(import.meta.url);
const { NextResponse } = require("next/server");
const id = "d0028af3-6e1a-4a66-bba0-e2b8b773b90b";
function load(file, mocks, globals = {}) {
  const loadedModule = { exports: {} };
  const source = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  vm.runInNewContext(
    `(function(require,module,exports){${source}\n})`,
    globals,
  )(
    (name) => (Object.hasOwn(mocks, name) ? mocks[name] : require(name)),
    loadedModule,
    loadedModule.exports,
  );
  return loadedModule.exports;
}
function panel({ allowed = true, response, failure } = {}) {
  const cells = [];
  let index = 0;
  const calls = [];
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const hooks = {
    useState(initial) {
      const n = index++;
      if (!(n in cells)) cells[n] = initial;
      return [
        cells[n],
        (value) => {
          cells[n] = value;
        },
      ];
    },
    useRef(initial) {
      const n = index++;
      if (!(n in cells)) cells[n] = { current: initial };
      return cells[n];
    },
  };
  const Component = load(
    "app/admin/DbsRecordPanel.tsx",
    {
      react: hooks,
      "./DbsReviewButtons": { __esModule: true, default: () => null },
      "./DbsRecordPanel.module.css": { __esModule: true, default: {} },
    },
    {
      fetch: async (...args) => {
        calls.push(args);
        await pending;
        if (failure) throw new Error(failure);
        return {
          ok: response?.ok ?? true,
          json: async () =>
            response?.body ?? {
              record: {
                certificateNumber: "000000000000",
                issueDate: "2026-10-24",
                originalName: "TEST ONLY.pdf",
                status: "pending",
                uploadedAt: "2026-10-24T12:00:00Z",
                hasCertificate: true,
              },
            },
        };
      },
    },
  ).default;
  const render = () => {
    index = 0;
    return Component({ id, canView: allowed });
  };
  function button() {
    function find(node) {
      if (!node || typeof node !== "object") return;
      if (node.type === "button") return node;
      return React.Children.toArray(node.props?.children)
        .map(find)
        .find(Boolean);
    }
    return find(render());
  }
  return {
    calls,
    render,
    button,
    release,
    html: () => renderToStaticMarkup(render()),
  };
}
test("page refresh never reads DBS evidence or writes a view event", () => {
  const source = readFileSync("app/admin/cleaners/[id]/page.tsx", "utf8");
  assert.doesNotMatch(
    source,
    /staff_view_dbs_record|from\("provider_dbs_checks"\)/,
  );
  assert.match(source, /rpc\("can_view_dbs"\)/);
  const ui = panel();
  for (let i = 0; i < 10; i++) assert.match(ui.html(), /Open DBS record/);
  assert.equal(ui.calls.length, 0);
});
test("one deliberate opening sends one POST; polling and double clicks send nothing more", async () => {
  const ui = panel();
  const open = ui.button().props.onClick;
  open();
  open();
  assert.equal(ui.calls.length, 1);
  assert.equal(ui.calls[0][0], `/api/admin/dbs/${id}/record`);
  assert.equal(ui.calls[0][1].method, "POST");
  assert.equal(ui.calls[0][1].cache, "no-store");
  ui.release();
  await new Promise((resolve) => setImmediate(resolve));
  for (let i = 0; i < 10; i++) assert.match(ui.html(), /000000000000/);
  assert.equal(ui.calls.length, 1);
  ui.button().props.onClick();
  assert.doesNotMatch(ui.html(), /000000000000/);
  ui.button().props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ui.calls.length, 2, "explicit reopening is a new view");
});
test("unnamed staff see no evidence or opening control", () => {
  const ui = panel({ allowed: false });
  assert.match(ui.html(), /restricted to named onboarding staff/);
  assert.doesNotMatch(ui.html(), /Open DBS record|000000000000/);
  assert.equal(ui.calls.length, 0);
});
test("permission failure never renders evidence and allows a deliberate retry", async () => {
  const ui = panel({
    response: {
      ok: false,
      body: { error: "Named onboarding staff access required" },
    },
  });
  ui.button().props.onClick();
  ui.release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(ui.html(), /role="alert"/);
  assert.doesNotMatch(ui.html(), /000000000000/);
  assert.match(ui.html(), /Open DBS record/);
});
function route({ denied = false, missing = false, guard = null } = {}) {
  const calls = [];
  const ctx = {
    client: {
      rpc: async (...args) => {
        calls.push(args);
        return {
          data: missing
            ? []
            : [
                {
                  certificate_number: "000000000000",
                  issue_date: "2026-10-24",
                  certificate_original_name: "TEST.pdf",
                  status: "pending",
                  uploaded_at: "2026-10-24T12:00:00Z",
                  certificate_storage_path: "PRIVATE-PATH",
                  secret_field: "DO NOT EXPOSE",
                },
              ],
          error: denied ? { message: "internal" } : null,
        };
      },
    },
  };
  return {
    calls,
    module: load("app/api/admin/dbs/[id]/record/route.ts", {
      "@/lib/adminApi": { adminApi: async () => guard ?? ctx },
    }),
  };
}
test("record endpoint is POST only and returns minimal no-store fields after audited access", async () => {
  const rt = route();
  assert.equal(rt.module.GET, undefined);
  const result = await rt.module.POST({}, { params: Promise.resolve({ id }) });
  assert.equal(result.status, 200);
  assert.match(result.headers.get("cache-control"), /no-store/);
  assert.equal(rt.calls.length, 1);
  assert.equal(rt.calls[0][1].p_action, "record_view");
  const body = await result.json();
  assert.equal(body.record.hasCertificate, true);
  assert.doesNotMatch(JSON.stringify(body), /PRIVATE-PATH|DO NOT EXPOSE/);
});
test("record endpoint rechecks named access and MFA, with no service-role fallback", async () => {
  const denied = route({ denied: true });
  assert.equal(
    (await denied.module.POST({}, { params: Promise.resolve({ id }) })).status,
    403,
  );
  const guard = route({
    guard: NextResponse.json({ error: "MFA required" }, { status: 403 }),
  });
  assert.equal(
    (await guard.module.POST({}, { params: Promise.resolve({ id }) })).status,
    403,
  );
  assert.equal(guard.calls.length, 0);
  const invalid = route();
  assert.equal(
    (
      await invalid.module.POST(
        {},
        { params: Promise.resolve({ id: "not-a-provider" }) },
      )
    ).status,
    404,
  );
  assert.equal(invalid.calls.length, 0);
});
test("certificate HEAD and prefetch do not access or log evidence", async () => {
  let calls = 0;
  const rt = load("app/api/admin/dbs/[id]/certificate/route.ts", {
    "@/lib/adminApi": {
      adminApi: async () => {
        calls++;
        throw new Error("Must not fetch");
      },
    },
  });
  assert.equal(rt.HEAD().status, 405);
  const result = await rt.GET(
    { headers: new Headers({ "sec-purpose": "prefetch" }) },
    { params: Promise.resolve({ id }) },
  );
  assert.equal(result.status, 204);
  assert.equal(calls, 0);
});
