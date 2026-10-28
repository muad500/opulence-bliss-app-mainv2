import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";
const require = createRequire(import.meta.url);
async function load(path, mocks = {}, env = {}) {
  const source = await readFile(new URL("../" + path, import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(
    output,
    {
      module,
      exports: module.exports,
      require: (id) => (id in mocks ? mocks[id] : require(id)),
      process: { env },
      Buffer,
      Date,
      setTimeout: (fn) => fn(),
      console,
    },
    { filename: path },
  );
  return module.exports;
}
const policy = await load("lib/accountSecurityAlerts.ts");
const mfa = await load("lib/staffMfa.ts");

test("admin APIs enforce TOTP before creating the service-role client", async () => {
  for (const fixture of [
    { aal: "aal1", factors: [] },
    { aal: "aal2", factors: [], method: "totp" },
    {
      aal: "aal2",
      factors: [{ factor_type: "totp", status: "unverified" }],
      method: "totp",
    },
    {
      aal: "aal2",
      factors: [{ factor_type: "totp", status: "verified" }],
      method: "phone",
    },
    {
      aal: "aal2",
      factors: [{ factor_type: "totp", status: "verified" }],
      method: "totp",
      pass: true,
    },
  ]) {
    let privileged = 0;
    const client = {
      auth: {
        getUser: async () => ({
          data: { user: { id: "admin", factors: fixture.factors } },
        }),
        getClaims: async () => ({
          data: {
            claims: { aal: fixture.aal, amr: [{ method: fixture.method }] },
          },
        }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { role: "admin" } }),
          }),
        }),
      }),
    };
    const api = await load("lib/adminApi.ts", {
      "server-only": {},
      "@/lib/staffMfa": mfa,
      "@/lib/accountApi": { isSameOriginMutation: () => true },
      "@/lib/supabase/server": { createClient: async () => client },
      "@supabase/supabase-js": {
        createClient: () => {
          privileged++;
          return {};
        },
      },
    });
    const result = await api.adminApi({ method: "GET" });
    assert.equal(privileged, fixture.pass ? 1 : 0);
    if (!fixture.pass) assert.equal(result.status, 403);
  }
});

test("cron rejects missing/wrong credentials before using any privileged services", async () => {
  for (const env of [{}, { CRON_SECRET: "fixture" }]) {
    const route = await load(
      "app/api/cron/account-security-alerts/route.ts",
      {
        "@/lib/accountSecurityDelivery": {
          deliverAccountSecurityAlerts: () =>
            assert.fail("delivery must not run"),
        },
        "@/lib/chatMessageDelivery": {
          deliverChatMessageEmails: () =>
            assert.fail("chat delivery must not run"),
        },
        "@/lib/partnerInterestDelivery": {
          deliverPartnerInterestEmails: () =>
            assert.fail("Partner delivery must not run"),
        },
        "@supabase/supabase-js": {
          createClient: () => assert.fail("client must not be created"),
        },
      },
      env,
    );
    const result = await route.GET({
      headers: new Headers({ authorization: "Bearer invalid" }),
    });
    assert.equal(result.status, 401);
  }
});

test("delivery is generic, uses separate recipient messages and stable idempotency keys", async () => {
  const sent = [],
    saved = [];
  const rows = [
    { id: "one", recipient: "old@example.com", attempts: 1, claim_token: "a" },
    { id: "two", recipient: "new@example.com", attempts: 1, claim_token: "b" },
  ];
  const admin = {
    rpc: async () => ({ data: rows }),
    from: () => {
      let fields;
      const q = {
        update: (value) => {
          fields = value;
          return q;
        },
        in: () => q,
        or: () => q,
        eq: () => q,
        then: (resolve) => {
          saved.push(fields);
          resolve({ error: null });
        },
      };
      return q;
    },
  };
  const worker = await load(
    "lib/accountSecurityDelivery.ts",
    {
      "server-only": {},
      "@/lib/accountSecurityAlerts": policy,
      "@/lib/privateAccountMail": {
        accountMailReady: () => true,
        sendPrivateAccountMail: async (...args) => {
          sent.push(args);
          return true;
        },
      },
    },
    { VERCEL_ENV: "production" },
  );
  assert.equal((await worker.deliverAccountSecurityAlerts(admin)).sent, 2);
  assert.deepEqual(
    sent.map((args) => args[0]),
    ["old@example.com", "new@example.com"],
  );
  assert.ok(sent.every((args) => args[2] === policy.ACCOUNT_CHANGE_MESSAGE));
  assert.deepEqual(
    sent.map((args) => args[3]),
    ["account-security:one", "account-security:two"],
  );
  assert.equal(saved.filter((value) => value.status === "sent").length, 2);
});

test("unconfigured delivery leaves the queue untouched; staging holds non-allowlisted recipients", async () => {
  const noConfig = await load("lib/accountSecurityDelivery.ts", {
    "server-only": {},
    "@/lib/accountSecurityAlerts": policy,
    "@/lib/privateAccountMail": { accountMailReady: () => false },
  });
  await assert.rejects(
    noConfig.deliverAccountSecurityAlerts({
      from: () => assert.fail("queue must remain untouched"),
    }),
    /not configured/,
  );
  const saved = [];
  const worker = await load(
    "lib/accountSecurityDelivery.ts",
    {
      "server-only": {},
      "@/lib/accountSecurityAlerts": policy,
      "@/lib/privateAccountMail": {
        accountMailReady: () => true,
        sendPrivateAccountMail: () =>
          assert.fail("staging cannot mail unrelated recipients"),
      },
    },
    { VERCEL_ENV: "preview" },
  );
  const admin = {
    rpc: async () => ({
      data: [
        {
          id: "a",
          recipient: "unrelated@example.com",
          attempts: 1,
          claim_token: "lease",
        },
      ],
    }),
    from: () => {
      let value;
      const q = {
        update: (v) => {
          value = v;
          return q;
        },
        in: () => q,
        or: () => q,
        eq: () => q,
        then: (resolve) => {
          saved.push(value);
          resolve({ error: null });
        },
      };
      return q;
    },
  };
  assert.equal((await worker.deliverAccountSecurityAlerts(admin)).held, 1);
  assert.equal(saved.at(-1).status, "failed");
});
