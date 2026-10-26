import assert from "node:assert/strict";
import { test } from "node:test";
import {
  csvCell,
  graceCancellationsLeft,
  hmrcDates,
  londonMonth,
} from "./workerOperations";

test("cancellation grace never becomes negative", () => {
  assert.deepEqual(
    [0, 1, 2, 3, 10].map(graceCancellationsLeft),
    [2, 1, 0, 0, 0],
  );
});
test("counters use the London calendar, including daylight saving", () => {
  assert.equal(londonMonth(new Date("2026-06-30T23:30:00Z")), "2026-07-01");
  assert.equal(londonMonth(new Date("2026-12-31T23:30:00Z")), "2026-12-01");
});
test("CSV neutralises formulas and quotes text including multiline addresses", () => {
  assert.equal(csvCell('=IMPORTXML("evil")'), '"\'=IMPORTXML(""evil"")"');
  assert.equal(csvCell(" \t+123"), '"\' \t+123"');
  assert.equal(csvCell("Flat 2\nLondon"), '"Flat 2\nLondon"');
  assert.equal(csvCell(null), '""');
});
test("export dates reject invalid dates, reversed and unbounded periods", () => {
  assert.deepEqual(hmrcDates("2025-04-06", "2026-04-06"), {
    from: "2025-04-06",
    to: "2026-04-06",
  });
  for (const pair of [
    ["2026-02-30", "2026-03-06"],
    ["2026-04-06", "2025-04-06"],
    ["2024-01-01", "2026-01-01"],
    [null, null],
  ])
    assert.throws(() => hmrcDates(pair[0], pair[1]));
});
