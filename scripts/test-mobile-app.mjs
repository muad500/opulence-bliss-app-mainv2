import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

async function loadModule(file, mocks = {}) {
  const source = await readFile(new URL("../" + file, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    exports: module.exports,
    module,
    require: (name) => mocks[name],
    Request,
    Response,
    URL,
  });
  return module.exports;
}

test("Android association matches the signing certificate and excludes the admin host", async () => {
  const certificate = JSON.parse(
    await readFile(
      new URL("../mobile/android/signing-certificate.json", import.meta.url),
    ),
  );
  const { GET } = await loadModule("app/.well-known/assetlinks.json/route.ts", {
    "@/mobile/android/signing-certificate.json": certificate,
    "@/lib/androidStagingAssociation": { stagingAndroidAssociation: () => null },
  });
  const response = GET(
    new Request("https://www.opulencebliss.com/.well-known/assetlinks.json"),
  );
  assert.equal(response.status, 200);
  const [statement] = await response.json();
  assert.equal(statement.target.package_name, "com.opulencebliss.app");
  assert.deepEqual(statement.target.sha256_cert_fingerprints, [
    certificate.sha256Fingerprint,
  ]);
  assert.match(
    certificate.sha256Fingerprint,
    /^([A-F0-9]{2}:){31}[A-F0-9]{2}$/,
  );
  for (const host of ["admin.opulencebliss.com", "example.com"]) {
    assert.equal(
      GET(new Request(`https://${host}/.well-known/assetlinks.json`)).status,
      404,
    );
  }
});

test("customer and worker manifests have independent launches and no cross-role shortcuts", async () => {
  const experience = await loadModule("lib/mobileExperience.ts");
  const { mobileManifest } = await loadModule("lib/mobileManifest.ts", {
    "./mobileExperience": experience,
  });
  const { default: manifest } = await loadModule("app/manifest.ts", {
    "@/lib/mobileManifest": { mobileManifest },
  });
  const customer = manifest(),
    worker = mobileManifest("worker");
  assert.equal(customer.start_url, "/mobile/customer");
  assert.equal(worker.start_url, "/mobile/worker");
  assert.equal(customer.display, "standalone");
  assert.doesNotMatch(
    JSON.stringify(customer),
    /My jobs|professional jobs|worker|client account/i,
  );
  assert.doesNotMatch(
    JSON.stringify(worker.shortcuts),
    /Book a clean|bookings/i,
  );
  assert.notEqual(customer.id, worker.id);
  assert.equal(
    worker.shortcuts.find((item) => item.name === "My jobs").url,
    "/mobile/worker?screen=jobs",
  );
  assert.equal(experience.appPathAllowed("customer", "/worker/jobs"), false);
  assert.equal(experience.appPathAllowed("customer", "/provider/join"), false);
  assert.equal(experience.appPathAllowed("worker", "/book"), false);
  assert.equal(
    experience.appPathAllowed("worker", "/worker/application"),
    true,
  );
  assert.equal(experience.appScreen("customer", "jobs"), null);
  assert.equal(experience.appScreen("worker", "book"), null);
});

test("offline support never caches private pages, API responses or payment requests", async () => {
  const handlers = new Map();
  const writes = [];
  const cache = { add: async (url) => writes.push(url) };
  let networkFails = false;
  const source = await readFile(
    new URL("../public/app-worker.js", import.meta.url),
    "utf8",
  );
  vm.runInNewContext(source, {
    self: {
      location: { origin: "https://www.opulencebliss.com" },
      addEventListener: (name, handler) => handlers.set(name, handler),
      skipWaiting: () => {},
      clients: { claim: async () => {} },
    },
    caches: {
      open: async () => cache,
      keys: async () => [],
      match: async () => new Response("public offline help"),
    },
    fetch: async () => {
      if (networkFails) throw new Error("offline");
      return new Response("private account data");
    },
    URL,
    Response,
  });
  const pending = [];
  handlers.get("install")({ waitUntil: (promise) => pending.push(promise) });
  await Promise.all(pending);
  assert.deepEqual(writes, ["/offline.html"]);
  for (const [method, mode, path] of [
    ["POST", "navigate", "/api/checkout"],
    ["GET", "cors", "/api/account/export"],
    ["GET", "cors", "/api/messages"],
  ]) {
    let intercepted = false;
    handlers.get("fetch")({
      request: { method, mode, url: "https://www.opulencebliss.com" + path },
      respondWith: () => {
        intercepted = true;
      },
    });
    assert.equal(intercepted, false);
  }
  for (const fails of [false, true]) {
    networkFails = fails;
    let response;
    handlers.get("fetch")({
      request: {
        method: "GET",
        mode: "navigate",
        url: "https://www.opulencebliss.com/account",
      },
      respondWith: (promise) => {
        response = promise;
      },
    });
    assert.equal(
      await (await response).text(),
      fails ? "public offline help" : "private account data",
    );
    assert.deepEqual(writes, ["/offline.html"]);
  }
});
