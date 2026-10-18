import test from "node:test";
import assert from "node:assert/strict";
import {
  assistantWithoutPrices,
  priceFreeAssistantReply,
  serviceTextWithoutPrices,
} from "./assistantPresentation";
test("tool context removes nested financial fields without altering a confirmation token", () => {
  assert.deepEqual(
    assistantWithoutPrices({
      amount: 500,
      token: "opaque",
      results: [{ price: 42, name: "Cleaning" }],
      payment_summary: "First visit paid now; later visits at 48 hours",
    }),
    {
      token: "opaque",
      results: [{ name: "Cleaning" }],
      payment_summary: "First visit paid now; later visits at 48 hours",
    },
  );
});
test("model and FAQ monetary replies direct the customer to booking", () => {
  for (const text of [
    "£35/hr",
    "It costs 35 GBP",
    "20 pounds",
    "$40.00",
    "€20",
  ]) {
    assert.match(priceFreeAssistantReply(text), /booking page/);
    assert.doesNotMatch(
      serviceTextWithoutPrices(text),
      /£|\$|€|\d+\s*(?:GBP|pounds)/,
    );
  }
  assert.equal(
    priceFreeAssistantReply("Your visit is in 48 hours."),
    "Your visit is in 48 hours.",
  );
});
