import assert from "node:assert/strict";
import { test } from "node:test";
import { ownsVoiceBooking, voiceBookingDetails, voiceBookingFingerprint, voiceCheckoutBody, escapeVoiceHtml } from "./voiceBooking";

const input = {
  confirmed: true, customer_name: "Test Caller", email: "CALLER@example.com", phone: "07912 345678",
  service_id: "service-one-off", postcode: "sw31aa", address: "10 Example Street, London",
  property_type: "flat", bedrooms: 1, bathrooms: 1, slot: "2026-10-10T09:00:00Z",
  duration_minutes: 120, frequency: "one_time", visits: 1,
};

test("spoken booking normalises details without trusting a price or customer identity", () => {
  const details = voiceBookingDetails({ ...input, total_gbp: 0.01, customer_id: "another-customer" });
  assert.equal(details.email, "caller@example.com");
  assert.equal(details.phone, "+447912345678");
  assert.equal(details.postcode, "SW3 1AA");
  assert.equal(details.slot, "2026-10-10T09:00:00.000Z");
  assert.ok(!("total_gbp" in details));
  assert.ok(!("customer_id" in details));
  assert.equal(voiceCheckoutBody(details, true).phone, "7912345678");
});

test("missing confirmation, malformed contact/home details and an invented time are refused", () => {
  for (const change of [
    { confirmed: false }, { confirmed: "true" }, { email: "wrong" }, { phone: "+919704334767" },
    { phone: "abc07912345678" }, { postcode: "London" }, { property_type: "castle" },
    { bedrooms: "1" }, { bathrooms: 0 }, { slot: "tomorrow" }, { slot: "2026-10-10T10:00:00" },
    { duration_minutes: "120" }, { visits: 4 },
  ]) assert.throws(() => voiceBookingDetails({ ...input, ...change }));
});

test("retries have stable identity; another call or changed details create another request", () => {
  const details = voiceBookingDetails(input);
  const key = voiceBookingFingerprint("agent", "call_12345678", details);
  assert.equal(key, voiceBookingFingerprint("agent", "call_12345678", voiceBookingDetails({ ...input, email: "caller@example.com", phone: "+447912345678" })));
  assert.notEqual(key, voiceBookingFingerprint("agent", "call_other", details));
  assert.notEqual(key, voiceBookingFingerprint("agent", "call_12345678", { ...details, address: "20 Example Street" }));
});

test("an opaque email link still requires the intended verified customer account", () => {
  const row = { email: "caller@example.com", customer_id: null };
  assert.equal(ownsVoiceBooking("CALLER@example.com", "confirmed", "user", row), true);
  assert.equal(ownsVoiceBooking("caller@example.com", undefined, "user", row), false);
  assert.equal(ownsVoiceBooking("stranger@example.com", "confirmed", "user", row), false);
  assert.equal(ownsVoiceBooking("caller@example.com", "confirmed", "user", { ...row, customer_id: "other" }), false);
});

test("caller-supplied email content is escaped", () => {
  assert.equal(escapeVoiceHtml('<img src=x onerror="x"> &'), "&lt;img src=x onerror=&quot;x&quot;&gt; &amp;");
});
