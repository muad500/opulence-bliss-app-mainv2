import test from "node:test";
import assert from "node:assert/strict";
import {
  ONE_OFF_PAYMENT_COPY,
  REGULAR_PAYMENT_COPY,
  LEGACY_SCHEDULED_VISIT_PAYMENT_COPY,
} from "./cleaningPaymentCopy";

test("new one-off copy describes checkout charging and automatic unmatched refunds", () => {
  assert.equal(
    ONE_OFF_PAYMENT_COPY,
    "You're charged when you book. If no cleaner accepts, you're refunded in full automatically.",
  );
  assert.doesNotMatch(ONE_OFF_PAYMENT_COPY, /hold|after.*visit/i);
});
test("new regular copy describes all visits charged on acceptance, including the first", () => {
  assert.equal(
    REGULAR_PAYMENT_COPY,
    "Your card is saved securely. Each visit is charged once a cleaner accepts it. If no cleaner accepts, you're not charged for that visit.",
  );
  assert.doesNotMatch(
    REGULAR_PAYMENT_COPY,
    /48 hours|first visit.*now|paid upfront|hold/i,
  );
});
test("the older 48-hour schedule is explicitly separated from new regular bookings", () => {
  assert.match(LEGACY_SCHEDULED_VISIT_PAYMENT_COPY, /earlier booking/);
  assert.match(LEGACY_SCHEDULED_VISIT_PAYMENT_COPY, /48 hours/);
  assert.match(
    LEGACY_SCHEDULED_VISIT_PAYMENT_COPY,
    /when a cleaner accepts inside that window/,
  );
});
