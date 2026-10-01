import { test } from "node:test";
import { strict as assert } from "node:assert";
import { csvCell, earningsPeriodTotals, londonDate } from "./earningsPeriod";

test("earnings week begins Monday in London and excludes future visits", () => {
  const result = earningsPeriodTotals([
    { date: "2026-09-27T12:00:00Z", amount: 10 },
    { date: "2026-09-27T23:30:00Z", amount: 20 },
    { date: "2026-09-30T12:00:00Z", amount: 30 },
    { date: "2026-10-01T12:00:00Z", amount: 40 },
  ], new Date("2026-09-30T12:00:00Z"));
  assert.deepEqual(result, { week: 50, month: 60 });
});
test("London date respects DST and CSV prevents spreadsheet formula injection", () => {
  assert.equal(londonDate("2026-07-01T23:30:00Z"), "2026-07-02");
  assert.equal(londonDate("2026-12-01T23:30:00Z"), "2026-12-01");
  assert.equal(csvCell('=HYPERLINK("bad")'), '"\'=HYPERLINK(""bad"")"');
});
