import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleaningQuote,
  parseCleaningExtras,
  cleaningSeriesQuote,
  allocateCleaningPayments,
} from "./cleaningExtras";
const pkg = { price: 45.98, duration_minutes: 120, service_type: "cleaning" };
test("one-off add-ons add fixed fees and reserve their full time", () => {
  const quote = cleaningQuote(pkg, 120, ["oven", "fridge"], true, 1);
  assert.equal(quote.totalPence, 8098);
  assert.equal(quote.durationMinutes, 240);
});
test("regular products fee and default add-ons apply to every visit", () => {
  assert.equal(cleaningQuote(pkg, 120, ["ironing"], true, 6).totalPence, 39588);
});
test("individual visits can override defaults without underfunding or losing pennies", () => {
  const overrides = Array.from({ length: 6 }, (_, index) => ({
    addons: index === 1 ? [] : ["oven"],
    bringsProducts: index !== 1,
  }));
  const series = cleaningSeriesQuote(pkg, 120, [], false, 6, overrides);
  assert.equal(series.quotes[1].durationMinutes, 120);
  assert.equal(series.quotes[0].durationMinutes, 180);
  assert.equal(series.totalPence, 40088);
  const allocations = allocateCleaningPayments(
    series.quotes.map((item) => item.totalPence),
    501,
  );
  assert.equal(
    allocations.reduce((sum, row) => sum + row.grossPence, 0),
    series.totalPence - 501,
  );
  assert.deepEqual(
    allocations.map((row) => row.providerPence),
    allocateCleaningPayments(
      series.quotes.map((item) => item.totalPence),
      0,
    ).map((row) => row.providerPence),
  );
  assert.throws(() =>
    cleaningSeriesQuote(pkg, 120, [], false, 6, [overrides[0]]),
  );
});
test("reject unknown, repeated or client-priced add-ons and invalid products", () => {
  for (const ids of [
    ["plumbing"],
    ["oven", "oven"],
    [{ id: "oven", pricePence: 1 }],
    "oven",
  ])
    assert.throws(() => parseCleaningExtras(ids, false));
  assert.throws(() => parseCleaningExtras([], "false"));
});
test("add-ons must fit the existing eight-hour visit and cannot hide time", () => {
  assert.throws(() => cleaningQuote(pkg, 480, ["oven"], false, 1));
  assert.equal(
    cleaningQuote(
      pkg,
      180,
      ["oven", "fridge", "cupboards", "windows", "ironing"],
      false,
      1,
    ).durationMinutes,
    480,
  );
});
