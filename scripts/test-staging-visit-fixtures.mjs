import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const directory = await mkdtemp(join(tmpdir(), "opulence-staging-fixtures-"));
assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
assert.ok(basename(directory).startsWith("opulence-staging-fixtures-"));
after(() => rm(directory, { recursive: true, force: true }));
for (const name of [
  "appointmentWindow",
  "cancellationPolicy",
  "stagingVisitBillingFixtures",
]) {
  const source = await readFile(
    new URL(`../lib/${name}.ts`, import.meta.url),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  await writeFile(join(directory, `${name}.js`), compiled.outputText);
}
const require = createRequire(import.meta.url);
const { stagingCancellationFixture } = require(
  join(directory, "stagingVisitBillingFixtures.js"),
);
const { appointmentFitsWindow } = require(
  join(directory, "appointmentWindow.js"),
);
const { calculateCancellationPolicy } = require(
  join(directory, "cancellationPolicy.js"),
);

test("staging cancellation dates fit real booking windows and the intended bands across DST", () => {
  for (const clock of [
    "2026-10-14T12:12:45Z",
    "2026-10-24T12:12:45Z",
    "2026-03-28T12:12:45Z",
  ]) {
    const now = new Date(clock);
    for (const [name, expected] of Object.entries({
      cancellation_full: 100,
      cancellation_75: 75,
      cancellation_50: 50,
      cancellation_same_day: 0,
    })) {
      const fixture = stagingCancellationFixture(name, now);
      assert.equal(fixture.refundPercent, expected);
      assert.ok(appointmentFitsWindow(fixture.scheduledAt, 120));
      assert.ok(
        fixture.scheduledAt.getTime() >= now.getTime() + 2.5 * 3_600_000,
      );
      assert.equal(
        calculateCancellationPolicy(fixture.scheduledAt, 100, now)
          .refundPercent,
        expected,
      );
    }
  }
});

test("an impossible real-clock band fails before a fixture or payment is created", () => {
  assert.throws(
    () =>
      stagingCancellationFixture(
        "cancellation_same_day",
        new Date("2026-10-14T21:00:00Z"),
      ),
    /no valid slot/,
  );
  assert.throws(
    () =>
      stagingCancellationFixture(
        "cancellation_50",
        new Date("2026-10-14T03:00:00Z"),
      ),
    /no valid slot/,
  );
  assert.throws(
    () => stagingCancellationFixture("unknown"),
    /Unknown staging cancellation case/,
  );
});
