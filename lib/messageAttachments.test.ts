import assert from "node:assert/strict";
import test from "node:test";
import { attachmentMimeType, normalizeMessageAttachments } from "./messageAttachments";

const attachment = { path: "booking/user/photo.jpg", name: "photo.jpg", mime_type: "image/jpeg" };

test("normalizes PostgREST one-to-one attachment objects", () => {
  assert.deepEqual(normalizeMessageAttachments(attachment), [attachment]);
  assert.deepEqual(normalizeMessageAttachments([attachment]), [attachment]);
  assert.deepEqual(normalizeMessageAttachments(null), []);
});

test("recognizes supported uploads when a browser omits the MIME type", () => {
  assert.equal(attachmentMimeType({ name: "visit.JPEG", type: "" }), "image/jpeg");
  assert.equal(attachmentMimeType({ name: "notes.pdf", type: "application/pdf" }), null);
  assert.equal(attachmentMimeType({ name: "video.mp4", type: "video/mp4" }), null);
});

test("PDFs are no longer accepted in the booking chat", () => {
  assert.equal(attachmentMimeType({ name: "invoice.pdf", type: "application/pdf" }), null);
  assert.equal(attachmentMimeType({ name: "invoice.pdf", type: "" }), null);
});
