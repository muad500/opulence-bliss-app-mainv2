import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  migrationBatch,
  migrationLedgerCheck,
} from "./prepare-production-visit-release.mjs";

const files = [
  "20261031000200_customer_regular_series_controls.sql",
  "20261031000300_customer_approved_cleaning_extra_hours.sql",
  "20261031000400_regular_series_end_notice.sql",
  "20261031000500_regular_resume_payment_notice_copy.sql",
  "20261031000600_restart_ranked_offers_on_series_resume.sql",
  "20261031000700_preserve_offer_and_channel_notice_gates.sql",
];
const migrations = files.map((file) => {
  const source = readFileSync("supabase/migrations/" + file, "utf8").replaceAll(
    "\r\n",
    "\n",
  );
  return {
    source,
    version: file.slice(0, 14),
    name: file.slice(15, -4),
    md5: createHash("md5").update(source).digest("hex"),
  };
});
const directory = "artifacts/regular-controls-extra-hours";
mkdirSync(directory, { recursive: true });
const guard = `
do $staging_only$
begin
  if not exists(select 1 from vault.secrets where name='opulence_staging_recovery_secret') then
    raise exception 'Staging project marker missing. Do not run on Production.';
  end if;
end;
$staging_only$;
`;
const apply = migrationBatch(migrations)
  .replace(
    "-- PREPARED ONLY. Production uiqcsihgqaktpjumyeap, after explicit merge approval.",
    "-- STAGING ONLY: comwdjprdedmsnxtvuuk. Production not authorised.",
  )
  .replaceAll("opulence-visit-release", "opulence-regular-controls-staging")
  .replace(
    "set local lock_timeout = '10s';",
    "set local lock_timeout = '10s';\n" + guard,
  );
writeFileSync(
  directory + "/staging-apply.sql",
  apply + "\n" + migrationLedgerCheck(migrations),
);
writeFileSync(
  directory + "/staging-rollback.sql",
  apply.replace(/commit;\s*$/i, "rollback;"),
);
writeFileSync(
  directory + "/ledger-check.sql",
  migrationLedgerCheck(migrations),
);
writeFileSync(
  directory + "/manifest.json",
  JSON.stringify(
    migrations.map(({ version, name, md5 }) => ({ version, name, md5 })),
    null,
    2,
  ),
);
console.log("Prepared six staging-only migrations. Nothing executed.");
