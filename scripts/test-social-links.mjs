import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest, NextResponse } from "next/server.js";

function harness({ denied = false, databaseError = false } = {}) {
  const writes = [];
  const selections = [];
  const rows = [
    { platform: "facebook", url: "https://facebook.com/updated-page" },
    { platform: "nextdoor", url: null },
  ];
  const db = {
    from(table) {
      assert.equal(table, "site_social_links");
      return {
        select: async (columns) => {
          selections.push(columns);
          return { data: rows, error: databaseError ? {} : null };
        },
        upsert: async (values) => {
          writes.push(values);
          return { error: databaseError ? {} : null };
        },
      };
    },
  };
  const cache = new Map();
  function load(path) {
    if (cache.has(path)) return cache.get(path);
    const module = { exports: {} };
    const compiled = ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    const require = (id) => {
      if (id === "next/server") return { NextResponse };
      if (id === "@supabase/supabase-js") return { createClient: () => db };
      if (id === "@/lib/socialLinks") return load("lib/socialLinks.ts");
      if (id === "@/lib/adminApi")
        return {
          adminApi: async () =>
            denied
              ? NextResponse.json(
                  { error: "Staff access required." },
                  { status: 403 },
                )
              : { admin: db, user: { id: "admin-fixture" } },
        };
      throw new Error("Unexpected import: " + id);
    };
    vm.runInNewContext(compiled, {
      exports: module.exports,
      module,
      require,
      URL,
      Date,
      process,
    });
    cache.set(path, module.exports);
    return module.exports;
  }
  const defaults = load("lib/socialLinks.ts").DEFAULT_SOCIAL_LINKS;
  const request = (links = defaults) =>
    new NextRequest("https://example.invalid/api/admin/social-links", {
      method: "POST",
      body: JSON.stringify({ links }),
      headers: { "Content-Type": "application/json" },
    });
  return {
    route: load("app/api/admin/social-links/route.ts"),
    publicRoute: load("app/api/social-links/route.ts"),
    writes,
    selections,
    request,
    defaults,
  };
}

test("denied admin requests never read or write social settings", async () => {
  const h = harness({ denied: true });
  assert.equal((await h.route.POST(h.request())).status, 403);
  assert.equal((await h.route.GET(h.request())).status, 403);
  assert.equal(h.writes.length, 0);
  assert.equal(h.selections.length, 0);
});
test("unsafe social URLs are rejected before any database write", async () => {
  const h = harness();
  assert.equal(
    (
      await h.route.POST(
        h.request({ ...h.defaults, facebook: "javascript:alert(1)" }),
      )
    ).status,
    400,
  );
  assert.equal(h.writes.length, 0);
});
test("admin saves all links together, supports clearing, and records the editor", async () => {
  const h = harness();
  const response = await h.route.POST(
    h.request({
      ...h.defaults,
      instagram: "",
      nextdoor: "https://nextdoor.co.uk/pages/opulencebliss/",
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].length, 4);
  assert.equal(
    h.writes[0].find((row) => row.platform === "instagram").url,
    null,
  );
  assert.ok(h.writes[0].every((row) => row.updated_by === "admin-fixture"));
  assert.equal(
    (await response.json()).links.nextdoor,
    "https://nextdoor.co.uk/pages/opulencebliss/",
  );
});
test("database failure cannot be shown as a successful save", async () => {
  const h = harness({ databaseError: true });
  assert.equal((await h.route.POST(h.request())).status, 503);
});
test("public reads expose URLs only and remain available during a database outage", async () => {
  const h = harness();
  const response = await h.publicRoute.GET();
  assert.equal(
    (await response.json()).links.facebook,
    "https://facebook.com/updated-page",
  );
  assert.deepEqual(h.selections, ["platform,url"]);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const offline = harness({ databaseError: true });
  assert.equal(
    (await (await offline.publicRoute.GET()).json()).links.facebook,
    offline.defaults.facebook,
  );
});
