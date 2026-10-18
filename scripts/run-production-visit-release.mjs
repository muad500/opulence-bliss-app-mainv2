// Default is an OFFLINE plan. Never execute before the user's explicit "merge".
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import Stripe from "stripe";

const folder = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(folder, "manifest.json");
if (!existsSync(manifestPath))
  throw new Error(
    "Run the offline release preparer first; execute the generated package's run.mjs.",
  );
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const read = (name) => readFileSync(resolve(folder, name), "utf8");
for (const [name, sha] of Object.entries(manifest.files)) {
  assert.equal(
    createHash("sha256")
      .update(readFileSync(resolve(folder, name)))
      .digest("hex"),
    sha,
    "Package integrity failed: " + name,
  );
}
if (!process.argv.includes("--execute")) {
  console.log(
    JSON.stringify(
      {
        preparedOnly: true,
        productionChanged: false,
        migrations: manifest.migrations.map((m) => m.version),
        baseMain: manifest.baseMain,
        stagingCommit: manifest.stagingCommit,
        sequence: [
          "preflight",
          "exact-source migrations",
          "live webhook subscriptions",
          "worker + protected scheduler",
          "two successful automatic runs",
          "approved web patch and deploy",
          "read-only smoke checks",
        ],
        heldLegalMigration: manifest.heldLegalMigration,
        marketplace: "off",
        cleanerPay:
          "GBP 15 per booked base cleaning hour; new-booking snapshot",
        extras: "retained by business",
        tips: "full amount to assigned cleaner",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
assert.equal(
  process.env.RELEASE_AUTHORIZATION,
  "merge",
  "Execution requires the user's explicit merge approval and RELEASE_AUTHORIZATION=merge.",
);
const env = process.env;
function required(name) {
  assert.ok(env[name], "Missing secure release input: " + name);
  return env[name];
}
// No Vercel environment is read or pulled by this runner.
assert.equal(
  required("STAGING_EMAIL_TEST_PASSED"),
  "yes",
  "Real staging email delivery must pass first.",
);
assert.equal(
  required("PRODUCTION_WEB_ENV_READY"),
  "yes",
  "Separately verify Production's own credentials, per-visit flag, and marketplace OFF before execution.",
);
const root = resolve(required("RELEASE_REPOSITORY"));
const apiToken = required("SUPABASE_ACCESS_TOKEN");
const stripeKey = required("PRODUCTION_STRIPE_SECRET_KEY");
assert.ok(
  stripeKey.startsWith("sk_live_"),
  "A live Production key is required.",
);
const anon = required("PRODUCTION_SUPABASE_ANON_KEY");
const claims = JSON.parse(Buffer.from(anon.split(".")[1], "base64url"));
assert.equal(claims.ref, manifest.productionProject);
assert.equal(claims.role, "anon");
const cronSecret = required("PRODUCTION_VISIT_PAYMENTS_CRON_SECRET");
assert.ok(cronSecret.length >= 32);
const resendKey = required("PRODUCTION_RESEND_API_KEY");
const sender = required("PRODUCTION_BOOKING_EMAIL_FROM");
assert.match(sender, /@opulencebliss\.com>?$/);
const origin = required("PRODUCTION_SITE_URL");
assert.ok(
  ["https://www.opulencebliss.com", "https://opulencebliss.com"].includes(
    origin,
  ),
);
const endpointId = required("PRODUCTION_STRIPE_WEBHOOK_ID");
const stripe = new Stripe(stripeKey, { maxNetworkRetries: 1 });
const git = (...args) =>
  execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  }).trim();
const run = (command, args, cwd = root, extraEnv = {}) =>
  execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...env, ...extraEnv },
    maxBuffer: 24 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
async function management(path, body, method = "POST") {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${manifest.productionProject}${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
  if (!response.ok)
    throw new Error(
      `Supabase release step failed (${response.status}); inspect privately. No credentials are logged.`,
    );
  return response.status === 204 ? null : response.json();
}
const query = (sql) => management("/database/query", { query: sql });
const quote = (s) => "'" + s.replaceAll("'", "''") + "'";

try {
  assert.equal(
    git("rev-parse", "HEAD"),
    manifest.stagingCommit,
    "Use the exact reviewed staging checkout.",
  );
  assert.equal(
    createHash("sha256")
      .update(
        readFileSync(
          resolve(root, "supabase/functions/visit-payments/index.ts"),
        ),
      )
      .digest("hex"),
    manifest.files["worker.ts"],
  );
  assert.equal(
    git("ls-remote", "origin", "refs/heads/main").split(/\s/)[0],
    manifest.baseMain,
    "main changed; regenerate/review the package.",
  );
  assert.equal(
    (await stripe.accounts.retrieveCurrent()).id,
    manifest.stripeAccount,
  );
  const endpoint = await stripe.webhookEndpoints.retrieve(endpointId);
  assert.equal(endpoint.livemode, true);
  assert.equal(endpoint.status, "enabled");
  const endpointUrl = new URL(endpoint.url);
  assert.ok(
    [origin, "https://opulence-bliss-app-mainv2.vercel.app"].includes(
      endpointUrl.origin,
    ),
  );
  assert.equal(endpointUrl.pathname, "/api/stripe/webhook");
  const evidence = await stripe.events.retrieve(
    required("LIVE_WEBHOOK_VERIFIED_EVENT_ID"),
  );
  assert.equal(evidence.livemode, true);
  assert.equal(
    evidence.pending_webhooks,
    0,
    "Resolve failed live deliveries before release.",
  );
  assert.ok(
    evidence.created > Date.now() / 1000 - 86400,
    "Live delivery evidence must be recent.",
  );
  // Stripe's event object does not prove a particular endpoint attempt. The
  // operator must additionally verify that endpoint's Workbench HTTP 200.
  assert.equal(required("LIVE_ENDPOINT_HTTP_200_VERIFIED"), endpointId);
  const pending = await stripe.events.list({
    limit: 100,
    delivery_success: false,
  });
  assert.equal(
    pending.data.length,
    0,
    "Unresolved Stripe deliveries block release; inspect them privately.",
  );
  const preflightLedger = await query(read("00-ledger-preflight.sql"));
  assert.equal(preflightLedger.length, manifest.migrationCount);
  for (const m of manifest.migrations) {
    const row = preflightLedger.find((r) => r.version === m.version);
    assert.ok(row, "Missing expected ledger-check row: " + m.version);
    assert.ok(
      !row.recorded || row.source_matches,
      "Migration source differs; reconcile before release: " + m.version,
    );
  }
  console.log(
    "Preflight passed. Applying the exact reviewed migration sources.",
  );
  await query(read("01-migrations.sql"));
  const ledger = await query(read("00-ledger-preflight.sql"));
  assert.equal(ledger.length, manifest.migrationCount);
  for (const m of manifest.migrations)
    assert.equal(
      ledger.find((r) => r.version === m.version)?.source_md5,
      m.md5,
    );
  for (const row of ledger) {
    assert.equal(row.recorded, true);
    assert.equal(row.source_matches, true);
    assert.equal(row.ledger_status, "matched");
  }
  const additions = JSON.parse(read("live-webhook-events.json"));
  const enabledEvents = endpoint.enabled_events.includes("*")
    ? ["*"]
    : [...new Set([...endpoint.enabled_events, ...additions])];
  await stripe.webhookEndpoints.update(endpointId, {
    enabled_events: enabledEvents,
  });
  const actual = await stripe.webhookEndpoints.retrieve(endpointId);
  for (const event of additions)
    assert.ok(
      actual.enabled_events.includes("*") ||
        actual.enabled_events.includes(event),
    );
  // Values go directly to the official secret store, never to an output file.
  await management(
    "/secrets",
    [
      ["VISIT_PAYMENTS_MODE", "production"],
      ["VISIT_PAYMENTS_ENABLED", "true"],
      ["VISIT_PAYMENTS_CRON_SECRET", cronSecret],
      ["VISIT_PAYMENTS_STRIPE_SECRET_KEY", stripeKey],
      ["RESEND_API_KEY", resendKey],
      ["BOOKING_EMAIL_FROM", sender],
      ["NEXT_PUBLIC_SITE_URL", origin],
      ["BOOKING_SMS_ENABLED", "false"],
    ].map(([name, value]) => ({ name, value })),
  );
  const vault = [
    ["opulence_production_visit_payments_secret", cronSecret],
    ["opulence_production_function_anon", anon],
  ];
  for (const [name, value] of vault)
    await query(
      `do $vault$ declare secret_id uuid; begin select id into secret_id from vault.secrets where name = ${quote(name)}; if secret_id is null then perform vault.create_secret(${quote(value)}, ${quote(name)}); else perform vault.update_secret(secret_id, ${quote(value)}); end if; end; $vault$;`,
    );
  run(required("SUPABASE_CLI"), [
    "functions",
    "deploy",
    "visit-payments",
    "--project-ref",
    manifest.productionProject,
    "--use-api",
  ]);
  const functionInfo = await management(
    "/functions/visit-payments",
    undefined,
    "GET",
  );
  assert.equal(
    functionInfo.verify_jwt,
    true,
    "Gateway verification must remain enabled.",
  );
  await query(read("02-scheduler.sql"));
  const started = new Date().toISOString();
  let ready = false;
  for (let i = 0; i < 32; i++) {
    const rows = await query(
      `select count(*) as successful_runs from net._http_response where created >= ${quote(started)}::timestamptz and status_code = 200 and content::jsonb ->> 'mode' = 'production' and content::jsonb ->> 'source' = ${quote(manifest.workerSource)}`,
    );
    if (Number(rows[0]?.successful_runs) >= 2) {
      ready = true;
      break;
    }
    console.log(
      "Waiting for two ordinary five-minute Production scheduler runs.",
    );
    await delay(30_000);
  }
  assert.ok(
    ready,
    "Two successful automatic scheduler runs were not observed; do not merge.",
  );
  const health = await query(
    "select public.per_visit_checkout_ready() as ready, last_scheduler_at > now() - interval '10 minutes' as fresh from public.visit_billing_runtime",
  );
  assert.ok(
    health[0]?.ready && health[0]?.fresh,
    "Scheduler is not fresh; do not merge.",
  );
  // Publish an exact production projection, omitting all staging-only routes,
  // fixtures and schedules. Never blindly merge the entire staging branch.
  git("fetch", "origin", "main");
  assert.equal(git("rev-parse", "origin/main"), manifest.baseMain);
  const checkout = resolve(
    root,
    "..",
    `production-visit-release-${Date.now()}`,
  );
  git("worktree", "add", "--detach", checkout, manifest.baseMain);
  run(
    "git",
    ["apply", "--check", resolve(folder, "web-release.patch")],
    checkout,
  );
  run("git", ["apply", resolve(folder, "web-release.patch")], checkout);
  const npm = (args, extraEnv = {}) =>
    process.platform === "win32"
      ? run(
          env.ComSpec ?? "cmd.exe",
          ["/d", "/s", "/c", "npm " + args.join(" ")],
          checkout,
          extraEnv,
        )
      : run("npm", args, checkout, extraEnv);
  npm(["ci", "--ignore-scripts"]);
  npm(["test"]);
  const serviceKey = required("PRODUCTION_SUPABASE_SERVICE_ROLE_KEY");
  const serviceClaims = JSON.parse(
    Buffer.from(serviceKey.split(".")[1], "base64url"),
  );
  assert.equal(serviceClaims.ref, manifest.productionProject);
  assert.equal(serviceClaims.role, "service_role");
  const marker = {
    source: manifest.stagingCommit,
    patch: manifest.files["web-release.patch"],
    marketplace: "off",
  };
  mkdirSync(resolve(checkout, "public/.well-known"), { recursive: true });
  writeFileSync(
    resolve(checkout, "public/.well-known/visit-billing-release.json"),
    JSON.stringify(marker) + "\n",
  );
  npm(["run", "build"], {
    NEXT_PUBLIC_SUPABASE_URL: `https://${manifest.productionProject}.supabase.co`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
    SUPABASE_SERVICE_ROLE_KEY: serviceKey,
    STRIPE_SECRET_KEY: stripeKey,
    CLEANING_PAY_PER_VISIT_ENABLED: "true",
    HANDYMAN_MARKETPLACE_ENABLED: "false",
  });
  run("git", ["add", "--all"], checkout);
  run(
    "git",
    ["commit", "-m", "Release reviewed per-visit booking and matching changes"],
    checkout,
  );
  const commit = run("git", ["rev-parse", "HEAD"], checkout).trim();
  run("git", ["push", "origin", "HEAD:refs/heads/main"], checkout);
  let deployed = false;
  for (let i = 0; i < 40; i++) {
    const released = await fetch(
      origin + "/.well-known/visit-billing-release.json",
      { cache: "no-store" },
    );
    if (released.ok && (await released.json()).patch === marker.patch) {
      deployed = true;
      break;
    }
    await delay(15_000);
  }
  assert.ok(
    deployed,
    "Production deployment did not become ready; inspect Vercel without retrying money operations.",
  );
  assert.equal(
    (await (await fetch(origin + "/api/visit-billing-config")).json())
      .perVisitBilling,
    true,
  );
  const marketplace = await fetch(origin + "/api/handyman/config");
  assert.equal((await marketplace.json()).enabled, false);
  for (const path of ["/", "/book", "/worker"]) {
    const response = await fetch(origin + path, { redirect: "manual" });
    assert.ok(
      [200, 301, 302, 303, 307, 308].includes(response.status),
      "Page smoke failed: " + path,
    );
  }
  assert.equal(
    (
      await fetch(origin + "/api/staging/visit-billing-audit", {
        method: "POST",
      })
    ).status,
    404,
  );
  const finalHealth = await query(
    "select public.per_visit_checkout_ready() as ready from public.visit_billing_runtime",
  );
  assert.equal(finalHealth[0]?.ready, true);
  console.log(
    JSON.stringify(
      {
        productionCommit: commit,
        migrationsVerified: manifest.migrationCount,
        scheduler: "two automatic HTTP 200 runs; fresh heartbeat",
        liveWebhookEvents: additions,
        marketplace: "off",
        legal: "held",
        smoke: "passed; no live payment created",
      },
      null,
      2,
    ),
  );
} catch {
  // Provider/CLI exceptions can embed request bodies, keys or personal data.
  console.error(
    "Release stopped. Do not repeat money operations or merge past a failed gate. Inspect the failed step privately; credentials and provider payloads have been withheld.",
  );
  process.exitCode = 1;
}
