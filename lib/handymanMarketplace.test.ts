import test from "node:test";
import assert from "node:assert/strict";
import {
  handymanReviewSummary,
  handymanEnabled,
  isHandymanMarketplacePath,
  regulatedHandymanDescription,
  validHandymanTask,
} from "./handymanMarketplace";
test("handyman marketplace requires an explicit environment switch", () => {
  assert.equal(handymanEnabled({}), false);
  assert.equal(
    handymanEnabled({ HANDYMAN_MARKETPLACE_ENABLED: "false" }),
    false,
  );
  assert.equal(handymanEnabled({ HANDYMAN_MARKETPLACE_ENABLED: "true" }), true);
});
test("disabled page gate covers nested marketplace pages while preserving the existing quote page", () => {
  assert.equal(isHandymanMarketplacePath("/handyman"), true);
  assert.equal(isHandymanMarketplacePath("/handyman/jobs/123"), true);
  assert.equal(isHandymanMarketplacePath("/services/handyman"), false);
  assert.equal(isHandymanMarketplacePath("/handymanager"), false);
  assert.equal(isHandymanMarketplacePath("/api/handyman/config"), false);
});
test("production cannot enable the quote marketplace accidentally", () => {
  assert.equal(
    handymanEnabled({
      HANDYMAN_MARKETPLACE_ENABLED: "true",
      VERCEL_ENV: "production",
    }),
    false,
  );
  assert.equal(
    handymanEnabled({
      HANDYMAN_MARKETPLACE_ENABLED: "true",
      APP_ENV: "production",
    }),
    false,
  );
});
test("only supported unregulated tasks can enter marketplace checkout", () => {
  assert.equal(validHandymanTask("Furniture assembly"), true);
  assert.equal(validHandymanTask("Electrical work"), false);
  assert.equal(
    regulatedHandymanDescription("Replace electrical sockets"),
    true,
  );
  assert.equal(regulatedHandymanDescription("Assemble a bookcase"), false);
});

test("private feedback contributes an anonymous score without leaking words or date", () => {
  const privateReview = {
      rating: 1,
      comment: "PRIVATE ONLY",
      is_public: false,
      reviewed_at: "2026-10-03T10:00:00Z",
    },
    publicReview = {
      rating: 5,
      comment: "Public words",
      is_public: true,
      reviewed_at: "2026-10-02T10:00:00Z",
    };
  const summary = handymanReviewSummary([privateReview, publicReview]);
  assert.equal(summary.rating, 3);
  assert.equal(summary.ratingCount, 2);
  assert.deepEqual(summary.publicReviews, [
    {
      rating: 5,
      comment: "Public words",
      reviewed_at: publicReview.reviewed_at,
    },
  ]);
  assert.ok(!JSON.stringify(summary).includes("PRIVATE ONLY"));
  assert.equal(handymanReviewSummary([]).rating, null);
});
