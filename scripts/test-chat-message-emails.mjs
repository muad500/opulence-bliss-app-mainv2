import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";
const require = createRequire(import.meta.url);
async function load(file, mocks = {}, env = {}) {
  const module = { exports: {} };
  const output = ts.transpileModule(
    await readFile(new URL("../" + file, import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  vm.runInNewContext(
    output,
    {
      module,
      exports: module.exports,
      require: (id) => (id in mocks ? mocks[id] : require(id)),
      process: { env },
      setTimeout: (fn) => fn(),
      URL,
    },
    { filename: file },
  );
  return module.exports;
}
const formatter = await load("lib/chatMessageMail.ts");
const policy = await load("lib/accountSecurityAlerts.ts");
test("delivery rechecks unread/recipient access, preserves idempotency and records retry/cancellation", async () => {
  for (const scenario of [
    "sent",
    "retry",
    "read",
    "staging_blocked",
    "check_error",
  ]) {
    const calls = [],
      sent = [];
    const row = {
      id: "outbox-one",
      claim_token: "lease-one",
      email: "test@example.invalid",
      sender_role: "provider",
      body: "Private test message",
      href: "/account/visit/00000000-0000-4000-8000-000000000001",
    };
    const worker = await load(
      "lib/chatMessageDelivery.ts",
      {
        "server-only": {},
        "@/lib/chatMessageMail": formatter,
        "@/lib/accountSecurityAlerts": policy,
        "@/lib/privateAccountMail": {
          accountMailReady: () => true,
          sendPrivateAccountMail: async (...args) => {
            sent.push(args);
            return scenario !== "retry";
          },
        },
      },
      {
        NEXT_PUBLIC_SITE_URL: "https://www.opulencebliss.com",
        VERCEL_ENV: scenario === "staging_blocked" ? "preview" : "production",
      },
    );
    const admin = {
      rpc: async (name, args) => {
        calls.push({ name, args });
        if (name === "claim_chat_message_emails") return { data: [row] };
        if (name === "chat_message_email_allowed")
          return scenario === "check_error"
            ? { error: {} }
            : { data: scenario !== "read" };
        return { error: null };
      },
    };
    const result = await worker.deliverChatMessageEmails(admin);
    const outcome =
      scenario === "sent"
        ? "sent"
        : ["read", "staging_blocked"].includes(scenario)
          ? "cancelled"
          : "retry";
    assert.equal(calls.at(-1).args.p_outcome, outcome);
    assert.equal(sent.length, ["sent", "retry"].includes(scenario) ? 1 : 0);
    if (sent.length) {
      assert.equal(sent[0][0], row.email);
      assert.equal(sent[0][3], "chat-message:outbox-one");
      assert.ok(sent[0][2].includes(row.body));
    }
    assert.equal(
      result.failed,
      ["retry", "check_error"].includes(scenario) ? 1 : 0,
    );
  }
});
test("unconfigured chat sender leaves all queued work untouched", async () => {
  const worker = await load("lib/chatMessageDelivery.ts", {
    "server-only": {},
    "@/lib/chatMessageMail": formatter,
    "@/lib/accountSecurityAlerts": policy,
    "@/lib/privateAccountMail": { accountMailReady: () => false },
  });
  await assert.rejects(
    worker.deliverChatMessageEmails({
      rpc: () => assert.fail("queue must stay untouched"),
    }),
    /not configured/,
  );
});
