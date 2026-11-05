import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
const require = createRequire(import.meta.url);
function fixture(options = {}) {
  const calls = [],
    messages = [];
  const env = {
    VERCEL_ENV: "preview",
    CLEANER_STAGE2_ENABLED: "true",
    NEXT_PUBLIC_SUPABASE_URL: "https://comwdjprdedmsnxtvuuk.supabase.co",
    ACCOUNT_EMAIL_FROM: "Opulence Bliss Staging <staging@opulencebliss.com>",
    STAGING_EMAIL_RECIPIENTS: "test@example.invalid",
    ...options.env,
  };
  function load(file) {
    const mod = { exports: {} };
    vm.runInNewContext(
      ts.transpileModule(readFileSync(file, "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText,
      {
        module: mod,
        exports: mod.exports,
        process: { env },
        URL,
        require(name) {
          if (name === "server-only") return {};
          if (name === "./privateAccountMail")
            return {
              accountMailReady: () => options.ready !== false,
              sendPrivateAccountMail: async (...args) => {
                messages.push(args);
                return options.delivered !== false;
              },
            };
          if (name === "./ukPhone") return {};
          if (name.startsWith("./")) return load(`lib/${name.slice(2)}.ts`);
          return require(name);
        },
      },
    );
    return mod.exports;
  }
  const module = load("lib/cleanerAssessmentDelivery.ts");
  return {
    calls,
    messages,
    copy: load("lib/cleanerAssessmentPolicy.ts").CLEANER_ASSESSMENT_COPY,
    send: () =>
      module.deliverCleanerAssessmentDecisions({
        rpc: async (name, params) => {
          calls.push([name, params]);
          return name === "claim_cleaner_assessment_emails"
            ? {
                data: [
                  {
                    id: "TEST-mail-id",
                    claim_token: "TEST-claim",
                    copy_version: "1.0",
                    email: options.recipient ?? "test@example.invalid",
                  },
                ],
              }
            : { data: !options.finishFail };
        },
      }),
  };
}
test("assessment mail fails closed for Production, wrong project, wrong sender or missing recipient approval", async () => {
  for (const env of [
    { VERCEL_ENV: "production" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://uiqcsihgqaktpjumyeap.supabase.co" },
    { ACCOUNT_EMAIL_FROM: "Opulence Bliss <hello@opulencebliss.com>" },
    { ACCOUNT_EMAIL_FROM: "not-staging@opulencebliss.com" },
    { STAGING_EMAIL_RECIPIENTS: "" },
  ]) {
    const f = fixture({ env });
    assert.equal((await f.send()).configured, false);
    assert.equal(f.calls.length, 0);
    assert.equal(f.messages.length, 0);
  }
});
test("approved decision uses exact supplied copy and a stable provider idempotency key", async () => {
  const f = fixture();
  const result = await f.send();
  assert.equal(result.sent, 1);
  assert.deepEqual(f.messages[0], [
    "test@example.invalid",
    f.copy.failedEmailSubject,
    `${f.copy.notPassed}\n\n${f.copy.review}`,
    "cleaner-assessment-decision:TEST-mail-id",
  ]);
  assert.equal(f.calls[1][1].p_sent, true);
  assert.doesNotMatch(JSON.stringify(result), /example\.invalid|TEST-claim/);
});
test("unexpected recipient or unconfirmed send is not recorded as delivered", async () => {
  const outside = fixture({ recipient: "not-approved@example.invalid" });
  assert.equal((await outside.send()).failed, 1);
  assert.equal(outside.messages.length, 0);
  const uncertain = fixture({ delivered: false });
  assert.equal((await uncertain.send()).sent, 0);
  assert.equal(uncertain.calls[1][1].p_sent, false);
});
test("email result must be durably recorded before reporting success", async () => {
  const f = fixture({ finishFail: true });
  await assert.rejects(f.send(), /not recorded/);
});
