import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
const native = createRequire(import.meta.url);
function loader(mocks = {}) {
  const cache = new Map();
  return function load(file) {
    if (cache.has(file)) return cache.get(file);
    const module = { exports: {} };
    const code = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText;
    vm.runInNewContext(code, {
      module,
      exports: module.exports,
      Response,
      URL,
      Buffer,
      Date,
      process: { env: {} },
      require: (id) => {
        if (id in mocks) return mocks[id];
        if (id === "server-only" || id.endsWith(".module.css")) return {};
        if (id.startsWith("@/lib/")) return load("lib/" + id.slice(6) + ".ts");
        if (id.startsWith("./")) return load("lib/" + id.slice(2) + ".ts");
        return native(id);
      },
    });
    cache.set(file, module.exports);
    return module.exports;
  };
}
const policy = loader()("lib/checkoutLegal.ts");
const rows = ["terms", "privacy", "cancellation-refund"].map((slug) => ({
  slug,
  title: slug,
  version: "1.0",
  updated_at: "2026-10-21T00:00:00Z",
  content_html: "<p>Policy fixture</p>",
}));
const documents = rows.map((r) => ({
  slug: r.slug,
  version: r.version,
  updatedAt: r.updated_at,
  isFallback: false,
}));
function db(data = rows, error = null, ready = true) {
  return {
    rpc: async () => ({ data: ready }),
    from: () => ({
      select() {
        return this;
      },
      in() {
        return this;
      },
      eq: async () => ({ data, error }),
    }),
  };
}
test("acceptance requires exactly the three documents and valid live versions/timestamps", () => {
  assert.equal(policy.validCheckoutLegalDocuments(documents), true);
  for (const value of [
    null,
    [],
    documents.slice(0, 2),
    [...documents, documents[0]],
    [documents[0], documents[0], documents[2]],
    documents.map((d) => ({ ...d, version: "" })),
    documents.map((d) => ({ ...d, updatedAt: "not a date" })),
  ])
    assert.equal(policy.validCheckoutLegalDocuments(value), false);
});
test("published version 1.0 changes require no code change; stale versions/source/timestamps cannot match", () => {
  assert.equal(policy.checkoutLegalMatches(documents, documents), true);
  for (const field of [
    { version: "2.0" },
    { updatedAt: "2026-10-22T00:00:00Z" },
    { isFallback: true },
  ])
    assert.equal(
      policy.checkoutLegalMatches(
        documents,
        documents.map((d) => ({ ...d, ...field })),
      ),
      false,
    );
});
test("missing published Terms resolves to the exact built-in Terms page version, without any policy write", async () => {
  const load = loader();
  const { currentCheckoutLegal } = load("lib/checkoutLegalServer.ts");
  const { defaultLegalDocument } = load("lib/legalDocuments.ts");
  const result = await currentCheckoutLegal(
    db(rows.filter((r) => r.slug !== "terms")),
  );
  const terms = result.documents.find((d) => d.slug === "terms");
  assert.equal(terms.version, defaultLegalDocument("terms").version);
  assert.equal(terms.version, "2.0");
  assert.equal(terms.isFallback, true);
  assert.equal(terms.updatedAt, null);
  assert.equal(policy.validCheckoutLegalDocuments(result.documents), true);
  assert.equal(
    result.fallbacks.find((d) => d.slug === "terms").contentHash,
    native("node:crypto")
      .createHash("md5")
      .update(defaultLegalDocument("terms").contentHtml)
      .digest("hex"),
  );
});
test("publishing Terms as 1.0 immediately replaces the built-in fallback", async () => {
  const { currentCheckoutLegal } = loader()("lib/checkoutLegalServer.ts");
  const result = await currentCheckoutLegal(db());
  assert.equal(result.documents.find((d) => d.slug === "terms").version, "1.0");
  assert.equal(
    result.documents.find((d) => d.slug === "terms").isFallback,
    false,
  );
});
test("database errors fail closed rather than inventing a live policy version", async () => {
  const { currentCheckoutLegal } = loader()("lib/checkoutLegalServer.ts");
  await assert.rejects(() =>
    currentCheckoutLegal(db(null, { message: "offline" })),
  );
});
test("public policy metadata is uncached and requires complete activation", async () => {
  for (const ready of [true, false]) {
    const { GET } = loader({
      "@/lib/supabase/server": {
        createClient: async () => db(rows, null, ready),
      },
    })("app/api/checkout-legal/route.ts");
    const r = await GET();
    assert.equal(r.status, ready ? 200 : 503);
    assert.equal(r.headers.get("cache-control"), "no-store");
    if (ready) assert.equal((await r.json()).documents.length, 3);
  }
});
test("final checkbox has required wording and all three versioned new-tab links", () => {
  const { default: Component } = loader()("components/BookingLegalConsent.tsx");
  const React = native("react"),
    { renderToStaticMarkup } = native("react-dom/server");
  const html = renderToStaticMarkup(
    React.createElement(Component, {
      value: { accepted: false, documents },
      onChange: () => {},
      refreshKey: 0,
    }),
  );
  assert.match(html, /type="checkbox" required=""/);
  assert.match(html, /I accept the/);
  assert.match(html, /I have read the/);
  for (const slug of ["terms", "cancellation-refund", "privacy"])
    assert.match(
      html,
      new RegExp(
        `href="/legal/${slug}" target="_blank" rel="noopener noreferrer"`,
      ),
    );
  assert.equal((html.match(/Version 1\.0/g) || []).length, 3);
});
test("data export includes per-booking legal evidence and prepared consent snapshots", () => {
  const source = readFileSync("app/api/account/export/route.ts", "utf8");
  assert.match(
    source,
    /allFor\(ctx.admin, "account_legal_acceptances", "user_id", userId\)/,
  );
  assert.match(source, /booking_checkout_legal_consents/);
  assert.match(source, /checkoutLegal,/);
});
