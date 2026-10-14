import { test } from "node:test";
import assert from "node:assert/strict";
import { cleaningQuote } from "./cleaningExtras";
import { visitDiscounts, visitLineItems } from "./visitLineItems";
test("base cleaning, each add-on and products remain separate amounts", () => {
  const quote = cleaningQuote(
    { price: 45.98, duration_minutes: 120, service_type: "cleaning" },
    120,
    ["oven"],
    true,
    1,
  );
  assert.deepEqual(
    visitLineItems(quote, 100).map((line) => [line.id, line.amountPence]),
    [
      ["cleaning", 4498],
      ["oven", 2000],
      ["products", 500],
    ],
  );
});
test("a plan discount loses no pennies and does not calculate cleaner pay", () => {
  const discounts = visitDiscounts([4598, 7098, 7098, 4598, 4598, 7098], 501);
  assert.equal(
    discounts.reduce((sum, amount) => sum + amount, 0),
    501,
  );
});
