import assert from "node:assert/strict";
import test from "node:test";
import {
  BOOKING_DRAFT_MAX_AGE,
  clearBookingDraft,
  readBookingDraft,
  saveBookingDraft,
  type BookingDraft,
} from "./bookingDraft";

function storage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}
const draft: BookingDraft = {
  packageId: "essential",
  postcode: "EC1V 2NX",
  address: "128 City Road, London",
  home: { propertyType: "flat", bedrooms: 2, bathrooms: 1 },
  frequency: "weekly",
  regularVisits: 6,
  cleaningMinutes: 180,
  slot: "2026-10-25T09:00:00.000Z",
  optionalSlots: ["2026-10-25T10:00:00.000Z"],
  request: "Ring the bell, please",
  promo: "WELCOME",
  preferredCleaner: "",
  phone: "07400123456",
};

test("booking choices survive sign-in in the same tab without personal details in the URL", () => {
  const tab = storage();
  assert.equal(
    saveBookingDraft(tab, draft, 1000, "token"),
    "/book?resume=token",
  );
  assert.deepEqual(readBookingDraft(tab, "token", 2000), draft);
  assert.equal(readBookingDraft(storage(), "token", 2000), null);
  assert.equal(readBookingDraft(tab, "wrong", 2000), null);
  assert.deepEqual(readBookingDraft(tab, "token", 2000), draft);
});
test("expired and consumed drafts remove personal details", () => {
  const tab = storage();
  saveBookingDraft(tab, draft, 1000, "token");
  assert.equal(
    readBookingDraft(tab, "token", 1001 + BOOKING_DRAFT_MAX_AGE),
    null,
  );
  assert.equal(tab.data.size, 0);
  saveBookingDraft(tab, draft, 1000, "token");
  clearBookingDraft(tab);
  assert.equal(tab.data.size, 0);
});
test("unavailable storage and malformed data fail safely without a misleading return URL", () => {
  const tab = storage();
  assert.equal(
    saveBookingDraft(tab, { ...draft, cleaningMinutes: 999 }, 1000, "token"),
    null,
  );
  const blocked = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("full");
    },
    removeItem() {
      throw new Error("blocked");
    },
  };
  assert.equal(saveBookingDraft(blocked, draft, 1000, "token"), null);
  assert.equal(readBookingDraft(blocked, "token"), null);
  assert.doesNotThrow(() => clearBookingDraft(blocked));
});
test("prices and consents cannot be restored from a modified draft", () => {
  const tab = storage();
  saveBookingDraft(
    tab,
    { ...draft, price: 1, earlyStartAgreed: true } as BookingDraft,
    1000,
    "token",
  );
  const restored = readBookingDraft(tab, "token", 1001)!;
  assert.equal("price" in restored, false);
  assert.equal("earlyStartAgreed" in restored, false);
});
