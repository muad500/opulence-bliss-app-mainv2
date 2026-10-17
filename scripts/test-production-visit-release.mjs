import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  migrationBatch,
  versions,
  excluded,
  liveEvents,
} from "./prepare-production-visit-release.mjs";

test("release includes all nine source migrations in order and holds legal", () => {
  assert.equal(versions.length, 9);
  assert.deepEqual([...versions].sort(), versions);
  assert.ok(versions.includes("20261014000500"));
  assert.ok(!versions.includes("20261003002100"));
});
test("ledger checks precede every write, source is preserved, outer transaction removed only for execution", () => {
  const sql = migrationBatch([
    {
      version: "20261014000100",
      name: "fixture",
      md5: "abc",
      source: "begin;\nselect 'test';\ncommit;\n",
    },
  ]);
  assert.ok(sql.indexOf("source differs") < sql.indexOf("execute "));
  assert.match(sql, /if not exists/);
  assert.match(sql, /execute '\nselect ''test'';\n/);
  assert.match(sql, /array\['begin;\nselect ''test'';\ncommit;/);
  assert.match(sql, /pg_advisory_xact_lock/);
});
test("release projection excludes staging routes, fixtures, reports and schedules", () => {
  for (const path of [
    "app/api/staging/**",
    "supabase/staging/**",
    "lib/stagingVisitBillingFixtures.ts",
    "docs/staging-*.md",
  ])
    assert.ok(excluded.includes(path));
  assert.equal(liveEvents.length, 4);
});
test("runner is offline by default and requires scheduler and email gates before web push", () => {
  const s = readFileSync(
    new URL("./run-production-visit-release.mjs", import.meta.url),
    "utf8",
  );
  assert.ok(
    s.indexOf('!process.argv.includes("--execute")') < s.indexOf("fetch("),
  );
  assert.match(s, /RELEASE_AUTHORIZATION/);
  assert.match(s, /STAGING_EMAIL_TEST_PASSED/);
  assert.ok(
    s.indexOf("Two successful automatic scheduler runs") <
      s.indexOf('"HEAD:refs/heads/main"'),
  );
  assert.doesNotMatch(s, /vercel (?:login|env pull)/);
});
