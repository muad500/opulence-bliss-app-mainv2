import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import net from "node:net";
import ts from "typescript";
function fixture() {
  let now = Date.now();
  class TestDate extends Date {
    static now() {
      return now;
    }
  }
  const compiledModule = { exports: {} };
  const env = {
    VERCEL: "1",
    SUPABASE_SERVICE_ROLE_KEY:
      "isolated-test-signing-credential-not-an-API-key",
  };
  const code = ts.transpileModule(
    readFileSync("lib/accountAcceptanceServer.ts", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const context = vm.createContext({
    module: compiledModule,
    exports: compiledModule.exports,
    Buffer,
    Headers,
    Date: TestDate,
    process: { env },
    require: (id) =>
      id === "./finalLegalPack"
        ? { finalLegalDocument: () => null }
        : id === "server-only"
          ? {}
          : id === "node:crypto"
            ? crypto
            : id === "node:net"
              ? net
              : id === "./bookingLegalEvidence"
                ? {
                    legalContentHash: (text) =>
                      crypto.createHash("md5").update(text).digest("hex"),
                  }
                : id === "./legalDocuments"
                  ? {
                      defaultLegalDocument: (slug) => ({
                        title: slug,
                        version: "fallback",
                        contentHtml: "<p>Fallback " + slug + "</p>",
                      }),
                      publicLegalPresentation: (title, contentHtml) => ({
                        title,
                        contentHtml,
                      }),
                    }
                  : (() => {
                      throw Error(id);
                    })(),
  });
  new vm.Script(code).runInContext(context);
  const writes = [];
  const client = {
    rpc: async () => ({ data: true, error: null }),
    from: () => ({
      select() {
        return this;
      },
      in() {
        return this;
      },
      eq: async () => ({
        data: [
          {
            slug: "terms",
            title: "Terms",
            version: "v2",
            content_html: "<p>Published wording</p>",
          },
        ],
        error: null,
      }),
      upsert: async (rows, options) => {
        writes.push({ rows, options });
        return { error: null };
      },
    }),
  };
  return {
    ...compiledModule.exports,
    client,
    writes,
    env,
    advance: () => {
      now += 31 * 60_000;
    },
  };
}
test("account evidence uses trusted request IP, exact checked text and published document snapshots", async () => {
  const f = fixture();
  const h = new Headers({
    "x-vercel-forwarded-for": "203.0.113.27, 192.0.2.1",
    "x-forwarded-for": "198.51.100.44",
    "user-agent": "Fixture browser",
  });
  const prepared = await f.prepareAccountAcceptance(
    f.client,
    ["terms", "privacy"],
    h,
    [
      {
        key: "account_policies",
        text: "Exact visible checkbox wording.",
        checked: true,
      },
    ],
  );
  assert.equal(prepared.request.ip, "203.0.113.27");
  assert.equal(prepared.checkboxes[0].text, "Exact visible checkbox wording.");
  assert.equal(
    prepared.documents[0].sourceContentHtml,
    "<p>Published wording</p>",
  );
  assert.equal(prepared.documents[0].version, "v2");
  assert.equal(prepared.documents[1].version, "fallback");
  await f.saveAccountAcceptance(f.client, "fixture", prepared);
  assert.equal(f.writes[0].options.ignoreDuplicates, true);
  assert.equal(
    f.writes[0].rows[0].acceptance_evidence.request.ip,
    "203.0.113.27",
  );
  assert.equal(
    f.writes[0].rows[0].acceptance_evidence.document.contentHash,
    crypto.createHash("md5").update("<p>Published wording</p>").digest("hex"),
  );
  assert.ok(f.writes[0].rows[0].accepted_at);
});
test("untrusted forwarding headers never invent an account IP", async () => {
  const f = fixture();
  f.env.VERCEL = "0";
  const p = await f.prepareAccountAcceptance(
    f.client,
    ["terms"],
    new Headers({ "x-vercel-forwarded-for": "203.0.113.27" }),
    [],
  );
  assert.equal(p.request.ip, null);
});
test("Google acceptance cookie is signed, expires, and distinguishes a button from a ticked box", async () => {
  const f = fixture();
  const p = await f.prepareAccountAcceptance(
    f.client,
    ["terms"],
    new Headers(),
    [],
    {
      kind: "button",
      text: "Continue with Google",
      wording: "The visible agreement.",
    },
  );
  const cookie = f.signOAuthAcceptance(p);
  const read = f.readOAuthAcceptance(cookie);
  assert.equal(read.action.kind, "button");
  assert.equal(read.checkboxes.length, 0);
  assert.equal(read.documents[0].contentHash, p.documents[0].contentHash);
  assert.equal(read.acceptedAt, p.acceptedAt);
  assert.equal(f.readOAuthAcceptance("tampered" + cookie), null);
  assert.equal(f.readOAuthAcceptance(cookie + ".extra"), null);
  f.advance();
  assert.equal(f.readOAuthAcceptance(cookie), null);
});
test("signup fails closed before account creation if the evidence migration is unavailable", async () => {
  const f = fixture();
  f.client.rpc = async () => ({ data: null, error: { message: "missing" } });
  await assert.rejects(
    f.prepareAccountAcceptance(f.client, ["terms"], new Headers(), []),
    /being updated/,
  );
});

function oauthRoute({ sameOrigin = true, ready = true } = {}) {
  const f = fixture();
  if (!ready) f.client.rpc = async () => ({ data: false });
  const compiledModule = { exports: {} };
  const code = ts.transpileModule(
    readFileSync("app/api/oauth-acceptance/route.ts", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const context = vm.createContext({
    module: compiledModule,
    exports: compiledModule.exports,
    require: (id) => {
      if (id === "next/server")
        return {
          NextResponse: {
            json: (body, options = {}) => {
              const result = {
                body,
                status: options.status || 200,
                cookie: null,
              };
              result.cookies = {
                set: (name, value, flags) => {
                  result.cookie = { name, value, flags };
                },
              };
              return result;
            },
          },
        };
      if (id === "@/lib/supabase/server")
        return { createClient: async () => f.client };
      if (id === "@/lib/accountApi")
        return { isSameOriginMutation: () => sameOrigin };
      if (id === "@/lib/accountAcceptanceServer") return f;
      if (id === "@/lib/accountAcceptanceCopy")
        return {
          CUSTOMER_SIGNUP_ACCEPTANCE: "Exact signup text",
          GOOGLE_LOGIN_ACCEPTANCE: "Exact login text",
        };
      throw Error(id);
    },
  });
  new vm.Script(code).runInContext(context);
  return {
    ...f,
    post: (body) =>
      compiledModule.exports.POST({
        headers: new Headers(),
        nextUrl: new URL("https://staging.example.test/api/oauth-acceptance"),
        json: async () => body,
      }),
  };
}

test("OAuth preparation rejects cross-site requests and unchecked signup without a cookie", async () => {
  const crossSite = await oauthRoute({ sameOrigin: false }).post({
    source: "login",
  });
  assert.equal(crossSite.status, 403);
  assert.equal(crossSite.cookie, null);
  const unchecked = await oauthRoute().post({
    source: "signup",
    accepted: false,
  });
  assert.equal(unchecked.status, 400);
  assert.equal(unchecked.cookie, null);
});

test("OAuth acceptance uses a secure temporary HttpOnly cookie with exact checkbox evidence", async () => {
  const f = oauthRoute();
  const response = await f.post({ source: "signup", accepted: true });
  assert.equal(response.status, 200);
  assert.equal(response.cookie.flags.httpOnly, true);
  assert.equal(response.cookie.flags.secure, true);
  assert.equal(response.cookie.flags.sameSite, "lax");
  assert.equal(response.cookie.flags.path, "/auth/callback");
  assert.equal(response.cookie.flags.maxAge, 1800);
  const accepted = f.readOAuthAcceptance(response.cookie.value);
  assert.equal(accepted.checkboxes[0].text, "Exact signup text");
  assert.equal(accepted.checkboxes[0].checked, true);
});

test("OAuth login records a button action rather than fabricating a ticked signup box", async () => {
  const f = oauthRoute();
  const response = await f.post({ source: "login" });
  assert.equal(response.status, 200);
  const accepted = f.readOAuthAcceptance(response.cookie.value);
  assert.equal(accepted.checkboxes.length, 0);
  assert.equal(accepted.action.wording, "Exact login text");
});

test("OAuth recording outage returns a retryable error and never starts consent", async () => {
  const response = await oauthRoute({ ready: false }).post({ source: "login" });
  assert.equal(response.status, 503);
  assert.equal(response.cookie, null);
});

async function callbackFixture({
  alreadyAccepted = false,
  cookie = true,
  changed = false,
  unavailable = false,
} = {}) {
  const f = fixture();
  const pending = await f.prepareAccountAcceptance(
    f.client,
    ["terms", "privacy", "cancellation-refund"],
    new Headers({ "x-vercel-forwarded-for": "203.0.113.27" }),
    [{ key: "account_policies", text: "Visible wording", checked: true }],
  );
  if (changed) pending.documents[0].version = "older-version";
  const value = cookie ? f.signOAuthAcceptance(pending) : undefined;
  const effects = { signedOut: 0, metadataUpdates: 0, legacyConsents: 0 };
  const admin = {
    ...f.client,
    from: (table) =>
      table === "profiles"
        ? {
            select() {
              return this;
            },
            eq() {
              return this;
            },
            maybeSingle: async () => ({
              data: { role: "customer", phone: "fictional" },
            }),
          }
        : f.client.from(table),
    rpc: async (name) =>
      name === "record_oauth_signup_consent"
        ? (effects.legacyConsents++, { error: null })
        : unavailable
          ? { error: { message: "outage" } }
          : f.client.rpc(name),
    auth: {
      admin: {
        updateUserById: async () => {
          effects.metadataUpdates++;
          return { error: null };
        },
      },
    },
  };
  const session = {
    auth: {
      exchangeCodeForSession: async () => ({ error: null }),
      getUser: async () => ({
        data: {
          user: {
            id: "fictional",
            email: "fixture@example.test",
            user_metadata: { legal_accepted: alreadyAccepted },
          },
        },
      }),
      signOut: async () => {
        effects.signedOut++;
      },
    },
  };
  const compiledModule = { exports: {} };
  const code = ts.transpileModule(
    readFileSync("app/auth/callback/route.ts", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const context = vm.createContext({
    module: compiledModule,
    exports: compiledModule.exports,
    URL,
    process: { env: {} },
    require: (id) => {
      if (id === "next/server")
        return {
          NextResponse: {
            redirect: (url) => ({
              destination: url.href,
              cookies: { set() {} },
            }),
          },
        };
      if (id === "@supabase/supabase-js") return { createClient: () => admin };
      if (id === "@/lib/supabase/server")
        return { createClient: async () => session };
      if (id === "@/lib/accountAcceptanceServer") return f;
      if (id === "@/lib/professionalAccess")
        return { canUseProfessionalTools: () => false };
      if (id === "@/lib/authReturn") return { safeAuthNext: (value) => value };
      throw Error(id);
    },
  });
  new vm.Script(code).runInContext(context);
  const response = await compiledModule.exports.GET({
    url: "https://staging.example.test/auth/callback?code=fictional&next=/book",
    headers: new Headers({ "x-vercel-forwarded-for": "198.51.100.9" }),
    cookies: { get: () => (value ? { value } : undefined) },
  });
  return { f, effects, pending, response };
}

test("existing accepted Google users keep signing in without rewriting their original acceptance", async () => {
  const result = await callbackFixture({
    alreadyAccepted: true,
    cookie: false,
    unavailable: true,
  });
  assert.equal(
    result.response.destination,
    "https://staging.example.test/book",
  );
  assert.equal(result.effects.signedOut, 0);
  assert.equal(result.f.writes.length, 0);
});

test("new Google consent preserves the original acceptance IP and time, not the later callback", async () => {
  const result = await callbackFixture();
  assert.equal(
    result.response.destination,
    "https://staging.example.test/book",
  );
  assert.equal(
    result.f.writes[0].rows[0].acceptance_evidence.request.ip,
    "203.0.113.27",
  );
  assert.equal(
    result.f.writes[0].rows[0].accepted_at,
    result.pending.acceptedAt,
  );
  assert.equal(result.effects.legacyConsents, 1);
  assert.equal(result.effects.metadataUpdates, 1);
});

test("missing, changed or unavailable Google acceptance fails closed without changing acceptance metadata", async () => {
  for (const options of [
    { cookie: false },
    { changed: true },
    { unavailable: true },
  ]) {
    const result = await callbackFixture(options);
    assert.equal(result.effects.signedOut, 1);
    assert.equal(result.effects.metadataUpdates, 0);
    assert.equal(result.f.writes.length, 0);
    assert.match(
      result.response.destination,
      /error=(consent|policies-changed)/,
    );
  }
});
