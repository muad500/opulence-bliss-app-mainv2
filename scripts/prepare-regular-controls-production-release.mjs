import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  migrationBatch,
  migrationLedgerCheck,
} from "./prepare-production-visit-release.mjs";

const productionProject = "uiqcsihgqaktpjumyeap";
const baseCommit = "b53295571ccb732fcd7b8f6d8734177522734d65";
const workerSource =
  "50076e5ffdb5fa90fa58360c9e3c99ddc1ee91bf909ef8ee2006eb4cb9526142";
const expected = [
  ["20261031000200", "1936076d5a475a4cdba02b48f1096807"],
  ["20261031000300", "2ff602a7d6be250477eb7aeb61c1d6a7"],
  ["20261031000400", "4ec0e763cb2c6745f4703d09184c055a"],
  ["20261031000500", "ad33e200374a510adb719c1852340718"],
  ["20261031000600", "c37281d1d2909caa85facf872fa8d6c9"],
  ["20261031000700", "656db2fee14e9838dc77f25604004413"],
];
const priorVersions = [
  "20261029000100",
  "20261029000200",
  "20261029000300",
  "20261029000400",
  "20261029000500",
  "20261031000100",
];
const lf = (value) => value.replaceAll("\r\n", "\n");
const hash = (source, algorithm = "sha256") =>
  createHash(algorithm).update(source).digest("hex");

export function prepare(root, output) {
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  if (git("status", "--porcelain"))
    throw new Error(
      "Commit the reviewed release source before preparing its package.",
    );
  git("merge-base", "--is-ancestor", baseCommit, "HEAD");
  const files = readdirSync(resolve(root, "supabase/migrations"));
  const migration = (version) => {
    const matches = files.filter(
      (name) => name.startsWith(version + "_") && name.endsWith(".sql"),
    );
    if (matches.length !== 1)
      throw new Error("Expected one source for " + version);
    const file = matches[0];
    const source = lf(
      readFileSync(resolve(root, "supabase/migrations", file), "utf8"),
    );
    return {
      version,
      name: file.slice(15, -4),
      source,
      md5: hash(source, "md5"),
    };
  };
  const migrations = expected.map(([version, md5]) => {
    const item = migration(version);
    if (item.md5 !== md5)
      throw new Error("Staging-tested source changed: " + version);
    return item;
  });
  const baseline = priorVersions.map(migration);
  const changed = git("diff", "--name-only", baseCommit, "HEAD")
    .split("\n")
    .filter(Boolean);
  if (
    changed.some(
      (file) =>
        /^(supabase\/staging\/|app\/api\/staging\/|docs\/staging-)/.test(
          file,
        ) || /handyman/i.test(file),
    )
  ) {
    throw new Error(
      "The candidate contains staging helpers or marketplace changes.",
    );
  }
  const changedMigrations = changed
    .filter((file) => file.startsWith("supabase/migrations/"))
    .sort();
  if (
    JSON.stringify(
      changedMigrations.map((file) => file.split("/").pop().slice(0, 14)),
    ) !== JSON.stringify(expected.map(([version]) => version))
  ) {
    throw new Error(
      "The release must contain exactly the six approved migrations.",
    );
  }
  const workerFile = "supabase/functions/visit-payments/index.ts";
  if (git("diff", baseCommit, "HEAD", "--", workerFile))
    throw new Error("The existing worker must remain unchanged.");

  const productionGuard = `
do $production_only$
begin
  if not exists (select 1 from vault.secrets where name = 'opulence_production_visit_payments_secret')
    or exists (select 1 from vault.secrets where name = 'opulence_staging_recovery_secret')
  then raise exception 'Production project marker missing or staging marker present. STOP.'; end if;
${baseline
  .map(
    ({
      version,
      md5,
    }) => `  if not exists (select 1 from supabase_migrations.schema_migrations
    where version = '${version}' and md5(replace(array_to_string(statements, E'\\n'), E'\\r\\n', E'\\n')) = '${md5}')
  then raise exception 'Baseline migration ${version} is missing or differs. STOP.'; end if;`,
  )
  .join("\n")}
end;
$production_only$;
`;
  const apply = migrationBatch(migrations)
    .replaceAll("opulence-visit-release", "opulence-regular-controls-release")
    .replace(
      "set local lock_timeout = '10s';",
      "set local lock_timeout = '10s';\n" + productionGuard,
    );
  const readiness = `-- READ ONLY. Run before migrations and again before/after website deployment.
do $release_health$
begin
  if not public.per_visit_checkout_ready() or not public.account_acceptance_evidence_ready() then
    raise exception 'Checkout or acceptance evidence is not ready. STOP.';
  end if;
  if not exists (select 1 from public.visit_billing_runtime where last_scheduler_at > now() - interval '20 minutes') then
    raise exception 'Billing heartbeat is stale. STOP.';
  end if;
  if not exists (select 1 from cron.job where jobname = 'opulence-production-visit-payments' and active and schedule = '*/5 * * * *')
    or not exists (select 1 from cron.job where jobname = 'opulence-ranked-offer-waves' and active and schedule = '* * * * *')
  then raise exception 'An existing recovery or matching schedule is not active. STOP.'; end if;
  if not exists (select 1 from net._http_response where created > now() - interval '10 minutes'
    and status_code = 200 and content like '{%' and content like '%"source"%'
    and content::jsonb->>'source' = '${workerSource}')
  then raise exception 'Expected worker source has no recent successful heartbeat. STOP.'; end if;
end;
$release_health$;
select public.per_visit_checkout_ready() as checkout_ready,
  public.account_acceptance_evidence_ready() as acceptance_ready,
  last_scheduler_at from public.visit_billing_runtime;
select jobname, schedule, active from cron.job
where jobname in ('opulence-production-visit-payments', 'opulence-ranked-offer-waves');
`;
  const artifacts = {
    "00-baseline-ledger.sql": migrationLedgerCheck(baseline),
    "01-new-ledger-preflight.sql": migrationLedgerCheck(migrations),
    "02-health-readonly.sql": readiness,
    "03-apply-only-after-go.sql":
      apply + "\n" + migrationLedgerCheck(migrations),
    "04-ledger-after.sql": migrationLedgerCheck(migrations),
    "05-offline-rollback-rehearsal.sql": apply.replace(
      /commit;\s*$/i,
      "rollback;",
    ),
  };
  mkdirSync(output, { recursive: true });
  for (const [name, source] of Object.entries(artifacts))
    writeFileSync(resolve(output, name), source);
  const manifest = {
    state: "PREPARED_NOT_EXECUTED",
    productionProject,
    baseCommit,
    releaseCommit: git("rev-parse", "HEAD"),
    sourceFeatureCommit: "bf6fabad855f19e8152a1c02edaedb709c31724a",
    sourceQueryCommit: "a36acd361cb0230665addf7e67712766eaea9ce2",
    queryFixAlreadyIncludedAs: baseCommit,
    workerSource,
    workerChanged: false,
    newSchedulerRequired: false,
    migrations: migrations.map(({ version, name, md5 }) => ({
      version,
      name,
      md5,
    })),
    baseline: baseline.map(({ version, name, md5 }) => ({
      version,
      name,
      md5,
    })),
    artifacts: Object.entries(artifacts).map(([name, source]) => ({
      name,
      sha256: hash(source),
    })),
    changedFiles: changed,
  };
  writeFileSync(
    resolve(output, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      preparedOnly: true,
      releaseCommit: manifest.releaseCommit,
      migrations: migrations.length,
      newSchedulerRequired: false,
    }),
  );
  return manifest;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  prepare(
    process.cwd(),
    resolve(process.argv[2] ?? "artifacts/regular-controls-production-release"),
  );
}
