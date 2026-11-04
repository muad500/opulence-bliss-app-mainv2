import test from "node:test";
import assert from "node:assert/strict";
import {
  customerNoticeReady,
  documentChangeAcceptance,
  documentChangeMail,
} from "./documentChangePolicy";
test("customer notice period starts at actual sending and includes exactly 30 days", () => {
  assert.equal(customerNoticeReady(null, "2026-12-05T12:00:00Z"), false);
  assert.equal(
    customerNoticeReady("2026-11-05T12:00:00Z", "2026-12-05T12:00:00Z"),
    true,
  );
  assert.equal(
    customerNoticeReady("2026-11-05T12:00:01Z", "2026-12-05T12:00:00Z"),
    false,
  );
  assert.equal(customerNoticeReady("invalid", "2026-12-05T12:00:00Z"), false);
});
test("C9/C29: acceptance names the exact document and version", () => {
  assert.equal(
    documentChangeAcceptance("Cleaner Agreement", "1.1"),
    "I have read and accept Cleaner Agreement (Version 1.1).",
  );
});
test("notice email includes approved summary, date, link and next-booking acceptance", () => {
  const text = documentChangeMail(
    {
      title: "Customer Terms",
      version: "1.1",
      summary: "TEST ONLY clearer wording.",
      effective_at: "2026-12-05T12:00:00Z",
    },
    "https://staging.example.invalid/account/document-changes/test",
  );
  for (const expected of [
    "Version 1.1",
    "5 December 2026",
    "TEST ONLY clearer wording.",
    "staging.example.invalid",
    "next book",
    "existing bookings keep their accepted terms",
  ])
    assert.ok(text.includes(expected), expected);
});
