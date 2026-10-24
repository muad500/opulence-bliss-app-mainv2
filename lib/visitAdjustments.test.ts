import assert from "node:assert/strict";
import test from "node:test";
import {
  cancellationRefunds,
  removedLineRefunds,
  visitCancellationPolicy,
  type VisitCharge,
} from "./visitAdjustments";
import { DEFAULT_CLEANING_BILLING_TERMS } from "./cleaningBillingTerms";

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

test("launch cancellation refunds all add-ons/products, only retaining the cleaning-hours band", () => {
  const withProducts = [
    ...charges,
    {
      id: "products",
      stripe_payment_intent: "pi_products",
      amount_pence: 500,
      refunded_pence: 0,
      line_items: [
        {
          id: "products",
          label: "Products",
          amountPence: 500,
          reservedMinutes: 0,
        },
      ],
      refunded_lines: {},
    },
  ];
  const plans = cancellationRefunds(withProducts, 30, true);
  assert.equal(
    plans.reduce((sum, refund) => sum + refund.amountPence, 0),
    4000,
  ); // £15 cleaning + £25 extras
  assert.equal(plans[0].refundedLines.cleaning, 1500);
  assert.equal(plans[0].refundedLines.oven, 2000);
  assert.equal(plans.find((p) => p.chargeId === "products")?.amountPence, 500);
  assert.throws(
    () =>
      cancellationRefunds([{ ...charges[0], refunded_pence: 1100 }], 30, true),
    /reconciliation/,
  );
});

test("launch cancellation boundaries include twelve hours, same London day and old snapshots", () => {
  const terms = {
    ...DEFAULT_CLEANING_BILLING_TERMS,
    cancellationBasis: "cleaning_hours" as const,
    cancellationRefundPercent: {
      full: 100,
      three_quarter: 75,
      half: 50,
      none: 30,
    },
  };
  const now = "2026-10-24T18:00:00Z";
  for (const [hours, percent] of [
    [49, 100],
    [48, 100],
    [47.99, 75],
    [24, 75],
    [23.99, 50],
    [12, 50],
    [11.99, 30],
  ] as const) {
    const start = new Date(Date.parse(now) + hours * 3600000).toISOString();
    const policy = visitCancellationPolicy(start, charges, terms, now);
    assert.equal(policy.refundPercent, percent, `boundary ${hours} hours`);
    assert.equal(
      policy.cancellationChargePence,
      5000 - Math.round((5000 * percent) / 100),
    );
  }
  assert.equal(
    visitCancellationPolicy("2026-10-24T21:00:00Z", charges, terms, now)
      .refundPercent,
    30,
  );
  assert.equal(
    visitCancellationPolicy(
      "2026-10-25T04:00:00Z",
      charges,
      DEFAULT_CLEANING_BILLING_TERMS,
      now,
    ).refundPercent,
    50,
  );
});

test("a new booking's statutory 14-day right overrides late fees before work starts", () => {
  const terms = {
    ...DEFAULT_CLEANING_BILLING_TERMS,
    cancellationBasis: "cleaning_hours" as const,
    cancellationRefundPercent: {
      full: 100,
      three_quarter: 75,
      half: 50,
      none: 30,
    },
  };
  const before = visitCancellationPolicy(
    "2026-11-03T10:00:00Z",
    charges,
    terms,
    "2026-11-03T09:00:00Z",
    "2026-10-20T10:00:00Z",
  );
  assert.equal(before.refundPence, 7000);
  assert.equal(before.cancellationChargePence, 0);
  assert.match(before.title, /14-day/);
  const after = visitCancellationPolicy(
    "2026-11-04T10:00:00Z",
    charges,
    terms,
    "2026-11-04T09:00:00Z",
    "2026-10-20T10:00:00Z",
  );
  assert.equal(after.cancellationChargePence, 3500);
});

test("round the cleaning charge, with the exact remaining pennies refunded", () => {
  const charge = {
    ...charges[0],
    amount_pence: 4598,
    refunded_pence: 0,
    refunded_lines: {},
    line_items: [
      {
        id: "cleaning",
        label: "Cleaning",
        amountPence: 4598,
        reservedMinutes: 120,
      },
    ],
  };
  const refunds = cancellationRefunds([charge], 75, true);
  assert.equal(refunds[0].amountPence, 3448);
  assert.equal(charge.amount_pence - refunds[0].amountPence, 1150);
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
