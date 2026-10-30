// Preparation only: no remote requests, credentials, migrations or deployments.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  migrationBatch,
  migrationLedgerCheck,
} from "./prepare-production-visit-release.mjs";

const files = [
  "20261029000100_publish_final_document_pack.sql",
  "20261029000200_final_pack_acceptance_and_email.sql",
  "20261029000300_activate_final_cleaning_policy.sql",
  "20261029000400_final_privacy_retention.sql",
  "20261029000500_final_policy_public_guidance.sql",
];
const migrations = files.map((file) => {
  const source = readFileSync(`supabase/migrations/${file}`, "utf8").replaceAll(
    "\r\n",
    "\n",
  );
  return {
    version: file.slice(0, 14),
    name: file.slice(15, -4),
    source,
    md5: createHash("md5").update(source).digest("hex"),
    sha256: createHash("sha256").update(source).digest("hex"),
  };
});
const directory = "artifacts/final-document-pack";
mkdirSync(directory, { recursive: true });
writeFileSync(
  `${directory}/ledger-check.sql`,
  migrationLedgerCheck(migrations),
);
const production = migrationBatch(migrations).replaceAll(
  "opulence-visit-release",
  "opulence-final-document-pack",
);
writeFileSync(`${directory}/production-PREPARED-DO-NOT-RUN.sql`, production);
const guard = `
do $staging_only$
begin
  if not exists(select 1 from vault.secrets where name='opulence_staging_recovery_secret') then
    raise exception 'Staging project marker missing. Stop; do not run on another project.';
  end if;
end;
$staging_only$;
`;
const staging = production
  .replace(
    "-- PREPARED ONLY. Production uiqcsihgqaktpjumyeap, after explicit merge approval.",
    "-- STAGING ONLY: comwdjprdedmsnxtvuuk. Production is not authorised.",
  )
  .replace(
    "set local lock_timeout = '10s';",
    `set local lock_timeout = '10s';\n${guard}`,
  );
writeFileSync(
  `${directory}/staging-apply.sql`,
  staging + "\n" + migrationLedgerCheck(migrations),
);
writeFileSync(
  `${directory}/migration-manifest.json`,
  JSON.stringify(
    migrations.map(({ version, name, md5, sha256 }) => ({
      version,
      name,
      md5,
      sha256,
    })),
    null,
    2,
  ) + "\n",
);
console.log(
  "Prepared exactly five final-pack migrations and ledger checks; executed nothing.",
);
