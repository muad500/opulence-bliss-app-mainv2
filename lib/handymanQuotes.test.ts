import test from "node:test";
import assert from "node:assert/strict";
import {
  ALL_HANDYMAN_TASKS,
  HIDDEN_HANDYMAN_TASKS,
  handymanPence,
  handymanQuoteSplit,
  handymanPostcode,
  handymanPreferredDates,
} from "./handymanQuotes";
test("fixed totals include materials; commission is on the total and no VAT is invented", () => {
  assert.deepEqual(handymanQuoteSplit(12500), {
    gross: 12500,
    platform: 2500,
    provider: 10000,
  });
  assert.deepEqual(handymanQuoteSplit(10001, 1750), {
    gross: 10001,
    platform: 1750,
    provider: 8251,
  });
  assert.equal("vat" in handymanQuoteSplit(12500), false);
  for (const total of [0, -1, NaN, Infinity, 1.2, 1000001])
    assert.throws(() => handymanQuoteSplit(total));
  assert.throws(() => handymanQuoteSplit(10000, 5001));
});
test("money rejects fractional pennies, malformed and out-of-range quotes", () => {
  assert.equal(handymanPence("123.45"), 12345);
  assert.equal(handymanPence("10000"), 1000000);
  for (const text of ["1.234", "1e3", "-1", "0", "NaN", "10000.01"])
    assert.throws(() => handymanPence(text));
});
test("six existing categories stay stable and four additions are separate", () => {
  assert.equal(ALL_HANDYMAN_TASKS.length, 10);
  assert.equal(HIDDEN_HANDYMAN_TASKS.length, 4);
  assert.ok(HIDDEN_HANDYMAN_TASKS.includes("Plumbing"));
});
test("posting validates postcode and bounded future dates without any price", () => {
  assert.equal(handymanPostcode("e141aa"), "E14 1AA");
  assert.throws(() => handymanPostcode("not a postcode"));
  assert.deepEqual(
    handymanPreferredDates(
      ["2026-10-25", "2026-10-25"],
      Date.parse("2026-10-20"),
    ),
    ["2026-10-25"],
  );
  assert.throws(() =>
    handymanPreferredDates(["2026-02-30"], Date.parse("2026-10-20")),
  );
  assert.throws(() =>
    handymanPreferredDates(["2028-01-01"], Date.parse("2026-10-20")),
  );
});
