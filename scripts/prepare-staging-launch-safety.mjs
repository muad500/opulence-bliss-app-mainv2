import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  migrationBatch,
  migrationLedgerCheck,
} from "./prepare-production-visit-release.mjs";

// OFFLINE preparation only. This script never reads deployment secrets, makes
// a network request, executes SQL, merges a branch or deploys an environment.
const directory = ".local-secrets/launch-safety-release";
const migrations = readdirSync("supabase/migrations")
  .filter((name) =>
    /^(?:20261024000[1-6]00|20261025000[1-2]00)_.*\.sql$/.test(name),
  )
  .sort()
  .map((file) => {
    const source = readFileSync(
      `supabase/migrations/${file}`,
      "utf8",
    ).replaceAll("\r\n", "\n");
    if (
      (source.match(/^begin;\s*$/gim) ?? []).length !== 1 ||
      (source.match(/^commit;\s*$/gim) ?? []).length !== 1
    )
      throw new Error(`Review transaction wrappers in ${file}`);
    return {
      version: file.slice(0, 14),
      name: file.slice(15, -4),
      source,
      md5: createHash("md5").update(source).digest("hex"),
    };
  });
if (migrations.length !== 8)
  throw new Error("Review the eight launch migrations before preparing SQL.");
mkdirSync(directory, { recursive: true });
writeFileSync(
  `${directory}/00-ledger-preflight.sql`,
  migrationLedgerCheck(migrations),
);
const stagingGuard = `
-- STAGING ONLY: comwdjprdedmsnxtvuuk. No Production access is authorised.
-- Additional tripwire: check the browser/project ID as well as this Vault name.
do $staging_guard$
begin
  if not exists(select 1 from vault.secrets where name='opulence_staging_recovery_secret') then
    raise exception 'Expected staging scheduler marker missing. Stop; do not run on another project.';
  end if;
end
$staging_guard$;
`;
const sql = migrationBatch(migrations)
  .replace(
    "-- PREPARED ONLY. Production uiqcsihgqaktpjumyeap, after explicit merge approval.",
    "-- PREPARED ONLY. STAGING comwdjprdedmsnxtvuuk; never Production.",
  )
  .replace(
    "set local lock_timeout = '10s';",
    "set local lock_timeout = '10s';\n" + stagingGuard,
  )
  .replaceAll("opulence-visit-release", "opulence-launch-safety-staging");
writeFileSync(`${directory}/01-migrations.sql`, sql);
writeFileSync(
  `${directory}/manifest.json`,
  JSON.stringify(
    migrations.map((row) => ({
      version: row.version,
      name: row.name,
      md5: row.md5,
    })),
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    preparedOnly: true,
    target: "comwdjprdedmsnxtvuuk",
    directory,
    migrations: migrations.map((row) => row.version),
  }),
);
