import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
async function load(file, mocks = {}, context = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(
    await readFile(new URL("../" + file, import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    },
  ).outputText;
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    require: (key) => {
      if (!(key in mocks)) throw Error("Missing test mock " + key);
      return mocks[key];
    },
    URL,
    Response,
    Request,
    console,
    ...context,
  });
  return module.exports;
}
const policy = await load("lib/notificationSettings.ts");
test("settings API authenticates, checks origin, rejects unknown types and SMS while disabled", async () => {
  let user = { id: "owner" };
  const calls = [];
  const { GET, POST } = await load(
    "app/api/notification-settings/route.ts",
    {
      "@/lib/supabase/server": {
        createClient: async () => ({
          auth: { getUser: async () => ({ data: { user } }) },
          rpc: async (...args) => {
            calls.push(args);
            return { data: { preferences: [], devices: [] } };
          },
        }),
      },
      "@/lib/notificationSettings": policy,
      "@/lib/webPushPolicy": { webPushEnabled: () => true },
      "@/lib/bookingSms": { bookingSmsConfig: () => null },
    },
    { process: { env: {} } },
  );
  const deviceId = "50000000-0000-4000-8000-000000000001";
  const post = (body, origin = "https://stage.test") =>
    POST(
      new Request("https://stage.test/api/notification-settings", {
        method: "POST",
        headers: { origin },
        body: JSON.stringify(body),
      }),
    );
  const preference = {
    audience: "customer",
    kind: "messages",
    channel: "email",
    enabled: false,
  };
  assert.equal(
    (
      await GET(
        new Request(
          "https://stage.test/api/notification-settings?device=" + deviceId,
        ),
      )
    ).status,
    200,
  );
  assert.equal(
    (await post({ deviceId, preferences: [preference] }, "https://evil.test"))
      .status,
    403,
  );
  assert.equal(
    (
      await post({
        deviceId,
        preferences: [{ ...preference, kind: "unknown" }],
      })
    ).status,
    400,
  );
  assert.equal(
    (await post({ deviceId, preferences: [{ ...preference, channel: "sms" }] }))
      .status,
    409,
  );
  assert.equal(
    (await post({ deviceId, preferences: [preference] })).status,
    200,
  );
  assert.equal(calls.at(-1)[0], "save_notification_settings");
  user = null;
  assert.equal(
    (await post({ deviceId, preferences: [preference] })).status,
    401,
  );
});
test("friendly card never requests permission until Turn on; Not now saves a server snooze", async () => {
  let index = 0;
  const state = [],
    effects = [],
    calls = [];
  let requests = 0;
  const jsx = (type, props) => ({ type, props });
  const { default: Card } = await load(
    "components/PushNotifications.tsx",
    {
      react: {
        useState: (initial) => {
          const i = index++;
          if (!(i in state)) state[i] = initial;
          return [
            state[i],
            (value) =>
              (state[i] =
                typeof value === "function" ? value(state[i]) : value),
          ];
        },
        useEffect: (f) => effects.push(f),
      },
      "react/jsx-runtime": { jsx, jsxs: jsx },
      "next/navigation": { usePathname: () => "/worker/jobs" },
      "@/lib/supabase/client": {
        createClient: () => ({
          auth: {
            onAuthStateChange: () => ({
              data: { subscription: { unsubscribe() {} } },
            }),
          },
        }),
      },
      "@/lib/pushBrowser": {
        blockedInstructions: "Open settings to allow notifications.",
        notificationDeviceId: () => "",
        pushSupported: () => true,
        pushRequest: async (body) => calls.push(body),
        subscribeDevice: async () => calls.push({ action: "subscribe" }),
      },
      "@/lib/notificationSettings": policy,
      "./PushNotifications.module.css": { panel: "panel", actions: "actions" },
    },
    {
      fetch: async () => ({
        ok: true,
        json: async () => ({
          enabled: true,
          eligible: true,
          hasConsent: false,
          optedOut: false,
          professional: true,
          userId: "owner",
          publicKey: "fixture",
          promptAfter: null,
        }),
      }),
      window: {
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {},
      },
      Notification: {
        permission: "default",
        requestPermission: async () => {
          requests++;
          return "granted";
        },
      },
      Event: class {},
    },
  );
  const render = () => {
    index = 0;
    effects.length = 0;
    return Card();
  };
  render();
  for (const effect of [...effects]) effect();
  await new Promise((r) => setImmediate(r));
  const tree = render();
  assert.equal(requests, 0);
  const flatten = (node) =>
    !node || typeof node !== "object"
      ? []
      : [node, ...[node.props?.children].flat(Infinity).flatMap(flatten)];
  const buttons = flatten(tree).filter((n) => n.type === "button");
  assert.equal(buttons.length, 2);
  assert.equal(buttons[0].props.children, "Turn on");
  buttons[1].props.onClick();
  await new Promise((r) => setImmediate(r));
  assert.equal(requests, 0);
  assert.equal(calls[0].action, "snooze");
  state[2] = false;
  const again = render();
  flatten(again)
    .find((n) => n.type === "button" && n.props.children === "Turn on")
    .props.onClick();
  await new Promise((r) => setImmediate(r));
  assert.equal(requests, 1);
  assert.equal(calls.at(-1).action, "subscribe");
});
test("extra email honours preference and avoids external sending when disabled", async () => {
  const calls = [],
    sent = [];
  const admin = {
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === "claim_extra_notification_emails")
        return {
          data: [
            {
              id: "1",
              claim_token: "t",
              email: "demo@example.invalid",
              title: "Payment failed",
              href: "/account",
            },
          ],
        };
      if (name === "extra_notification_email_allowed") return { data: false };
      return {};
    },
  };
  const { deliverExtraNotificationEmails } = await load(
    "lib/notificationExtraEmail.ts",
    {
      "./webPushPolicy": {
        webPushEnabled: () => true,
        webPushEnvironment: () => "staging",
      },
      "./adminHosts": { notificationLink: () => "" },
    },
    {
      process: {
        env: {
          RESEND_API_KEY: "fixture",
          EMAIL_FROM: "no-reply@example.invalid",
          NEXT_PUBLIC_SITE_URL: "https://stage.test",
          STAGING_EMAIL_RECIPIENTS: "demo@example.invalid",
        },
      },
      fetch: async (...args) => {
        sent.push(args);
        return { ok: true };
      },
      AbortSignal,
    },
  );
  await deliverExtraNotificationEmails(admin);
  assert.equal(sent.length, 0);
  assert.equal(calls.at(-1)[1].p_outcome, "cancelled");
});

test("Production delivers allowed operational email without a staging recipient restriction", async () => {
  for (const environment of ["staging", "production"]) {
    const sent = [];
    const outcomes = [];
    const admin = {
      rpc: async (name, args) => {
        if (name === "claim_extra_notification_emails")
          return {
            data: [
              {
                id: "release-fixture",
                claim_token: "lease",
                email: "customer@example.invalid",
                title: "Payment needs attention",
                href: "/account",
              },
            ],
          };
        if (name === "extra_notification_email_allowed") return { data: true };
        outcomes.push(args.p_outcome);
        return {};
      },
    };
    const { deliverExtraNotificationEmails } = await load(
      "lib/notificationExtraEmail.ts",
      {
        "./webPushPolicy": {
          webPushEnabled: () => true,
          webPushEnvironment: () => environment,
        },
        "./adminHosts": {
          notificationLink: () => "https://www.example.invalid/account",
        },
      },
      {
        process: {
          env: {
            RESEND_API_KEY: "fixture",
            EMAIL_FROM: "hello@example.invalid",
            NEXT_PUBLIC_SITE_URL: "https://www.example.invalid",
            STAGING_EMAIL_RECIPIENTS: "tester@example.invalid",
          },
        },
        fetch: async (...args) => {
          sent.push(args);
          return { ok: true };
        },
        AbortSignal,
      },
    );
    await deliverExtraNotificationEmails(admin);
    assert.equal(sent.length, environment === "production" ? 1 : 0);
    assert.equal(
      outcomes[0],
      environment === "production" ? "sent" : "cancelled",
    );
  }
});

test("manual customer opt-in works before booking while professional approval stays required", async () => {
  for (const [audience, active, professional, disabled] of [
    ["customer", true, false, false],
    ["professional", true, false, true],
    ["professional", true, true, false],
    ["customer", false, false, true],
  ]) {
    let index = 0;
    const state = [],
      effects = [],
      subscriptions = [];
    let permissionRequests = 0;
    const jsx = (type, props) => ({ type, props });
    const config = {
      enabled: true,
      eligible: active,
      customerCanEnable: active,
      customerEligible: false,
      professional,
      optedOut: false,
      userId: "owner",
      publicKey: "fixture",
      hasConsent: false,
    };
    const { default: Panel } = await load(
      "components/NotificationSettings.tsx",
      {
        react: {
          useState: (initial) => {
            const i = index++;
            if (!(i in state)) state[i] = initial;
            return [
              state[i],
              (value) => {
                state[i] = value;
              },
            ];
          },
          useEffect: (effect) => effects.push(effect),
        },
        "react/jsx-runtime": { jsx, jsxs: jsx },
        "@/lib/notificationSettings": policy,
        "@/lib/pushBrowser": {
          blockedInstructions: "Open notification settings.",
          notificationDeviceId: () => "device",
          pushSupported: () => true,
          pushRequest: async () => {},
          subscribeDevice: async (...args) => subscriptions.push(args),
        },
        "./NotificationSettings.module.css": {},
      },
      {
        fetch: async (url) => ({
          ok: true,
          json: async () =>
            url === "/api/push"
              ? config
              : { devices: [], preferences: [], smsEnabled: false },
        }),
        window: {
          addEventListener() {},
          removeEventListener() {},
          dispatchEvent() {},
        },
        Notification: {
          permission: "default",
          requestPermission: async () => {
            permissionRequests++;
            return "granted";
          },
        },
        Event: class {},
      },
    );
    const render = () => {
      index = 0;
      effects.length = 0;
      return Panel({ audience });
    };
    render();
    for (const effect of [...effects]) effect();
    await new Promise((resolve) => setImmediate(resolve));
    const flatten = (node) =>
      !node || typeof node !== "object"
        ? []
        : [node, ...[node.props?.children].flat(Infinity).flatMap(flatten)];
    const button = flatten(render()).find(
      (node) => node.type === "button" && node.props.children === "Turn on",
    );
    assert.ok(button);
    assert.equal(button.props.disabled, disabled);
    assert.equal(
      permissionRequests,
      0,
      "settings never requests permission automatically",
    );
    if (!disabled) {
      button.props.onClick();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(permissionRequests, 1);
      assert.equal(
        subscriptions[0][2],
        true,
        "manual turn-on records explicit opt-in",
      );
    }
  }
});

test("a customer without a booking can opt in manually but is never automatically prompted", async () => {
  let index = 0;
  const state = [],
    effects = [];
  const jsx = (type, props) => ({ type, props });
  const { default: Card } = await load(
    "components/PushNotifications.tsx",
    {
      react: {
        useState: (initial) => {
          const i = index++;
          if (!(i in state)) state[i] = initial;
          return [
            state[i],
            (value) => {
              state[i] = value;
            },
          ];
        },
        useEffect: (effect) => effects.push(effect),
      },
      "react/jsx-runtime": { jsx, jsxs: jsx },
      "next/navigation": { usePathname: () => "/account" },
      "@/lib/supabase/client": {
        createClient: () => ({
          auth: {
            onAuthStateChange: () => ({
              data: { subscription: { unsubscribe() {} } },
            }),
          },
        }),
      },
      "@/lib/pushBrowser": {
        pushSupported: () => true,
        blockedInstructions: "",
        notificationDeviceId: () => "device",
        pushRequest: async () => {},
        subscribeDevice: async () => {},
      },
      "@/lib/notificationSettings": policy,
      "./PushNotifications.module.css": {},
    },
    {
      fetch: async () => ({
        ok: true,
        json: async () => ({
          enabled: true,
          eligible: true,
          customerCanEnable: true,
          customerEligible: false,
          professional: false,
          hasConsent: false,
          optedOut: false,
          promptAfter: null,
        }),
      }),
      window: { addEventListener() {}, removeEventListener() {} },
      Notification: {
        permission: "default",
        requestPermission: () => {
          assert.fail("Unbooked customers must not be automatically prompted");
        },
      },
    },
  );
  const render = () => {
    index = 0;
    effects.length = 0;
    return Card();
  };
  render();
  for (const effect of [...effects]) effect();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(render(), null);
});
