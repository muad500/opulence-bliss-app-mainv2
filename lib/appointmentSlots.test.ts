import test from "node:test";
import assert from "node:assert/strict";
import { permittedAppointmentSlots } from "./appointmentSlots";
test("an eight-hour appointment has no late starts that run past 8pm", () => {
  const { slots } = permittedAppointmentSlots(
    480,
    Date.parse("2026-10-04T09:00:00Z"),
  );
  assert.ok(slots.includes("2026-10-05T11:00:00.000Z"));
  assert.ok(!slots.includes("2026-10-05T11:30:00.000Z"));
});
