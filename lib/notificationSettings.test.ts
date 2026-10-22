import test from "node:test";
import assert from "node:assert/strict";
import {
  notificationTypes,
  promptDue,
  uuidPattern,
  validNotificationPreference,
} from "./notificationSettings";
test("both audiences expose exactly the requested independent types", () => {
  assert.deepEqual(
    notificationTypes.customer.map((t) => t[0]),
    ["booking", "reminders", "messages", "status", "payments"],
  );
  assert.deepEqual(
    notificationTypes.professional.map((t) => t[0]),
    [
      "offers",
      "taken",
      "reminders",
      "messages",
      "schedule",
      "earnings",
      "checks",
    ],
  );
});
test("Not now suppresses re-prompting until the full 14-day window has passed", () => {
  const now = Date.parse("2026-10-22T12:00:00Z");
  const later = new Date(now + 14 * 86400000).toISOString();
  assert.equal(promptDue(later, now), false);
  assert.equal(promptDue(later, now + 14 * 86400000 - 1), false);
  assert.equal(promptDue(later, now + 14 * 86400000), true);
  assert.equal(promptDue(null, now), true);
  assert.equal(promptDue("corrupted", now), false);
});
test("preference mutation accepts only known types/channels and booleans", () => {
  for (const audience of ["customer", "professional"] as const)
    for (const [kind] of notificationTypes[audience])
      for (const channel of ["push", "email", "sms"])
        assert.equal(
          validNotificationPreference({
            audience,
            kind,
            channel,
            enabled: false,
          }),
          true,
        );
  for (const p of [
    null,
    {},
    { audience: "customer", kind: "offers", channel: "email", enabled: true },
    {
      audience: "professional",
      kind: "checks",
      channel: "email",
      enabled: "false",
    },
    {
      audience: "customer",
      kind: "messages",
      channel: "marketing",
      enabled: true,
    },
  ])
    assert.equal(validNotificationPreference(p), false);
});
test("device identifiers cannot be URLs or arbitrary lookup strings", () => {
  assert.equal(uuidPattern.test("50000000-0000-4000-8000-000000000001"), true);
  for (const value of [
    "https://evil.test",
    "1",
    "50000000-0000-0000-0000-000000000001",
  ])
    assert.equal(uuidPattern.test(value), false);
});
