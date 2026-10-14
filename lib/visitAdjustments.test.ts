import assert from "node:assert/strict";
import test from "node:test";
import {
  cancellationRefunds,
  removedLineRefunds,
  type VisitCharge,
} from "./visitAdjustments";

const charges: VisitCharge[] = [
  {
    id: "a",
    stripe_payment_intent: "pi_a",
    amount_pence: 7000,
    refunded_pence: 1000,
    line_items: [
      {
        id: "cleaning",
        label: "Cleaning",
        amountPence: 5000,
        reservedMinutes: 120,
      },
      { id: "oven", label: "Oven", amountPence: 2000, reservedMinutes: 60 },
    ],
    refunded_lines: { oven: 1000 },
  },
  {
    id: "b",
    stripe_payment_intent: "pi_b",
    amount_pence: 1000,
    refunded_pence: 0,
    line_items: [
      { id: "fridge", label: "Fridge", amountPence: 1000, reservedMinutes: 60 },
    ],
    refunded_lines: {},
  },
];

test("cancellation refunds net paid funds across several intents without rounding loss", () => {
  assert.equal(
    cancellationRefunds(charges, 75).reduce((sum, r) => sum + r.amountPence, 0),
    5250,
  );
  assert.equal(cancellationRefunds([], 100).length, 0);
  assert.equal(cancellationRefunds(charges, 0).length, 0);
});
test("removed extras refund the specific funding intent and reject already refunded lines", () => {
  assert.equal(
    removedLineRefunds(charges, charges[1].line_items)[0].intentId,
    "pi_b",
  );
  assert.throws(
    () => removedLineRefunds(charges, charges[0].line_items.slice(1)),
    /no matching paid/,
  );
});
