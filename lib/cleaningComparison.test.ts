import assert from "node:assert/strict";
import { test } from "node:test";
import { CLEANING_COMPARISON, COMPARISON_PACKAGES } from "./cleaningComparison";
test("client comparison covers six packages and all fifteen tasks without prices", () => {
  assert.equal(COMPARISON_PACKAGES.length, 6);
  assert.equal(CLEANING_COMPARISON.length, 15);
  for (const row of CLEANING_COMPARISON) assert.equal(row.values.length, 6);
  assert.ok(!/£|\d+\s*\/\s*h/i.test(JSON.stringify(CLEANING_COMPARISON)));
});
test("descriptions override the supplied table for deep-clean wall marks and vents", () => {
  const row = CLEANING_COMPARISON.find(
    (row) => row.task === "Wall marks and vents",
  )!;
  assert.deepEqual(row.values, ["No", "No", "No", "Yes", "Yes", "No"]);
  assert.match(
    CLEANING_COMPARISON.find((row) => row.task === "Make or change beds")!
      .values[0],
    /linen left out/,
  );
});
