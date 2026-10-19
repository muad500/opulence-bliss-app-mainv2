import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import { createBrowserClient, createServerClient } from "@supabase/ssr";
const exports = {};
vm.runInNewContext(
  ts.transpileModule(
    await readFile(
      new URL("../lib/supabase/sessionOptions.ts", import.meta.url),
      "utf8",
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText,
  { exports, URL },
);
const { supabaseSessionOptions } = exports;
const originalUrl = "https://uiqcsihgqaktpjumyeap.supabase.co";
const customUrl = "https://auth.opulencebliss.com";
const stagingUrl = "https://comwdjprdedmsnxtvuuk.supabase.co";
const projectCookie = "sb-uiqcsihgqaktpjumyeap-auth-token";
const user = {
  id: "00000000-0000-4000-8000-000000000001",
  aud: "authenticated",
  role: "authenticated",
  email: "session-fixture@example.invalid",
  app_metadata: {},
  user_metadata: { bio: "x".repeat(9000) },
  created_at: "2026-01-01T00:00:00Z",
};
const jwt = (url) =>
  [
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
      "base64url",
    ),
    Buffer.from(
      JSON.stringify({
        sub: user.id,
        aud: "authenticated",
        role: "authenticated",
        iss: url + "/auth/v1",
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      }),
    ).toString("base64url"),
    Buffer.from("fixture-signature-not-a-real-token").toString("base64url"),
  ].join(".");
const requests = [];
const fakeFetch = async (input, options) => {
  const url = String(input);
  requests.push({ url, method: options?.method ?? "GET" });
  let body = user;
  if (url.includes("/token"))
    body = {
      access_token: jwt(customUrl),
      refresh_token: "fixture-refresh-token",
      expires_in: 3600,
      token_type: "bearer",
      user,
    };
  if (url.includes("/recover")) body = {};
  if (url.includes("/signup")) body = { user, session: null };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
function jar() {
  const values = new Map();
  return {
    values,
    cookies: {
      getAll: () => [...values].map(([name, value]) => ({ name, value })),
      setAll: (items) => {
        for (const x of items) {
          if (x.options?.maxAge === 0) values.delete(x.name);
          else values.set(x.name, x.value);
        }
      },
    },
  };
}
function browser(url, store, configured = true) {
  const config = configured ? supabaseSessionOptions(url) : {};
  return createBrowserClient(url, "fixture-public-key", {
    ...config,
    cookies: store.cookies,
    isSingleton: false,
    auth: {
      ...config.auth,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { fetch: fakeFetch },
  });
}
test("Production custom domain keeps the original explicit storage and cookie names; staging stays separate", () => {
  assert.equal(
    supabaseSessionOptions(originalUrl).cookieOptions.name,
    projectCookie,
  );
  assert.equal(
    supabaseSessionOptions(customUrl).cookieOptions.name,
    projectCookie,
  );
  assert.equal(
    supabaseSessionOptions(customUrl).auth.storageKey,
    projectCookie,
  );
  assert.equal(
    supabaseSessionOptions(stagingUrl).cookieOptions.name,
    "sb-comwdjprdedmsnxtvuuk-auth-token",
  );
  assert.throws(() => supabaseSessionOptions("https://wrong.example.com"));
});
test("a session created by the old default SDK survives browser/server migration, chunked cookies and refresh", async () => {
  const store = jar();
  const old = browser(originalUrl, store, false);
  assert.equal(
    (
      await old.auth.setSession({
        access_token: jwt(originalUrl),
        refresh_token: "fixture-refresh-token",
      })
    ).error,
    null,
  );
  assert.ok(store.values.has(projectCookie + ".0"));
  const current = browser(customUrl, store);
  assert.equal(
    (await current.auth.getSession()).data.session?.user.id,
    user.id,
  );
  const server = createServerClient(customUrl, "fixture-public-key", {
    ...supabaseSessionOptions(customUrl),
    cookies: store.cookies,
    global: { fetch: fakeFetch },
  });
  assert.equal((await server.auth.getUser()).data.user?.id, user.id);
  assert.equal(
    (await current.auth.refreshSession()).data.session?.user.id,
    user.id,
  );
  assert.ok(
    [...store.values.keys()].every((name) => name.startsWith(projectCookie)),
  );
  assert.ok(
    ![...store.values.keys()].some((name) =>
      name.startsWith("sb-auth-auth-token"),
    ),
  );
});
test("Google PKCE, signup and password-recovery requests use the custom auth domain and original verifier name", async () => {
  const store = jar(),
    client = browser(customUrl, store);
  const oauth = await client.auth.signInWithOAuth({
    provider: "google",
    options: {
      skipBrowserRedirect: true,
      redirectTo: "https://www.opulencebliss.com/auth/callback",
    },
  });
  assert.equal(new URL(oauth.data.url).origin, customUrl);
  assert.ok(store.values.has(projectCookie + "-code-verifier"));
  assert.equal(
    (
      await client.auth.resetPasswordForEmail(
        "session-fixture@example.invalid",
        { redirectTo: "https://www.opulencebliss.com/auth/update-password" },
      )
    ).error,
    null,
  );
  assert.equal(
    (
      await client.auth.signUp({
        email: "session-fixture@example.invalid",
        password: "fixture-not-a-real-password",
      })
    ).error,
    null,
  );
  assert.ok(
    requests.some((x) => x.url.startsWith(customUrl + "/auth/v1/recover")),
  );
  assert.ok(
    requests.some((x) => x.url.startsWith(customUrl + "/auth/v1/signup")),
  );
});
test("staging default cookies remain readable after explicitly pinning the staging storage name", async () => {
  const store = jar(),
    old = browser(stagingUrl, store, false);
  await old.auth.setSession({
    access_token: jwt(stagingUrl),
    refresh_token: "fixture-refresh-token",
  });
  const updated = browser(stagingUrl, store);
  assert.equal(
    (await updated.auth.getSession()).data.session?.user.id,
    user.id,
  );
  assert.ok(
    [...store.values.keys()].every((name) =>
      name.startsWith("sb-comwdjprdedmsnxtvuuk-auth-token"),
    ),
  );
});
