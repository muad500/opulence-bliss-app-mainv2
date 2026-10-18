import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

export const versions = [
  "20261014000100",
  "20261014000200",
  "20261014000300",
  "20261014000400",
  "20261014000500",
  "20261017000100",
  "20261018000100",
  "20261018000200",
  "20261018000300",
  "20261018000400",
  "20261018000500",
  "20261018000600",
  "20261018000700",
  "20261018000800",
  "20261018000900",
  "20261018001000",
  "20261018001100",
];
export const liveEvents = [
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "refund.updated",
  "customer.updated",
];
export const excluded = [
  "app/api/staging/**",
  "lib/stagingVisitBillingFixtures.ts",
  "scripts/test-staging*.mjs",
  "supabase/staging/**",
  "docs/staging-*.md",
];
const lf = (text) => text.replaceAll("\r\n", "\n");
const digest = (text, algorithm = "sha256") =>
  createHash(algorithm).update(text).digest("hex");
const literal = (text) => "'" + text.replaceAll("'", "''") + "'";

/** Keep the original source in the ledger, executing its body in one transaction. */
export function migrationBatch(migrations) {
  const checks = migrations
    .map(
      ({ version, md5 }) => `
  if exists (select 1 from supabase_migrations.schema_migrations where version = '${version}')
    and not exists (select 1 from supabase_migrations.schema_migrations
      where version = '${version}' and md5(replace(array_to_string(statements, E'\\n'), E'\\r\\n', E'\\n')) = '${md5}')
  then raise exception 'Migration ${version} source differs; stop and reconcile the ledger'; end if;`,
    )
    .join("\n");
  const apply = migrations
    .map(({ version, name, source }) => {
      // Every source currently has exactly one outer BEGIN/COMMIT pair.
      const body = source
        .replace(/^begin;\s*$/im, "")
        .replace(/^commit;\s*$/im, "");
      return `
do $apply_${version}$
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '${version}') then
    execute ${literal(body)};
    insert into supabase_migrations.schema_migrations (version, name, statements)
    values ('${version}', ${literal(name)}, array[${literal(source)}]);
  end if;
end;
$apply_${version}$;`;
    })
    .join("\n");
  return `-- PREPARED ONLY. Production uiqcsihgqaktpjumyeap, after explicit merge approval.
-- A mismatch stops BEFORE any migration is executed. An exact ledger match skips it.
begin;
set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtextextended('opulence-visit-release', 0));
do $preflight$
begin
${checks}
end;
$preflight$;
${apply}
commit;
`;
}

export function prepare(root, output) {
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    }).trim();
  const base = git("rev-parse", "origin/main");
  const head = git("rev-parse", "HEAD");
  const files = git(
    "diff",
    "--name-only",
    "origin/main...HEAD",
    "--",
    "supabase/migrations",
  )
    .split("\n")
    .filter(Boolean)
    .sort();
  if (
    files.length !== versions.length ||
    files.some(
      (f, i) =>
        !f
          .split("/")
          .at(-1)
          .startsWith(versions[i] + "_"),
    )
  )
    throw new Error(
      "Migration list changed; review the release manifest rather than omitting a migration.",
    );
  const migrations = files.map((path) => {
    const source = lf(readFileSync(resolve(root, path), "utf8"));
    const file = path.split("/").at(-1);
    if (
      (source.match(/^begin;\s*$/gim) ?? []).length !== 1 ||
      (source.match(/^commit;\s*$/gim) ?? []).length !== 1
    )
      throw new Error("Review the transaction wrapper in " + path);
    return {
      path,
      version: file.slice(0, 14),
      name: file.slice(15, -4),
      source,
      md5: digest(source, "md5"),
      sha256: digest(source),
    };
  });
  mkdirSync(output, { recursive: true });
  writeFileSync(
    resolve(output, "01-migrations.sql"),
    migrationBatch(migrations),
  );
  for (const [source, target] of [
    ["supabase/production/visit-payments-schedule.sql", "02-scheduler.sql"],
    ["supabase/production/visit-payments-smoke.sql", "03-database-smoke.sql"],
    ["scripts/run-production-visit-release.mjs", "run.mjs"],
    ["docs/production-visit-release.md", "README.md"],
    ["supabase/functions/visit-payments/index.ts", "worker.ts"],
    [
      "supabase/functions/visit-payments/source-manifest.json",
      "worker-manifest.json",
    ],
  ])
    copyFileSync(resolve(root, source), resolve(output, target));
  writeFileSync(
    resolve(output, "live-webhook-events.json"),
    JSON.stringify(liveEvents, null, 2) + "\n",
  );
  const patch = execFileSync(
    "git",
    [
      "diff",
      "--binary",
      base,
      head,
      "--",
      ".",
      ...excluded.map((p) => ":(exclude)" + p),
    ],
    { cwd: root, maxBuffer: 24 * 1024 * 1024 },
  );
  writeFileSync(resolve(output, "web-release.patch"), patch);
  const packageFiles = [
    "01-migrations.sql",
    "02-scheduler.sql",
    "03-database-smoke.sql",
    "worker.ts",
    "worker-manifest.json",
    "live-webhook-events.json",
    "web-release.patch",
    "run.mjs",
    "README.md",
  ];
  const manifest = {
    preparedOnly: true,
    productionProject: "uiqcsihgqaktpjumyeap",
    stripeAccount: "acct_1UL6n3ILnegr7Mwu",
    stripeMode: "live",
    baseMain: base,
    stagingCommit: head,
    migrationCount: migrations.length,
    migrations: migrations.map((m) => ({
      path: m.path,
      version: m.version,
      name: m.name,
      md5: m.md5,
      sha256: m.sha256,
    })),
    excluded,
    heldLegalMigration: "20261003002100",
    workerSource: JSON.parse(
      readFileSync(resolve(output, "worker-manifest.json")),
    ).sourceSha256,
    files: Object.fromEntries(
      packageFiles.map((p) => [p, digest(readFileSync(resolve(output, p)))]),
    ),
  };
  writeFileSync(
    resolve(output, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  return manifest;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const output = resolve(root, "artifacts/production-visit-release");
  const manifest = prepare(root, output);
  console.log(
    JSON.stringify({
      preparedOnly: true,
      output,
      migrations: manifest.migrationCount,
      baseMain: manifest.baseMain,
      stagingCommit: manifest.stagingCommit,
    }),
  );
}
