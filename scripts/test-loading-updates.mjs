import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
const require = createRequire(import.meta.url);

function hooks() {
  const slots = [];
  let cursor = 0;
  const effects = [];
  const transitions = [];
  const same = (a, b) =>
    a && b && a.length === b.length && a.every((v, i) => v === b[i]);
  const api = {
    useState(initial) {
      const index = cursor++;
      slots[index] ??= {
        value: typeof initial === "function" ? initial() : initial,
      };
      return [
        slots[index].value,
        (next) => {
          slots[index].value =
            typeof next === "function" ? next(slots[index].value) : next;
        },
      ];
    },
    useRef(initial) {
      const index = cursor++;
      return (slots[index] ??= { current: initial });
    },
    useCallback(fn, deps) {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps)) slots[index] = { fn, deps };
      return slots[index].fn;
    },
    useEffect(fn, deps) {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps)) {
        const previous = slots[index];
        slots[index] = { deps, cleanup: previous?.cleanup };
        effects.push(() => {
          previous?.cleanup?.();
          slots[index].cleanup = fn();
        });
      }
    },
    useTransition() {
      const index = cursor++;
      slots[index] ??= {
        pending: false,
        start: (fn) => {
          slots[index].pending = true;
          const promise = Promise.resolve(fn()).finally(() => {
            slots[index].pending = false;
          });
          transitions.push(promise);
        },
      };
      return [slots[index].pending, slots[index].start];
    },
  };
  return {
    api,
    render(Component, props) {
      cursor = 0;
      return Component(props);
    },
    effects() {
      while (effects.length) effects.shift()();
    },
    async settle() {
      await Promise.all(transitions.splice(0));
      await flush();
    },
    cleanup() {
      slots.forEach((slot) => slot?.cleanup?.());
    },
  };
}
function browser() {
  const window = new EventTarget();
  const document = new EventTarget();
  document.visibilityState = "visible";
  document.getElementById = () => null;
  const navigator = { onLine: true };
  const timers = new Map();
  let id = 0;
  window.setTimeout = (fn, ms) => {
    timers.set(++id, { fn, ms, repeat: false });
    return id;
  };
  window.clearTimeout = (timer) => timers.delete(timer);
  window.setInterval = (fn, ms) => {
    timers.set(++id, { fn, ms, repeat: true });
    return id;
  };
  window.clearInterval = window.clearTimeout;
  return {
    window,
    document,
    navigator,
    timers,
    run(ms) {
      for (const [timer, item] of [...timers])
        if (item.ms === ms) {
          if (!item.repeat) timers.delete(timer);
          item.fn();
        }
    },
  };
}
async function load(file, mocks = {}, globals = {}) {
  const source = await readFile(new URL("../" + file, import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    console,
    Event,
    Date,
    ...globals,
    require: (id) => {
      const mock = mocks[id];
      if (mock) return "default" in mock ? { __esModule: true, ...mock } : mock;
      if (id.endsWith(".module.css")) return { __esModule: true, default: {} };
      return require(id);
    },
  });
  return module.exports;
}
const updates = await load("lib/portalUpdates.ts");
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise(setImmediate);
};
function elements(tree, type) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree))
    return tree.flatMap((child) => elements(child, type));
  return [
    ...(tree.type === type ? [tree] : []),
    ...elements(tree.props?.children, type),
  ];
}
const text = (tree) => {
  if (tree == null || typeof tree === "boolean") return "";
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  if (Array.isArray(tree)) return tree.map(text).join("");
  return text(tree.props?.children);
};

test("active portals refresh every 10 seconds and background pages every 30", () => {
  for (const path of [
    "/account",
    "/account/visit/123",
    "/worker",
    "/worker/current",
    "/worker/job/123",
    "/worker/jobs",
  ])
    assert.equal(updates.portalRefreshInterval(path), 10000);
  assert.equal(updates.portalRefreshInterval("/account/profile"), 30000);
  assert.equal(updates.portalRefreshInterval("/worker/earnings"), 30000);
});

test("realtime bursts, reconnects and fallback update the portal; hidden and offline tabs do no work", async () => {
  const h = hooks(),
    b = browser();
  let refreshes = 0,
    callback,
    subscribed,
    options,
    removed = 0,
    dataEvents = 0;
  b.window.addEventListener(updates.PORTAL_DATA_UPDATED, () => dataEvents++);
  const channel = {
    on(_type, opts, cb) {
      options = opts;
      callback = cb;
      return this;
    },
    subscribe(cb) {
      subscribed = cb;
      return this;
    },
  };
  const { default: Portal } = await load(
    "components/PortalLiveSync.tsx",
    {
      react: h.api,
      "next/navigation": {
        useRouter: () => router,
        usePathname: () => "/worker/current",
      },
      "@/lib/supabase/client": {
        createClient: () => ({
          channel: () => channel,
          removeChannel: () => {
            removed++;
          },
        }),
      },
      "@/lib/portalUpdates": updates,
    },
    {
      ...b,
      setTimeout: b.window.setTimeout,
      clearTimeout: b.window.clearTimeout,
    },
  );
  const router = { refresh: () => refreshes++ };
  h.render(Portal, { userId: "worker-a" });
  h.effects();
  assert.equal(options.filter, "user_id=eq.worker-a");
  callback();
  callback();
  callback();
  b.run(350);
  await h.settle();
  assert.equal(refreshes, 1);
  assert.equal(dataEvents, 1);
  b.run(10000);
  b.run(350);
  await h.settle();
  assert.equal(refreshes, 2);
  b.document.visibilityState = "hidden";
  b.run(10000);
  b.run(350);
  assert.equal(refreshes, 2);
  b.document.visibilityState = "visible";
  b.navigator.onLine = false;
  b.window.dispatchEvent(new Event("offline"));
  h.render(Portal, { userId: "worker-a" });
  assert.match(text(h.render(Portal, { userId: "worker-a" })), /offline/);
  b.run(10000);
  b.run(350);
  assert.equal(refreshes, 2);
  b.navigator.onLine = true;
  b.window.dispatchEvent(new Event("online"));
  b.run(350);
  await h.settle();
  assert.equal(refreshes, 3);
  subscribed("SUBSCRIBED");
  b.run(350);
  await h.settle();
  assert.equal(refreshes, 4);
  h.cleanup();
  assert.equal(removed, 1);
  assert.equal(b.timers.size, 0);
});

test("check-in shows GPS progress immediately, blocks duplicate taps and refreshes after the response", async () => {
  const h = hooks(),
    b = browser();
  let position,
    locations = 0,
    calls = 0,
    refreshes = 0,
    requested = 0;
  b.navigator.geolocation = {
    getCurrentPosition(cb) {
      locations++;
      position = cb;
    },
  };
  const { CheckInControl } = await load(
    "app/worker/JobActions.tsx",
    {
      react: h.api,
      "next/navigation": { useRouter: () => ({ refresh: () => refreshes++ }) },
      "./actions": {
        checkInJob: async () => {
          calls++;
          return {
            reason: "Location confirmed. Share the code.",
            otpRequired: true,
          };
        },
      },
      "./JobExceptions": { default: () => null },
      "@/components/ReviewVisibilityChoice": { default: () => null },
      "@/lib/portalUpdates": { requestPortalRefresh: () => requested++ },
    },
    b,
  );
  const props = { id: "booking-a", compact: true };
  const original = elements(h.render(CheckInControl, props), "button")[0];
  original.props.onClick();
  original.props.onClick();
  const locating = elements(h.render(CheckInControl, props), "button")[0];
  assert.equal(locations, 1);
  assert.equal(locating.props.disabled, true);
  assert.match(text(locating), /Finding your location/);
  position({ coords: { latitude: 51.5, longitude: -0.1 } });
  await h.settle();
  assert.equal(calls, 1);
  assert.equal(refreshes, 1);
  assert.equal(requested, 1);
  assert.match(text(h.render(CheckInControl, props)), /6-digit code/);
});

test("a failed checkout is explained and does not retry the money action automatically", async () => {
  const h = hooks();
  let calls = 0;
  const { default: Actions } = await load("app/worker/JobActions.tsx", {
    react: h.api,
    "next/navigation": { useRouter: () => ({ refresh() {}, replace() {} }) },
    "./actions": {
      checkOutJob: async () => {
        calls++;
        throw Error("connection lost");
      },
    },
    "./JobExceptions": { default: () => null },
    "@/components/ReviewVisibilityChoice": { default: () => null },
    "@/lib/portalUpdates": { requestPortalRefresh() {} },
  });
  const props = {
    id: "booking-a",
    status: "in_progress",
    scheduledAt: "2026-10-12",
    showExceptions: false,
  };
  const button = elements(h.render(Actions, props), "button")[0];
  button.props.onClick();
  button.props.onClick();
  assert.match(text(h.render(Actions, props)), /Finishing/);
  await h.settle();
  assert.equal(calls, 1);
  assert.match(
    text(h.render(Actions, props)),
    /Refresh the job status before trying again/,
  );
});

test("message text appears before slow photo previews; delayed previews cannot overwrite a newer thread", async () => {
  const h = hooks(),
    b = browser();
  let resolvePhoto;
  const photo = new Promise((resolve) => {
    resolvePhoto = resolve;
  });
  let body = "Provider has arrived",
    reads = 0;
  const client = {
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: "customer-a" } } },
      }),
    },
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        order() {
          reads++;
          return Promise.resolve({
            data: [
              {
                id: 1,
                sender_id: "provider-a",
                sender_role: "provider",
                body,
                created_at: "2026-10-12",
                read_at: "2026-10-12",
                booking_message_attachments:
                  body === "Provider has arrived"
                    ? {
                        path: "private/photo",
                        name: "Door.jpg",
                        mime_type: "image/jpeg",
                      }
                    : null,
              },
            ],
          });
        },
      };
    },
    storage: { from: () => ({ createSignedUrl: () => photo }) },
    channel() {
      return {
        on() {
          return this;
        },
        subscribe() {
          return this;
        },
      };
    },
    removeChannel() {},
  };
  const { default: Thread } = await load(
    "components/MessageThread.tsx",
    {
      react: h.api,
      "@/lib/supabase/client": { createClient: () => client },
      "@/lib/messageAttachments": await load("lib/messageAttachments.ts"),
      "./LoadingState": { default: () => null },
    },
    {
      ...b,
      setInterval: b.window.setInterval,
      clearInterval: b.window.clearInterval,
    },
  );
  const props = { bookingId: "booking-a", viewerRole: "customer", bare: true };
  h.render(Thread, props);
  h.effects();
  await flush();
  let tree = h.render(Thread, props);
  assert.match(text(tree), /Provider has arrived/);
  assert.match(text(tree), /Loading photo/);
  body = "Job complete";
  b.run(10000);
  await flush();
  assert.match(text(h.render(Thread, props)), /Job complete/);
  resolvePhoto({ data: { signedUrl: "https://storage.example/signed" } });
  await flush();
  assert.doesNotMatch(text(h.render(Thread, props)), /Provider has arrived/);
  const before = reads;
  b.document.visibilityState = "hidden";
  b.run(10000);
  await flush();
  assert.equal(reads, before);
  h.cleanup();
});

test("notifications reload on portal updates, scope to the signed-in user and report query failures", async () => {
  const h = hooks(),
    b = browser();
  let rows = [],
    reads = 0,
    userFilter,
    failure = null;
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "customer-a" } } }) },
    from() {
      return {
        select() {
          return this;
        },
        eq(key, value) {
          if (key === "user_id") userFilter = value;
          return this;
        },
        order() {
          return this;
        },
        limit() {
          reads++;
          return Promise.resolve({ data: rows, error: failure });
        },
      };
    },
  };
  const { default: List } = await load(
    "components/NotificationsList.tsx",
    {
      react: h.api,
      "@/lib/supabase/client": { createClient: () => client },
      "./LoadingState": { default: () => null },
      "@/lib/portalUpdates": updates,
      "next/link": { default: (props) => React.createElement("a", props) },
    },
    b,
  );
  h.render(List);
  h.effects();
  await flush();
  assert.equal(userFilter, "customer-a");
  rows = [
    {
      id: "note",
      title: "Cleaner checked in",
      read: false,
      created_at: "2026-10-12",
    },
  ];
  b.window.dispatchEvent(new Event(updates.PORTAL_DATA_UPDATED));
  await flush();
  assert.match(text(h.render(List)), /Cleaner checked in/);
  failure = Error("offline");
  b.window.dispatchEvent(new Event(updates.PORTAL_DATA_UPDATED));
  await flush();
  assert.match(text(h.render(List)), /Updates could not be loaded/);
  assert.match(text(h.render(List)), /Cleaner checked in/);
  h.cleanup();
  const before = reads;
  b.window.dispatchEvent(new Event(updates.PORTAL_DATA_UPDATED));
  await flush();
  assert.equal(reads, before);
});

test("loading screens provide an accessible status and keep reduced-motion support", async () => {
  const { default: Loading } = await load("components/LoadingState.tsx");
  const html = renderToStaticMarkup(
    React.createElement(Loading, { title: "Loading your current job…" }),
  );
  assert.match(html, /role="status"/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /Loading your current job/);
  const css = await readFile(
    new URL("../components/LoadingState.module.css", import.meta.url),
    "utf8",
  );
  assert.match(css, /prefers-reduced-motion/);
});

test("sign-in listeners return immediately and defer auth reads until the lock is released", async () => {
  for (const file of ["components/TopBar.tsx", "components/SiteHeader.tsx"]) {
    const h = hooks(),
      b = browser();
    let callback,
      reads = 0,
      locked = false;
    const client = {
      auth: {
        getUser: async () => {
          assert.equal(
            locked,
            false,
            "auth reads must run outside the callback",
          );
          reads++;
          return { data: { user: null } };
        },
        onAuthStateChange(cb) {
          callback = cb;
          return { data: { subscription: { unsubscribe() {} } } };
        },
      },
    };
    const mocks = {
      react: { ...React, ...h.api },
      "next/navigation": { usePathname: () => "/" },
      "@/lib/supabase/client": { createClient: () => client },
      "@/lib/professionalAccess": { canUseProfessionalTools: () => false },
      "@/lib/portalUpdates": updates,
      "@/components/CleaningMenu": { default: () => null },
      "@/components/ComingSoonMenu": { default: () => null },
      "./AccountModeSwitch": { default: () => null },
    };
    const { default: Header } = await load(file, mocks, {
      ...b,
      setTimeout: b.window.setTimeout,
      clearTimeout: b.window.clearTimeout,
      setInterval: b.window.setInterval,
      clearInterval: b.window.clearInterval,
    });
    h.render(Header);
    h.effects();
    await flush();
    const before = reads;
    locked = true;
    assert.equal(callback(), undefined);
    assert.equal(reads, before);
    locked = false;
    b.run(0);
    await flush();
    assert.equal(reads, before + 1);
    h.cleanup();
    assert.equal(b.timers.size, 0);
  }
});

test("notification fallback requests a portal refresh once and cannot loop on its own event", async () => {
  const h = hooks(),
    b = browser();
  let reads = 0,
    refreshes = 0,
    authChanged;
  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: "customer-a" } } }),
      onAuthStateChange(cb) {
        authChanged = cb;
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        gt() {
          return this;
        },
        order() {
          return this;
        },
        limit() {
          reads++;
          return Promise.resolve({
            data: [
              {
                id: "note-a",
                title: "Your cleaner checked in",
                body: "Visit started",
                href: "/account",
              },
            ],
          });
        },
      };
    },
  };
  const { default: Toaster } = await load(
    "components/Toaster.tsx",
    {
      react: h.api,
      "@/lib/supabase/client": { createClient: () => client },
      "@/lib/portalUpdates": {
        requestPortalRefresh: () => {
          refreshes++;
          b.window.dispatchEvent(new Event(updates.PORTAL_REFRESH_REQUESTED));
        },
      },
    },
    {
      ...b,
      setTimeout: b.window.setTimeout,
      clearTimeout: b.window.clearTimeout,
      setInterval: b.window.setInterval,
      clearInterval: b.window.clearInterval,
    },
  );
  h.render(Toaster);
  h.effects();
  await flush();
  assert.equal(refreshes, 1);
  assert.match(text(h.render(Toaster)), /Your cleaner checked in/);
  b.run(10000);
  await flush();
  assert.equal(refreshes, 1);
  assert.equal(reads, 2);
  b.document.visibilityState = "hidden";
  b.run(10000);
  await flush();
  assert.equal(reads, 2);
  authChanged("SIGNED_OUT", null);
  assert.equal(text(h.render(Toaster)), "");
  h.cleanup();
  assert.equal(b.timers.size, 0);
});
