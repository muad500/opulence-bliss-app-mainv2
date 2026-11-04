// Offline preparation only. This cannot connect to any service or deploy code.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  migrationBatch,
  migrationLedgerCheck,
} from "./prepare-production-visit-release.mjs";

const prerequisiteFiles = [
  "20261103115524_launch_polish_package_scopes.sql",
  "20261103115526_cleaning_job_evidence.sql",
  "20261103115527_launch_operations_communications.sql",
  "20261103115529_staff_visit_outcomes.sql",
  "20261103124258_recorded_outcome_legacy_guard.sql",
  "20261103153510_professional_second_signoff.sql",
  "20261103155510_independent_onboarding_identity_guard.sql",
];

const files = [
  "20261104004744_shared_account_role_foundation.sql",
  "20261104004746_scoped_staff_roles.sql",
  "20261104004748_document_change_acceptance_workflow.sql",
  "20261104140533_publish_cleaner_terms_and_social_links.sql",
];
const readMigration = (file) => {
  const source = readFileSync(`supabase/migrations/${file}`, "utf8").replaceAll(
    "\r\n",
    "\n",
  );
  if (
    (source.match(/^begin;\s*$/gim) ?? []).length !== 1 ||
    (source.match(/^commit;\s*$/gim) ?? []).length !== 1
  )
    throw Error(`Inspect transaction boundaries in ${file}`);
  return {
    version: file.slice(0, 14),
    name: file.slice(15, -4),
    source,
    md5: createHash("md5").update(source).digest("hex"),
  };
};
const migrations = files.map(readMigration);
const launchPolishMigrations = prerequisiteFiles.map(readMigration);
const prerequisite = launchPolishMigrations
  .map(
    (migration) => `
  if not exists(select 1 from supabase_migrations.schema_migrations
    where version='${migration.version}'
      and md5(replace(array_to_string(statements,E'\\n'),E'\\r\\n',E'\\n'))='${migration.md5}') then
    raise exception 'PR 59 prerequisite ${migration.version} missing or source differs; stop';
  end if;`,
  )
  .join("\n");
const guard = `
do $staging_guard$
begin
  if not exists(select 1 from vault.secrets where name='opulence_staging_recovery_secret') then
    raise exception 'Staging marker missing. Never run this on Production.';
  end if;
${prerequisite}
end;
$staging_guard$;`;
const batch = migrationBatch(migrations)
  .replace(
    "-- PREPARED ONLY. Production uiqcsihgqaktpjumyeap, after explicit merge approval.",
    "-- PREPARED ONLY. STAGING comwdjprdedmsnxtvuuk, after the user grants the staging deployment slot.",
  )
  .replaceAll("opulence-visit-release", "opulence-shared-foundation-staging")
  .replace(
    "set local lock_timeout = '10s';",
    "set local lock_timeout = '10s';\n" + guard,
  );
const directory = "artifacts/shared-foundation-stage1";
mkdirSync(directory, { recursive: true });
writeFileSync(
  `${directory}/00-ledger-check.sql`,
  migrationLedgerCheck([...launchPolishMigrations, ...migrations]),
);
writeFileSync(
  `${directory}/01-staging-dry-run.sql`,
  batch.replace(/commit;\s*$/, "rollback;"),
);
writeFileSync(
  `${directory}/02-staging-apply.sql`,
  batch + "\n" + migrationLedgerCheck(migrations),
);
writeFileSync(
  `${directory}/manifest.json`,
  JSON.stringify(
    {
      project: "comwdjprdedmsnxtvuuk",
      preparedOnly: true,
      migrations: migrations.map(({ version, name, md5 }) => ({
        version,
        name,
        md5,
      })),
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Prepared ${migrations.length} staging migrations and ledger checks. Nothing executed or deployed.`,
);
