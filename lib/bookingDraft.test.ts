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
  extras: { addons: ["oven"], bringsProducts: true },
  visitOverrides: { 1: { addons: ["fridge"], bringsProducts: false } },
  petsAtHome: true,
  slot: "2026-10-25T09:00:00.000Z",
  optionalSlots: ["2026-10-25T10:00:00.000Z", "2026-10-26T09:00:00.000Z"],
  request: "Ring the bell, please",
  promo: "WELCOME",
  preferredCleaner: "",
  phone: "07400123456",
};

test("all booking choices survive sign-in without putting personal details in the URL", () => {
  const tab = storage();
  assert.equal(
    saveBookingDraft(tab, draft, 1000, "token"),
    "/book?resume=token",
  );
  assert.deepEqual(readBookingDraft(tab, "token", 2000), draft);
  assert.equal(readBookingDraft(storage(), "token", 2000), null);
  assert.equal(readBookingDraft(tab, "different-token", 2000), null);
  assert.deepEqual(readBookingDraft(tab, "token", 2000), draft);
});

test("drafts expire and their personal details are removed after two hours or consumption", () => {
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

test("storage failures keep the customer on the booking page rather than discarding details", () => {
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

test("malformed choices are rejected and stored prices/consents are never trusted", () => {
  const tab = storage();
  for (const change of [
    { home: null },
    { extras: { addons: ["invented"], bringsProducts: true } },
    { optionalSlots: ["invalid"] },
    { regularVisits: 20 },
    { cleaningMinutes: 999 },
    { visitOverrides: { 99: draft.extras } },
  ]) {
    assert.equal(
      saveBookingDraft(
        tab,
        { ...draft, ...change } as BookingDraft,
        1000,
        "token",
      ),
      null,
    );
  }
  saveBookingDraft(
    tab,
    {
      ...draft,
      price: 1,
      saveCardConsent: true,
      earlyStartAgreed: true,
    } as BookingDraft,
    1000,
    "token",
  );
  const restored = readBookingDraft(tab, "token", 1001)!;
  assert.equal("price" in restored, false);
  assert.equal("saveCardConsent" in restored, false);
  assert.equal("earlyStartAgreed" in restored, false);
});
