import { test } from "node:test";
import assert from "node:assert/strict";
import { quotePhotoKind, QUOTE_MULTIPART_MAX_BYTES } from "./quotePhotos";
test("photo signatures exclude SVG, HTML and mislabeled files", () => {
  assert.equal(
    quotePhotoKind(new TextEncoder().encode("<svg onload='bad'>")),
    null,
  );
  assert.equal(quotePhotoKind(new Uint8Array([255, 216, 255, 0])), "jpeg");
  assert.equal(
    quotePhotoKind(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])),
    "png",
  );
  assert.ok(QUOTE_MULTIPART_MAX_BYTES < 4 * 1024 * 1024);
});
