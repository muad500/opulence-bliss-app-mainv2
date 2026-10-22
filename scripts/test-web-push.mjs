import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
async function load(file, mocks = {}, context = {}) {
  const code = ts.transpileModule(
    await readFile(new URL("../" + file, import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    },
  ).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: (k) => mocks[k],
    URL,
    Response,
    ...context,
  });
  return module.exports;
}
const policy = await load("lib/webPushPolicy.ts");
const settingsPolicy = await load("lib/notificationSettings.ts");
const env = {
  WEB_PUSH_ENABLED: "true",
  NEXT_PUBLIC_SUPABASE_URL: "https://comwdjprdedmsnxtvuuk.supabase.co",
  VERCEL_ENV: "preview",
  WEB_PUSH_VAPID_PUBLIC_KEY: "public-fixture",
  WEB_PUSH_VAPID_PRIVATE_KEY: "private-fixture",
  WEB_PUSH_VAPID_SUBJECT: "mailto:hello@example.invalid",
};
const subscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/test",
  keys: { auth: "a".repeat(22), p256dh: "B" + "a".repeat(86) },
};
test("production and non-staging databases cannot enable push, even with the flag", () => {
  assert.equal(policy.webPushEnabled(env), true);
  for (const changes of [
    { VERCEL_ENV: "production" },
    { APP_ENV: "production" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://other.supabase.co" },
    { WEB_PUSH_ENABLED: "false" },
  ])
    assert.equal(policy.webPushEnabled({ ...env, ...changes }), false);
});
test("subscription validation rejects SSRF, Apple, ports, credentials and invalid keys", () => {
  assert.equal(policy.validPushSubscription(subscription), true);
  for (const endpoint of [
    "http://fcm.googleapis.com/x",
    "https://fcm.googleapis.com.evil.test/x",
    "https://127.0.0.1/x",
    "https://localhost/x",
    "https://fcm.googleapis.com:8443/x",
    "https://u:p@fcm.googleapis.com/x",
    "https://web.push.apple.com/x",
    "https://fcm.googleapis.com/x#secret",
  ])
    assert.equal(
      policy.validPushSubscription({ ...subscription, endpoint }),
      false,
      endpoint,
    );
  assert.equal(
    policy.validPushSubscription({
      ...subscription,
      keys: { auth: "bad", p256dh: "bad" },
    }),
    false,
  );
});
test("notification links cannot escape the origin or open staff pages", () => {
  for (const href of [
    "//evil.test",
    "https://evil.test",
    "/admin",
    "/account/\\evil.test",
    "/account?next=https://evil.test",
  ])
    assert.equal(policy.pushHref(href), "/notifications");
  assert.equal(policy.pushHref("/worker/job/123"), "/worker/job/123");
});
async function deliver({
  allowed = true,
  status,
  error = false,
  overrides = {},
} = {}) {
  const calls = [],
    payloads = [];
  const admin = {
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === "claim_web_push")
        return {
          data: [
            {
              id: "delivery",
              claim_token: "lease",
              notification_id: "1234-5678",
              user_id: "owner",
              kind: "message",
              href: "/account/visit/fixture",
              endpoint: subscription.endpoint,
              auth_key: subscription.keys.auth,
              p256dh: subscription.keys.p256dh,
            },
          ],
        };
      if (name === "web_push_delivery_allowed")
        return error
          ? { error: { message: "unavailable" } }
          : { data: allowed };
      return {};
    },
  };
  const push = {
    sendNotification: async (s, p, options) => {
      payloads.push([s, JSON.parse(p), options]);
      if (status) throw { statusCode: status };
    },
  };
  const { deliverWebPush } = await load(
    "lib/webPushDelivery.ts",
    { "server-only": {}, "web-push": push, "./webPushPolicy": policy },
    { process: { env: { ...env, ...overrides } } },
  );
  const result = await deliverWebPush(admin);
  return { calls, payloads, result };
}
test("push is additional delivery, uses encrypted payload, short TTL and no private message content", async () => {
  const { payloads, calls, result } = await deliver();
  assert.equal(result.sent, 1);
  assert.equal(payloads[0][1].userId, "owner");
  assert.equal(payloads[0][2].TTL, 300);
  assert.equal(payloads[0][1].body, policy.pushCopy.message[1]);
  assert.equal(calls.at(-1)[1].p_outcome, "sent");
});
test("preferences, expired offers, read notifications and signed-out sessions are rechecked before sending", async () => {
  const { payloads, calls } = await deliver({ allowed: false });
  assert.equal(payloads.length, 0);
  assert.equal(calls.at(-1)[1].p_outcome, "cancelled");
});
test("eligibility failures do not send and are retried without exposing endpoint/key", async () => {
  const { payloads, calls } = await deliver({ error: true });
  assert.equal(payloads.length, 0);
  assert.equal(calls.at(-1)[1].p_outcome, "retry");
});
for (const status of [404, 410, 429, 503])
  test(`push provider ${status}: correct cleanup/retry`, async () => {
    const { calls } = await deliver({ status });
    assert.equal(
      calls.at(-1)[1].p_outcome,
      [404, 410].includes(status) ? "expired" : "retry",
    );
  });
test("disabled push never claims the queue or contacts a push service", async () => {
  const { calls, payloads } = await deliver({
    overrides: { VERCEL_ENV: "production" },
  });
  assert.equal(calls.length, 0);
  assert.equal(payloads.length, 0);
});

test("subscription API requires authentication, same origin and bounded valid JSON", async () => {
  let user = { id: "demo" };
  const calls = [];
  const { POST, GET } = await load(
    "app/api/push/route.ts",
    {
      "@/lib/webPushPolicy": policy,
      "@/lib/notificationSettings": settingsPolicy,
      "@/lib/supabase/server": {
        createClient: async () => ({
          auth: { getUser: async () => ({ data: { user } }) },
          rpc: async (...args) => {
            calls.push(args);
            return { data: { eligible: true } };
          },
        }),
      },
    },
    { process: { env } },
  );
  const post = (body, origin = "https://stage.example") =>
    POST(
      new Request("https://stage.example/api/push", {
        method: "POST",
        headers: { origin },
        body,
      }),
    );
  assert.equal((await post("null")).status, 400);
  assert.equal((await post("not json")).status, 400);
  assert.equal((await post("{}", "https://evil.test")).status, 403);
  assert.equal(
    (
      await post(
        JSON.stringify({ subscription: { endpoint: "https://localhost" } }),
      )
    ).status,
    400,
  );
  assert.equal(
    (await post(JSON.stringify({ subscription, optIn: true, deviceId: "10000000-0000-4000-8000-000000000001" }))).status,
    200,
  );
  assert.equal(calls.at(-1)[1].p_opt_in, true);
  assert.equal((await post(JSON.stringify({ action: "disable", deviceId: "10000000-0000-4000-8000-000000000001" }))).status, 200);
  assert.equal(calls.at(-1)[0], "remove_web_push_device");
  user = null;
  assert.equal((await post("{}")).status, 401);
  assert.equal((await GET()).status, 401);
});
test("service worker hides notifications after logout/account switch and validates click targets", async () => {
  const handlers = new Map(),
    shown = [],
    opened = [];
  let account = "owner";
  const source = await readFile(
    new URL("../public/app-worker.js", import.meta.url),
    "utf8",
  );
  const self = {
    addEventListener: (k, v) => handlers.set(k, v),
    location: { origin: "https://staging.example" },
    registration: { showNotification: async (...args) => shown.push(args) },
    clients: {
      matchAll: async () => [],
      openWindow: async (x) => opened.push(x),
    },
  };
  vm.runInNewContext(source, {
    self,
    URL,
    fetch: async () => ({
      ok: !!account,
      json: async () => ({ enabled: true, userId: account }),
    }),
  });
  const run = async (type, event) => {
    let pending;
    handlers.get(type)({ ...event, waitUntil: (p) => (pending = p) });
    await pending;
  };
  await run("push", {
    data: {
      json: () => ({ userId: "owner", title: "Message", href: "//evil.test" }),
    },
  });
  assert.equal(shown.length, 1);
  assert.equal(shown[0][1].data.href, "/notifications");
  account = "another";
  await run("push", { data: { json: () => ({ userId: "owner" }) } });
  account = null;
  await run("push", { data: { json: () => ({ userId: "owner" }) } });
  assert.equal(shown.length, 1);
  await run("notificationclick", {
    notification: { close() {}, data: { href: "https://evil.test" } },
  });
  assert.equal(opened[0], "https://staging.example/notifications");
});
test("permission prompts are click-only; Apple is excluded; nav preference is session-only", async () => {
  const source = await readFile(
    new URL("../components/PushNotifications.tsx", import.meta.url),
    "utf8",
  );
  assert.match(await readFile(new URL("../lib/pushBrowser.ts", import.meta.url), "utf8"), /iPhone\|iPad\|iPod/);
  assert.match(
    source,
    /async function enable\(\)[\s\S]*Notification.requestPermission/,
  );
  const nav = await readFile(
    new URL("../components/PortalNavigation.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(nav, /localStorage\.(getItem|setItem)/);
  assert.match(nav, /localStorage.removeItem/);
  assert.match(nav, /sessionStorage.setItem/);
});
test("both Android variants use delegation and Android 13 permission activity without launch prompts", async () => {
  const gradle = await readFile(
    new URL("../mobile/android/app/build.gradle", import.meta.url),
    "utf8",
  );
  assert.match(gradle, /enableNotifications: true/);
  assert.match(gradle, /customer \{/);
  assert.match(gradle, /worker \{/);
  const manifest = await readFile(
    new URL(
      "../mobile/android/app/src/main/AndroidManifest.xml",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(manifest, /android.permission.POST_NOTIFICATIONS/);
  assert.match(manifest, /NotificationPermissionRequestActivity/);
});
