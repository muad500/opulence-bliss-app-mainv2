// Empty isolated CI database ONLY; never staging or Production.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
if (
  !["localhost", "127.0.0.1"].includes(process.env.PGHOST) ||
  process.env.PGDATABASE !== "quote_contract_test"
)
  throw Error(
    "Concurrency test requires the isolated local quote_contract_test database.",
  );
async function sql(source) {
  return (
    await run(
      "psql",
      ["-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", source],
      { maxBuffer: 1024 * 1024 },
    )
  ).stdout.trim();
}
const data = JSON.parse(
  await sql("select row_to_json(r) from public.test_handyman_quote_race r"),
);
for (const value of Object.values(data))
  assert.match(value, /^[a-f0-9-]{36}$/i);
const accept = (quote) =>
  `begin; select public.handyman_quote_command('${data.job_id}','${data.customer_id}','accept', '${JSON.stringify({ quoteId: quote, address: "1 Synthetic Test Road", termsVersion: "2026-09-28" })}'::jsonb);select pg_sleep(0.5);commit;`;
const results = await Promise.allSettled([
  sql(accept(data.quote_a)),
  sql(accept(data.quote_b)),
]);
assert.equal(
  results.filter((r) => r.status === "fulfilled").length,
  1,
  "exactly one concurrent quote acceptance must win",
);
const rejected = results.find((r) => r.status === "rejected");
assert.match(
  rejected.reason.stderr,
  /Quote is no longer available|Accept an available quote/,
);
assert.equal(
  await sql(
    `select count(*) from public.handyman_quote_operations where job_id='${data.job_id}' and kind='charge'`,
  ),
  "1",
);
assert.equal(
  await sql(
    `select count(*) from public.handyman_quotes where job_id='${data.job_id}' and status='selected'`,
  ),
  "1",
);
console.log(
  "PASS: two independent PostgreSQL connections race; one winner and one payment operation",
);
