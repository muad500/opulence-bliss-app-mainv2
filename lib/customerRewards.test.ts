import assert from "node:assert/strict";
import test from "node:test";
import {
  availableLoyaltyMinutes,
  customerLoyaltyProgress,
  planBookingCredit,
  rewardCalendarDeadline,
  type BookingCreditLot,
  type RewardHistoryBooking,
} from "./customerRewards";

const customerId = "TEST-customer-rewards";
const now = "2026-11-04T12:00:00Z";
const booking = (
  index: number,
  changes: Partial<RewardHistoryBooking> = {},
): RewardHistoryBooking => ({
  id: `TEST-booking-${index}`,
  customerId,
  serviceType: "cleaning",
  status: "completed",
  completedAt: `2026-10-${String(index + 1).padStart(2, "0")}T11:00:00Z`,
  paymentSettled: true,
  settledPence: 4598,
  refundedPence: 0,
  ...changes,
});
const history = (length: number) =>
  Array.from({ length }, (_, index) => booking(index));
const progress = (rows: RewardHistoryBooking[], recorded = false, at = now) =>
  customerLoyaltyProgress({
    customerId,
    history: rows,
    now: at,
    awardAlreadyRecorded: recorded,
  });
const lot = (changes: Partial<BookingCreditLot> = {}): BookingCreditLot => ({
  id: "TEST-credit-1",
  customerId,
  issuedAt: "2026-10-01T11:00:00Z",
  amountPence: 1000,
  usedPence: 0,
  voided: false,
  ...changes,
});
const credit = (
  lots: BookingCreditLot[],
  bookingPence = 4598,
  closed = false,
  at = now,
) =>
  planBookingCredit({
    customerId,
    lots,
    bookingPence,
    now: at,
    accountClosed: closed,
  });

test("new customer has no invented progress or reward", () => {
  assert.deepEqual(progress([]), {
    qualifyingVisits: 0,
    currentWindowVisits: 0,
    windowStartedAt: null,
    windowExpiresAt: null,
    historyAward: null,
    needsInitialAward: false,
    fivePercentEligible: false,
  });
});
test("nine completed paid visits do not earn free hours or 5%", () => {
  const result = progress(history(9));
  assert.equal(result.currentWindowVisits, 9);
  assert.equal(result.historyAward, null);
  assert.equal(result.fivePercentEligible, false);
});
test("ten historical visits earn the one-off 120 minutes at the tenth completion", () => {
  const result = progress(history(10));
  assert.deepEqual(result.historyAward, {
    earnedAt: "2026-10-10T11:00:00.000Z",
    expiresAt: "2027-04-10T11:00:00.000Z",
    minutes: 120,
  });
  assert.equal(result.needsInitialAward, true);
  assert.equal(result.fivePercentEligible, true);
});
test("history order does not matter and more visits never renew the award", () => {
  assert.deepEqual(
    progress(history(15).reverse()).historyAward,
    progress(history(10)).historyAward,
  );
});
test("a persisted award is never issued again", () => {
  assert.equal(progress(history(15), true).needsInitialAward, false);
});
test("old earned reward is not given a fresh six months at feature launch", () => {
  const rows = history(10).map((row) => ({
    ...row,
    completedAt: row.completedAt!.replace("2026-10", "2025-01"),
  }));
  assert.equal(
    progress(rows).historyAward?.expiresAt,
    "2025-07-10T10:00:00.000Z",
  );
});
for (const [label, changes] of [
  ["cancelled", { status: "cancelled" }],
  ["unpaid", { paymentSettled: false }],
  ["fully refunded", { refundedPence: 4598 }],
  ["partially refunded", { refundedPence: 1 }],
  ["wholly free", { settledPence: 0 }],
  ["not completed", { status: "in_progress" }],
  ["completion missing", { completedAt: null }],
  ["future completion", { completedAt: "2027-01-01T12:00:00Z" }],
  ["handyman", { serviceType: "maintenance" }],
  ["another customer", { customerId: "TEST-other-customer" }],
] satisfies [string, Partial<RewardHistoryBooking>][]) {
  test(`${label} visit does not count`, () => {
    const rows = history(10);
    rows[9] = booking(9, changes);
    assert.equal(progress(rows).qualifyingVisits, 9);
    assert.equal(progress(rows).historyAward, null);
  });
}
test("individual paid regular visits count, not the series purchase", () => {
  assert.equal(progress(history(6)).qualifyingVisits, 6);
});
test("an incomplete twelve-month window restarts at the next qualifying booking", () => {
  const older = history(9).map((row) => ({
    ...row,
    completedAt: row.completedAt!.replace("2026-10", "2025-01"),
  }));
  const result = progress([...older, booking(9)]);
  assert.equal(result.qualifyingVisits, 10);
  assert.equal(result.currentWindowVisits, 1);
  assert.equal(result.windowStartedAt, "2026-10-10T11:00:00.000Z");
  assert.equal(result.historyAward, null);
  assert.equal(result.fivePercentEligible, true);
});
test("expired incomplete window waits for the next visit, not page load", () => {
  const result = progress([
    booking(0, { completedAt: "2025-01-01T12:00:00Z" }),
  ]);
  assert.equal(result.currentWindowVisits, 0);
  assert.equal(result.windowStartedAt, null);
  assert.equal(result.windowExpiresAt, null);
});
test("a booking exactly at the twelve-month deadline belongs to the next window", () => {
  const older = history(9).map((row) => ({
    ...row,
    completedAt: row.completedAt!.replace("2026-10", "2025-10"),
  }));
  const result = progress([
    ...older,
    booking(9, { completedAt: "2026-10-01T11:00:00Z" }),
  ]);
  assert.equal(result.currentWindowVisits, 1);
  assert.equal(result.historyAward, null);
});
test("duplicate joined bookings and invalid pence fail closed", () => {
  assert.throws(() => progress([booking(0), booking(0)]), /Duplicate booking/);
  assert.throws(
    () => progress([booking(0, { settledPence: 1.1 })]),
    /safe integer/,
  );
  assert.throws(
    () => progress([booking(0, { refundedPence: -1 })]),
    /safe integer/,
  );
});
test("calendar expiry clamps leap/month ends and retains London wall-clock time", () => {
  assert.equal(
    rewardCalendarDeadline("2024-02-29T12:00:00.123Z", 12),
    "2025-02-28T12:00:00.123Z",
  );
  assert.equal(
    rewardCalendarDeadline("2026-08-31T11:00:00Z", 6),
    "2027-02-28T12:00:00.000Z",
  );
  assert.equal(
    rewardCalendarDeadline("2026-01-01T12:00:00Z", 6),
    "2026-07-01T11:00:00.000Z",
  );
});
test("calendar expiry resolves the autumn overlap and spring gap consistently", () => {
  assert.equal(
    rewardCalendarDeadline("2026-04-25T00:30:00Z", 6),
    "2026-10-25T01:30:00.000Z",
  );
  assert.equal(
    rewardCalendarDeadline("2025-09-29T00:30:00Z", 6),
    "2026-03-29T01:30:00.000Z",
  );
});
test("invalid dates or month offsets are rejected", () => {
  assert.throws(() => rewardCalendarDeadline("not a date", 6), /timestamp/);
  for (const months of [-1, 1.5, 121])
    assert.throws(() => rewardCalendarDeadline(now, months), /months/);
});
test("Booking Credit is automatically allocated to the next booking", () => {
  assert.deepEqual(credit([lot()]), {
    balancePence: 1000,
    appliedPence: 1000,
    cardPence: 3598,
    allocations: [
      {
        lotId: "TEST-credit-1",
        pence: 1000,
        expiresAt: "2027-10-01T11:00:00.000Z",
      },
    ],
  });
});
test("credit never exceeds the booking price or becomes cash", () => {
  assert.equal(credit([lot()], 500).appliedPence, 500);
  assert.equal(credit([lot()], 500).cardPence, 0);
  assert.equal(credit([lot()], 0).appliedPence, 0);
  assert.deepEqual(credit([lot()], 0).allocations, []);
});
test("soonest-expiring lots are used first regardless of input order", () => {
  const result = credit(
    [
      lot({ id: "TEST-new", issuedAt: "2026-10-02T11:00:00Z" }),
      lot({ id: "TEST-old", issuedAt: "2026-01-01T12:00:00Z" }),
    ],
    1500,
  );
  assert.deepEqual(
    result.allocations.map(({ lotId, pence }) => ({ lotId, pence })),
    [
      { lotId: "TEST-old", pence: 1000 },
      { lotId: "TEST-new", pence: 500 },
    ],
  );
});
test("used and expired credit, voided lots and other users' credit are unavailable", () => {
  assert.equal(credit([lot({ usedPence: 600 })]).balancePence, 400);
  for (const changes of [
    { issuedAt: "2025-01-01T12:00:00Z" },
    { voided: true },
    { customerId: "TEST-other" },
    { issuedAt: "2027-01-01T12:00:00Z" },
  ])
    assert.equal(credit([lot(changes)]).balancePence, 0);
});
test("credit expires at twelve calendar months, including the exact boundary", () => {
  assert.equal(
    credit([lot()], 4598, false, "2027-10-01T10:59:59.999Z").balancePence,
    1000,
  );
  assert.equal(
    credit([lot()], 4598, false, "2027-10-01T11:00:00.000Z").balancePence,
    0,
  );
});
test("account closure makes all Booking Credit unavailable", () => {
  assert.deepEqual(credit([lot()], 4598, true), {
    balancePence: 0,
    appliedPence: 0,
    cardPence: 4598,
    allocations: [],
  });
});
test("refund restoration uses the original credit lot and does not reset expiry", () => {
  assert.equal(credit([lot({ usedPence: 1000 })]).balancePence, 0);
  const restored = credit([lot({ usedPence: 0 })]);
  assert.equal(restored.balancePence, 1000);
  assert.equal(restored.allocations[0].expiresAt, "2027-10-01T11:00:00.000Z");
  assert.equal(
    credit([lot({ usedPence: 0 })], 4598, false, "2028-01-01T12:00:00Z")
      .balancePence,
    0,
  );
});
test("duplicate credit lots, overspending and fractional money are rejected", () => {
  assert.throws(() => credit([lot(), lot()]), /Duplicate/);
  assert.throws(() => credit([lot({ usedPence: 1001 })]), /overspent/);
  assert.throws(() => credit([lot()], 1.1), /safe integer/);
  assert.throws(
    () =>
      credit([
        lot({ amountPence: Number.MAX_SAFE_INTEGER }),
        lot({ id: "TEST-overflow", amountPence: 1 }),
      ]),
    /safe integer/,
  );
});
test("free hours can only be spent within the original six-month term", () => {
  const input = {
    earnedAt: "2026-10-01T11:00:00Z",
    usedMinutes: 30,
    accountClosed: false,
    now,
  };
  assert.equal(availableLoyaltyMinutes(input), 90);
  assert.equal(
    availableLoyaltyMinutes({ ...input, now: "2027-04-01T11:00:00Z" }),
    0,
  );
  assert.equal(availableLoyaltyMinutes({ ...input, accountClosed: true }), 0);
  assert.equal(
    availableLoyaltyMinutes({ ...input, now: "2026-09-01T11:00:00Z" }),
    0,
  );
  assert.throws(
    () => availableLoyaltyMinutes({ ...input, usedMinutes: 121 }),
    /overspent/,
  );
});
test("returning free minutes never renews the reward expiry", () => {
  const input = {
    earnedAt: "2026-01-01T12:00:00Z",
    usedMinutes: 0,
    accountClosed: false,
    now,
  };
  assert.equal(availableLoyaltyMinutes(input), 0);
});
