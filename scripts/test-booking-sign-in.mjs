import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import React from "react";

const require = createRequire(import.meta.url);
const packages = [
  {
    id: "one-off",
    name: "One-Time Essential Clean",
    price: 45.98,
    service_type: "cleaning",
    duration_minutes: 120,
  },
];
const day = new Date();
day.setUTCDate(day.getUTCDate() + 7);
day.setUTCHours(9, 0, 0, 0);
const slot = day.toISOString();
const optional = new Date(day.getTime() + 3_600_000).toISOString();
const choices = {
  packageId: "one-off",
  postcode: "EC1V 2NX",
  address: "128 City Road, London",
  home: { propertyType: "flat", bedrooms: 2, bathrooms: 1 },
  frequency: "one_time",
  regularVisits: 6,
  cleaningMinutes: 120,
  extras: { addons: ["oven"], bringsProducts: true },
  visitOverrides: {},
  petsAtHome: true,
  slot,
  optionalSlots: [optional],
  request: "Ring the bell",
  preferences: {
    howHeard: "Instagram",
    confirmationChannel: "sms",
    roomsToClean: "Kitchen and bedrooms",
    accessInstructions: "Concierge",
  },
  promo: "WELCOME",
  preferredCleaner: "",
  phone: "",
};

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

function harness({
  user = true,
  available = [slot, optional],
  tab = storage(),
  resume = "token",
  packageList = packages,
  draft = choices,
  slotsFailure = false,
} = {}) {
  const state = [];
  const effects = [];
  const dependencies = [];
  let index = 0;
  const window = {
    location: {
      search: `?resume=${resume}`,
      href: "",
      assign(url) { this.href = url; },
    },
    sessionStorage: tab,
    history: {
      state: null,
      replaceState(_state, _title, url) {
        window.location.search = new URL(url, "https://staging.example").search;
      },
    },
  };
  const calls = [];
  const intervals = new Map();
  const hooks = {
    ...React,
    useState(initial) {
      const key = index++;
      if (!(key in state))
        state[key] = typeof initial === "function" ? initial() : initial;
      return [
        state[key],
        (value) => {
          state[key] = typeof value === "function" ? value(state[key]) : value;
        },
      ];
    },
    useRef(initial) {
      const key = index++;
      return (state[key] ??= { current: initial });
    },
    useEffect(effect, deps) {
      const key = index++;
      if (
        !(key in dependencies) ||
        deps.some((value, i) => value !== dependencies[key][i])
      ) {
        dependencies[key] = deps;
        effects.push(effect);
      }
    },
  };
  const profile = {
    role: "customer",
    postcode: "W1A 1AA",
    address: "An account's default address",
    phone: "+447400123456",
  };
  const supabase = {
    auth: {
      getUser: async () => ({
        data: { user: user ? { id: "customer" } : null },
      }),
    },
    rpc: async () => ({ data: [] }),
    from(table) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        ilike: () => chain,
        order: () => chain,
        maybeSingle: async () => ({ data: profile }),
        then(resolve) {
          resolve({
            data:
              table === "packages"
                ? packageList
                : table === "service_areas"
                  ? [{ name: "London", postcode_prefixes: ["EC1V", "W1A"] }]
                  : [],
          });
        },
      };
      return chain;
    },
  };
  const fetch = async (url) => {
    calls.push(url);
    if (url.startsWith("/api/slots"))
      return {
        ok: !slotsFailure,
        json: async () => ({ covered: true, slots: available }),
      };
    if (url === "/api/account/profile")
      return {
        ok: true,
        json: async () => ({
          addresses: [
            {
              id: "default-address",
              isDefault: true,
              line1: "Other home",
              city: "London",
              postcode: "W1A 1AA",
              propertyType: "house",
              bedrooms: 5,
              bathrooms: 3,
            },
          ],
          favourites: [],
        }),
      };
    if (url === "/api/visit-billing-config")
      return {
        json: async () => ({
          perVisitBilling: true,
          pricing: load("lib/cleaningBillingTerms.ts")
            .DEFAULT_CLEANING_BILLING_TERMS,
        }),
      };
    throw new Error(`Unexpected request: ${url}`);
  };
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const module = { exports: {} };
    cache.set(file, module.exports);
    const compiled = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText;
    vm.runInNewContext(
      compiled,
      {
        module,
        exports: module.exports,
        require(id) {
          if (id === "react") return hooks;
          if (id === "@/lib/supabase/client")
            return { createClient: () => supabase };
          if (id.startsWith("@/components/"))
            return { __esModule: true, default: () => null };
          if (id.startsWith("@/")) return load(id.slice(2) + ".ts");
          if (id.startsWith("./")) return load("lib/" + id.slice(2) + ".ts");
          return require(id);
        },
        window,
        fetch,
        console,
        process: { env: {} },
        URLSearchParams,
        Date,
        crypto,
        setTimeout,
        setInterval(callback, delay) {
          const id = intervals.size + 1;
          intervals.set(id, { callback, delay });
          return id;
        },
        clearInterval(id) { intervals.delete(id); },
      },
      { filename: file },
    );
    return module.exports;
  }
  const drafts = load("lib/bookingDraft.ts");
  if (!tab.getItem("opulence-booking-sign-in-draft"))
    drafts.saveBookingDraft(tab, draft, Date.now(), "token");
  const Page = load("app/book/page.tsx").default;
  function render() {
    index = 0;
    return Page();
  }
  async function settle() {
    let tree = render();
    for (let i = 0; i < 8; i++) {
      for (const effect of effects.splice(0)) effect();
      await new Promise(setImmediate);
      tree = render();
    }
    return tree;
  }
  return { settle, tab, window, calls };
}

function elements(node) {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object") return [];
  return [node, ...elements(node.props?.children)];
}
function text(node) {
  if (Array.isArray(node)) return node.map(text).join("");
  if (node == null || typeof node === "boolean") return "";
  if (node.type === "style") return "";
  return typeof node === "object" ? text(node.props?.children) : String(node);
}

test("sign-in returns to confirmation with the entered booking rather than account defaults", async () => {
  const app = harness();
  const tree = await app.settle();
  const content = text(tree);
  assert.match(content, /Step 6 of 6/);
  assert.match(content, /128 City Road, London/);
  assert.doesNotMatch(content, /Other home/);
  assert.match(content, /£70.98/);
  assert.equal(
    elements(tree).find(
      (node) =>
        node.type === "textarea" &&
        node.props.placeholder?.includes("key is under"),
    )?.props.value,
    "Ring the bell",
  );
  assert.equal(
    elements(tree).find(
      (node) => node.type === "button" && text(node) === "Confirm & pay",
    ).props.disabled,
    true,
    "saved-card consent must be confirmed again",
  );
  assert.ok(
    app.calls.some((url) => url.includes("duration=180")),
    "availability uses the restored base hours plus oven time",
  );
  assert.equal(
    app.calls.includes("/api/checkout"),
    false,
    "returning never automatically charges",
  );
  assert.equal(
    app.tab.getItem("opulence-booking-sign-in-draft"),
    null,
    "consumed personal draft is removed",
  );
});

test("an anonymous return saves the complete choices before leaving for sign-in", async () => {
  const app = harness({ user: false });
  const tree = await app.settle();
  const button = elements(tree).find(
    (node) => node.type === "button" && text(node) === "Sign in to continue",
  );
  assert.equal(
    button.props.disabled,
    false,
    "sign-in does not require consenting to a card that is not linked to an account yet",
  );
  button.props.onClick();
  const login = new URL(app.window.location.href, "https://staging.example");
  assert.equal(login.pathname, "/login");
  const next = login.searchParams.get("next");
  assert.match(next, /^\/book\?resume=/);
  assert.doesNotMatch(next, /City|EC1V|bell/);
  const back = harness({
    user: true,
    tab: app.tab,
    resume: new URL(next, "https://staging.example").searchParams.get("resume"),
  });
  const returned = await back.settle();
  assert.match(text(returned), /Step 6 of 6/);
  assert.match(text(returned), /£70.98/);
});

test("regular visit count and individual extras survive while prices are recalculated", async () => {
  const app = harness({
    packageList: [
      {
        ...packages[0],
        id: "essential",
        name: "Essential Clean",
        price: 37.98,
      },
    ],
    draft: {
      ...choices,
      packageId: "essential",
      frequency: "weekly",
      regularVisits: 8,
      extras: { addons: ["fridge"], bringsProducts: true },
      visitOverrides: { 1: { addons: [], bringsProducts: false } },
    },
  });
  const tree = await app.settle();
  assert.match(text(tree), /Step 6 of 6/);
  assert.match(text(tree), /Save card and book visits/);
  assert.match(text(tree), /£408.84/);
  assert.match(text(tree), /8 visits/);
  const changed = harness({ packageList: [{ ...packages[0], price: 55.98 }] });
  assert.match(text(await changed.settle()), /£80.98/);
});

test("a stale preferred time returns to Time while preserving the rest of the booking", async () => {
  const app = harness({ available: [optional] });
  const tree = await app.settle();
  assert.match(text(tree), /Step 5 of 6/);
  assert.match(text(tree), /preferred time is no longer available/);
  assert.match(text(tree), /128 City Road/);
  assert.match(text(tree), /£70.98/);
});

test("an unavailable optional time also requires reviewing Time before payment", async () => {
  const app = harness({ available: [slot] });
  const tree = await app.settle();
  assert.match(text(tree), /Step 5 of 6/);
  assert.match(text(tree), /Some optional times are no longer available/);
});

test("an availability outage keeps the details and blocks a stale confirmation", async () => {
  const app = harness({ slotsFailure: true });
  const tree = await app.settle();
  assert.match(text(tree), /Step 5 of 6/);
  assert.match(text(tree), /check the available times again/);
  assert.match(text(tree), /128 City Road/);
  assert.ok(
    app.tab.getItem("opulence-booking-sign-in-draft"),
    "a transient outage keeps the draft for reload and retry",
  );
  assert.equal(app.calls.includes("/api/checkout"), false);
});
