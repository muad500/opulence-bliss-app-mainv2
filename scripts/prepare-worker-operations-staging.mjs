// Offline preparation. Never connects to a database or reads credentials.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const files = [
  "20261026000500_cleaner_reliability_and_complaints.sql",
  "20261026000600_standard_cleaner_experience_pay.sql",
  "20261026000700_private_professional_earnings_export.sql",
  "20261026000800_all_service_earnings_export.sql",
  "20261026000900_preserve_existing_booking_pay.sql",
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
  };
});
let sql = `-- STAGING ONLY comwdjprdedmsnxtvuuk. No Production actions authorised.
begin;
set local lock_timeout='10s';
do $guard$ begin
  if not exists(select 1 from public.data_retention_control where storage_origin='https://comwdjprdedmsnxtvuuk.supabase.co') then
    raise exception 'Staging project marker missing; stop';
  end if;
end $guard$;
`;
for (const migration of migrations) {
  const { version, name, source, md5 } = migration;
  const body = source
    .replace(/^begin;\s*$/im, "")
    .replace(/^commit;\s*$/im, "");
  sql += `
do $apply_${version}$
declare v_source text:=replace($source_${version}$${source}$source_${version}$,chr(13),'');
begin
  if exists(select 1 from supabase_migrations.schema_migrations where version='${version}'
    and md5(replace(array_to_string(statements,chr(10)),chr(13),''))<>'${md5}') then
    raise exception 'Migration ${version} differs; stop';
  end if;
  if not exists(select 1 from supabase_migrations.schema_migrations where version='${version}') then
    execute replace($body_${version}$${body}$body_${version}$,chr(13),'');
    insert into supabase_migrations.schema_migrations(version,name,statements)
    values('${version}','${name}',array[v_source]);
  end if;
end
$apply_${version}$;
`;
}
sql += `commit;
with expected(version,expected_md5) as(values ${migrations.map((row) => `('${row.version}','${row.md5}')`).join(",")})
select jsonb_agg(jsonb_build_object('version',e.version,'exact_source',md5(replace(array_to_string(m.statements,chr(10)),chr(13),''))=e.expected_md5) order by e.version) as ledger
from expected e left join supabase_migrations.schema_migrations m using(version);
`;
mkdirSync("artifacts", { recursive: true });
writeFileSync("artifacts/worker-operations-staging-apply.sql", sql);
writeFileSync(
  "artifacts/worker-operations-migrations.json",
  JSON.stringify(
    migrations.map(({ source, ...row }) => row),
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    preparedOnly: true,
    target: "comwdjprdedmsnxtvuuk",
    migrations: migrations.map((row) => row.version),
  }),
);
