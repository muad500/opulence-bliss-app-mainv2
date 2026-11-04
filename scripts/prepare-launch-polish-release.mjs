// Explicit allowlist: no baseline merge, old retired legal migration, staging
// fixture or scheduler can enter a production migration batch through this tool.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  migrationBatch,
  migrationLedgerCheck,
} from "./prepare-production-visit-release.mjs";
export const launchPolishFiles = [
  "20261103115524_launch_polish_package_scopes.sql",
  "20261103115526_cleaning_job_evidence.sql",
  "20261103115527_launch_operations_communications.sql",
  "20261103115529_staff_visit_outcomes.sql",
  "20261103124258_recorded_outcome_legacy_guard.sql",
];
export const launchPolishMigrations = launchPolishFiles.map((file) => {
  const source = readFileSync(`supabase/migrations/${file}`, "utf8");
  if (
    source.includes("\r") ||
    !/^begin;/im.test(source) ||
    !/^commit;/im.test(source)
  )
    throw Error(
      "Migration source must be exact LF with a single outer transaction",
    );
  return {
    version: file.slice(0, 14),
    name: file.slice(15, -4),
    source,
    md5: createHash("md5").update(source).digest("hex"),
    sha256: createHash("sha256").update(source).digest("hex"),
  };
});
if (process.argv[1]?.endsWith("prepare-launch-polish-release.mjs")) {
  const mode = process.argv[2] ?? "manifest";
  if (mode === "manifest")
    console.log(
      JSON.stringify(
        launchPolishMigrations.map(({ version, name, md5, sha256 }) => ({
          version,
          name,
          md5,
          sha256,
        })),
        null,
        2,
      ),
    );
  else if (mode === "ledger")
    console.log(migrationLedgerCheck(launchPolishMigrations));
  else if (mode === "staging" || mode === "staging-dry-run") {
    let batch = migrationBatch(launchPolishMigrations)
      .replace(
        "-- PREPARED ONLY. Production uiqcsihgqaktpjumyeap, after explicit merge approval.",
        "-- STAGING ONLY: comwdjprdedmsnxtvuuk.",
      )
      .replace(
        "set local lock_timeout = '10s';",
        `set local lock_timeout = '10s';
do $stage_guard$ begin
  if not exists(select 1 from vault.secrets where name='opulence_staging_recovery_secret') then raise exception 'Staging marker missing; stop'; end if;
end; $stage_guard$;`,
      );
    if (mode === "staging-dry-run")
      batch = batch.replace(/commit;\s*$/, "rollback;");
    console.log(batch);
  } else
    throw Error(
      "Only manifest, ledger, staging and staging-dry-run are available before the production go-ahead",
    );
}
