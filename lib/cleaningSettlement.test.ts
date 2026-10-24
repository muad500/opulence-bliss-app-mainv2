import test from "node:test";
import assert from "node:assert/strict";
import { cleaningPayoutParts, auditCleaningPayout } from "./cleaningSettlement";
import { DEFAULT_CLEANING_BILLING_TERMS as defaults } from "./cleaningBillingTerms";
import type { VisitCharge } from "./visitAdjustments";
const base: VisitCharge = {
  id: "base",
  stripe_payment_intent: "pi_base",
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
const products: VisitCharge = {
  id: "products",
  stripe_payment_intent: "pi_products",
  amount_pence: 500,
  refunded_pence: 0,
  refunded_lines: {},
  line_items: [
    { id: "products", label: "Products", amountPence: 500, reservedMinutes: 0 },
  ],
};
test("standard/deep hours and products are paid from the charges that funded them", () => {
  const terms = { ...defaults, productsCleanerPayPence: 400 };
  assert.deepEqual(
    cleaningPayoutParts([base, products], terms).map((p) => p.amountPence),
    [3000, 400],
  );
  assert.deepEqual(
    cleaningPayoutParts([base, products], {
      ...terms,
      cleanerHourlyPence: 1750,
    }).map((p) => p.amountPence),
    [3500, 400],
  );
  assert.deepEqual(
    cleaningPayoutParts(
      [
        base,
        { ...products, refunded_pence: 500, refunded_lines: { products: 500 } },
      ],
      terms,
    ).map((p) => p.amountPence),
    [3000],
  );
});
test("cancellation pays only the retained cleaning-hours compensation and never products", () => {
  const cancelled = {
    ...base,
    refunded_pence: 1379,
    refunded_lines: { cleaning: 1379 },
  };
  assert.deepEqual(
    cleaningPayoutParts([cancelled, products], defaults, 2100).map(
      (p) => p.amountPence,
    ),
    [2100],
  );
  assert.deepEqual(cleaningPayoutParts([cancelled], defaults, 0), []);
  assert.throws(
    () => cleaningPayoutParts([cancelled], defaults, 4000),
    /not funded/,
  );
  assert.throws(
    () => cleaningPayoutParts([cancelled], defaults),
    /payout review/,
  );
  assert.throws(
    () => cleaningPayoutParts([{ ...base, amount_pence: 2999 }], defaults),
    /exceeds/,
  );
});

test("reconciliation accepts documented split transfers/reversals and catches any mismatch", () => {
  const parts = [
    {
      charge_id: "base",
      amount_pence: 3000,
      reversed_pence: 1000,
      transfer_ref: "tr_base",
      destination_account: "acct_owner",
    },
    {
      charge_id: "products",
      amount_pence: 400,
      reversed_pence: 0,
      transfer_ref: "tr_products",
      destination_account: "acct_owner",
    },
  ];
  const transfers = [
    {
      id: "tr_base",
      amount: 3000,
      amount_reversed: 1000,
      currency: "gbp",
      destination: "acct_owner",
      metadata: { booking_id: "booking", charge_id: "base" },
    },
    {
      id: "tr_products",
      amount: 400,
      amount_reversed: 0,
      currency: "gbp",
      destination: "acct_owner",
      metadata: { booking_id: "booking", charge_id: "products" },
    },
  ];
  assert.deepEqual(auditCleaningPayout("booking", 2400, parts, transfers), []);
  assert.ok(
    auditCleaningPayout("booking", 2400, parts, transfers.slice(0, 1)).length,
  );
  for (const change of [
    { amount: 3001 },
    { amount_reversed: 0 },
    { currency: "eur" },
    { destination: "acct_someone_else" },
    { metadata: { booking_id: "another", charge_id: "base" } },
  ])
    assert.ok(
      auditCleaningPayout("booking", 2400, parts, [
        { ...transfers[0], ...change },
        transfers[1],
      ]).length,
    );
});
