import assert from "node:assert/strict";
import test from "node:test";
import { effectiveReviewVisibility } from "./reviewVisibility";

test("a review of any rating is public when the reviewer chooses public", () => {
  assert.equal(effectiveReviewVisibility("public"), "public");
});

test("a reviewer can keep a review private", () => {
  assert.equal(effectiveReviewVisibility("private"), "private");
});

test("anything other than an explicit public request stays private", () => {
  assert.equal(effectiveReviewVisibility(undefined), "private");
  assert.equal(effectiveReviewVisibility(null), "private");
  assert.equal(effectiveReviewVisibility("PUBLIC"), "private");
  assert.equal(effectiveReviewVisibility("anything"), "private");
});
