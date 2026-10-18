import test from "node:test";
import assert from "node:assert/strict";
import { visitAddressVisible, visitMessagingOpen } from "./visitContactPolicy";
const start = "2026-11-10T10:00:00Z",
  left = "2026-11-10T12:35:00Z",
  at = (s: string) => Date.parse(s);
test("messages require acceptance, never just an open offer", () => {
  assert.equal(
    visitMessagingOpen("offered", false, start, 120, null, at(start)),
    false,
  );
  assert.equal(
    visitMessagingOpen("scheduled", true, start, 120, null, at(start)),
    true,
  );
  assert.equal(
    visitMessagingOpen("cancelled", true, start, 120, null, at(start)),
    false,
  );
});
test("chat closes exactly 24 hours after actual checkout", () => {
  assert.equal(
    visitMessagingOpen(
      "completed",
      true,
      start,
      120,
      left,
      at("2026-11-11T12:34:59Z"),
    ),
    true,
  );
  assert.equal(
    visitMessagingOpen(
      "completed",
      true,
      start,
      120,
      left,
      at("2026-11-11T12:35:00Z"),
    ),
    false,
  );
});
test("completed jobs and the scheduled end never disclose a historical address", () => {
  assert.equal(
    visitAddressVisible("completed", start, 120, left, at(left)),
    false,
  );
  assert.equal(
    visitAddressVisible(
      "scheduled",
      start,
      120,
      null,
      at("2026-11-10T12:00:00Z"),
    ),
    false,
  );
  assert.equal(
    visitAddressVisible(
      "scheduled",
      start,
      120,
      null,
      at("2026-11-10T11:59:59Z"),
    ),
    true,
  );
});
