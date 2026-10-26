// Execute the real routes with isolated auth/database/mail substitutes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";

class Response {
  constructor(body, status = 200) {
    this.body = body;
    this.status = status;
  }
  static json(body, options = {}) {
    return new Response(body, options.status);
  }
  static redirect(url, status = 307) {
    return new Response({ location: String(url) }, status);
  }
}
const root = process.cwd();
const token = "a".repeat(64);
function runtime(options = {}) {
  const calls = [];
  const user = {
    id: "new-staff",
    app_metadata: { staff_invited_by: "actor" },
    ...options.user,
  };
  const authAdmin = {
    async createUser(input) {
      calls.push(["create", input]);
      return options.createFail ? { error: true } : { data: { user } };
    },
    async getUserById() {
      return { data: { user } };
    },
    async generateLink(input) {
      calls.push(["generate", input]);
      return options.generateFail
        ? { error: true, data: {} }
        : { data: { user, properties: { hashed_token: token } } };
    },
    async updateUserById(id, input) {
      calls.push(["record", id, input]);
      return {};
    },
  };
  const query = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    async maybeSingle() {
      return { data: options.existing ?? null };
    },
    async upsert(input) {
      calls.push(["profile", input]);
      return {};
    },
  };
  const client = {
    auth: {
      async verifyOtp(input) {
        calls.push(["verify", input]);
        return options.badToken ? { error: true } : { data: { user } };
      },
      async signOut() {
        calls.push(["signOut"]);
      },
    },
    from() {
      return {
        ...query,
        async maybeSingle() {
          return {
            data: {
              role: options.redeemRole ?? "admin",
              account_deleted_at: options.deleted ?? null,
            },
          };
        },
      };
    },
  };
  const ctx = {
    user: { id: "actor" },
    admin: { auth: { admin: authAdmin }, from: () => query },
  };
  const mocks = {
    "next/server": { NextResponse: Response },
    "@/lib/adminApi": {
      adminApi: async () =>
        options.denied
          ? Response.json(
              { error: "Complete authenticator sign-in" },
              { status: 403 },
            )
          : ctx,
    },
    "@/lib/privateAccountMail": {
      accountMailReady: () => options.mailReady !== false,
      sendPrivateAccountMail: async (...args) => {
        calls.push(["mail", ...args]);
        return options.mailSent !== false;
      },
    },
    "@/lib/supabase/server": { createClient: async () => client },
  };
  const cache = new Map();
  function load(file) {
    file = resolve(root, file);
    if (cache.has(file)) return cache.get(file).exports;
    const compiledModule = { exports: {} };
    cache.set(file, compiledModule);
    const output = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    vm.runInNewContext(
      output,
      {
        module: compiledModule,
        exports: compiledModule.exports,
        URL,
        Date,
        process: { env: options.env ?? { VERCEL_ENV: "production" } },
        require(id) {
          if (id in mocks) return mocks[id];
          return load(
            (id.startsWith("@/")
              ? resolve(root, id.slice(2))
              : resolve(dirname(file), id)) + ".ts",
          );
        },
      },
      { filename: file },
    );
    return compiledModule.exports;
  }
  const request = {
    url: "https://admin.opulencebliss.com/staff/callback",
    nextUrl: new URL("https://admin.opulencebliss.com/staff/callback"),
    headers: new Map([
      ["origin", options.origin ?? "https://admin.opulencebliss.com"],
    ]),
    json: async () => ({
      email: "hello@opulencebliss.com",
      confirmAdminAccess: true,
      ...options.body,
    }),
    formData: async () => new Map([["token_hash", options.token ?? token]]),
  };
  return { load, calls, request };
}
const api = "app/api/admin/staff-invitations/route.ts";
const callback = "app/staff/callback/route.ts";

test("authenticator guard stops all account, token and email operations", async () => {
  const h = runtime({ denied: true });
  assert.equal((await h.load(api).POST(h.request)).status, 403);
  assert.equal(h.calls.length, 0);
});
for (const body of [
  { confirmAdminAccess: false },
  { email: "bad\naddress@example.com" },
])
  test("invalid or unconfirmed grant cannot create a staff account", async () => {
    const h = runtime({ body });
    assert.equal((await h.load(api).POST(h.request)).status, 400);
    assert.equal(h.calls.length, 0);
  });
test("missing mail configuration fails before granting anything", async () => {
  const h = runtime({ mailReady: false });
  assert.equal((await h.load(api).POST(h.request)).status, 503);
  assert.equal(h.calls.length, 0);
});
test("staging never sends a staff invitation outside its allowlist", async () => {
  const h = runtime({ env: { VERCEL_ENV: "preview" } });
  assert.equal((await h.load(api).POST(h.request)).status, 403);
  assert.equal(h.calls.length, 0);
});
test("broken staging origins fail before account creation", async () => {
  const h = runtime({
    env: {
      VERCEL_ENV: "preview",
      STAGING_EMAIL_RECIPIENTS: "hello@opulencebliss.com",
    },
  });
  assert.equal((await h.load(api).POST(h.request)).status, 503);
  assert.equal(h.calls.length, 0);
});
for (const role of ["customer", "provider"])
  test(`existing ${role} is never promoted`, async () => {
    const h = runtime({
      existing: { id: "existing", role },
      user: { app_metadata: {} },
    });
    assert.equal((await h.load(api).POST(h.request)).status, 409);
    assert.equal(h.calls.length, 0);
  });
test("an active existing administrator is never sent a fresh setup invitation", async () => {
  const h = runtime({
    existing: { id: "existing", role: "admin" },
    user: { last_sign_in_at: "2026-10-20" },
  });
  assert.equal((await h.load(api).POST(h.request)).status, 409);
  assert.equal(h.calls.length, 0);
});
test("new staff uses no agent-set password, branded admin link and no response token", async () => {
  const h = runtime();
  const r = await h.load(api).POST(h.request);
  assert.equal(r.status, 200);
  const create = h.calls.find((x) => x[0] === "create")[1];
  assert.equal(create.password, undefined);
  assert.equal(create.email_confirm, false);
  assert.equal(h.calls.find((x) => x[0] === "profile")[1].role, "admin");
  assert.match(
    h.calls.find((x) => x[0] === "mail")[3],
    /https:\/\/admin\.opulencebliss\.com\/staff\/setup\?token_hash=/,
  );
  assert.equal(JSON.stringify(r.body).includes(token), false);
  assert.equal(
    h.calls.some((x) => x[0].includes("provider")),
    false,
  );
});
test("failed email delivery is reported rather than claimed as sent", async () => {
  const h = runtime({ mailSent: false });
  assert.equal((await h.load(api).POST(h.request)).status, 503);
});
test("existing auth email conflicts stop before profile writes", async () => {
  const h = runtime({ createFail: true });
  assert.equal((await h.load(api).POST(h.request)).status, 409);
  assert.equal(
    h.calls.some((x) => ["profile", "generate", "mail"].includes(x[0])),
    false,
  );
});
test("cross-origin invitation redemption does not consume its credential", async () => {
  const h = runtime({ origin: "https://other.example" });
  await h.load(callback).POST(h.request);
  assert.equal(h.calls.length, 0);
});
test("malformed credentials never reach auth verification", async () => {
  const h = runtime({ token: "bad-token" });
  await h.load(callback).POST(h.request);
  assert.equal(h.calls.length, 0);
});
test("redeeming a customer token cannot open staff pages", async () => {
  const h = runtime({ redeemRole: "customer" });
  const r = await h.load(callback).POST(h.request);
  assert.equal(
    r.body.location,
    "https://admin.opulencebliss.com/staff/login?error=recovery",
  );
  assert.ok(h.calls.some((x) => x[0] === "signOut"));
});
test("valid invite still enters the existing authenticator/password setup gate", async () => {
  const h = runtime();
  const r = await h.load(callback).POST(h.request);
  assert.equal(
    r.body.location,
    "https://admin.opulencebliss.com/staff/update-password",
  );
  assert.equal(h.calls[0][1].type, "invite");
});
test("email scans do not redeem the token and password setup keeps its TOTP gate", () => {
  const page = readFileSync("app/staff/setup/page.tsx", "utf8");
  assert.match(page, /method="post"/);
  assert.doesNotMatch(page, /verifyOtp/);
  assert.match(
    readFileSync("app/staff/update-password/page.tsx", "utf8"),
    /hasStaffTotpSession/,
  );
});
