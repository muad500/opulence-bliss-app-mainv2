import test from "node:test";
import assert from "node:assert/strict";
import { parseBookingPreferences } from "./bookingPreferences";
test("legacy drafts retain email confirmations without inventing access instructions", () => {
  assert.deepEqual(parseBookingPreferences(undefined), {
    howHeard: "",
    confirmationChannel: "email",
    roomsToClean: "",
    accessInstructions: "",
  });
});
test("booking choices preserve a per-visit confirmation preference and rooms/access", () => {
  assert.deepEqual(
    parseBookingPreferences({
      howHeard: "Nextdoor",
      confirmationChannel: "sms",
      roomsToClean: " Kitchen ",
      accessInstructions: " Concierge ",
    }),
    {
      howHeard: "Nextdoor",
      confirmationChannel: "sms",
      roomsToClean: "Kitchen",
      accessInstructions: "Concierge",
    },
  );
});
test("invalid channels, referral sources and oversized instructions fail", () => {
  for (const value of [
    { confirmationChannel: "whatsapp" },
    { howHeard: "injected" },
    { accessInstructions: "a".repeat(1001) },
    { roomsToClean: null },
  ])
    assert.throws(() => parseBookingPreferences(value));
});
