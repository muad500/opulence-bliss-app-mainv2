import { test } from "node:test";
import assert from "node:assert/strict";
import {
  visitChargeDueAt,
  unpaidVisitMustCancel,
  visitExtrasCanChange,
  assertVisitLines,
} from "./visitBillingPolicy";
test("later visit charges are due exactly 48 hours before the real instant", () => {
  assert.equal(
    visitChargeDueAt("2026-10-26T10:00:00.000Z"),
    "2026-10-24T10:00:00.000Z",
  );
});
test("unpaid visits reach the cancellation deadline at 24 hours", () => {
  const slot = "2026-10-26T10:00:00.000Z";
  assert.equal(
    unpaidVisitMustCancel(slot, Date.parse("2026-10-25T10:00:00Z")),
    true,
  );
  assert.equal(
    unpaidVisitMustCancel(slot, Date.parse("2026-10-25T09:59:59Z")),
    false,
  );
  assert.equal(
    visitExtrasCanChange(slot, Date.parse("2026-10-25T10:00:00Z")),
    true,
  );
  assert.equal(
    visitExtrasCanChange(slot, Date.parse("2026-10-25T10:00:01Z")),
    false,
  );
});
test("line items reserve time and preserve a separate products amount", () => {
  assert.doesNotThrow(() =>
    assertVisitLines([
      {
        id: "cleaning",
        label: "Cleaning",
        amountPence: 4598,
        reservedMinutes: 120,
      },
      { id: "oven", label: "Oven", amountPence: 2000, reservedMinutes: 60 },
      {
        id: "products",
        label: "Products",
        amountPence: 500,
        reservedMinutes: 0,
      },
    ]),
  );
  assert.throws(() =>
    assertVisitLines([
      {
        id: "cleaning",
        label: "Cleaning",
        amountPence: 4598,
        reservedMinutes: 480,
      },
      { id: "oven", label: "Oven", amountPence: 2000, reservedMinutes: 60 },
    ]),
  );
});
