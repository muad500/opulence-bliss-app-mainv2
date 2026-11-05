import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadPublicCleaningBookingReviews } from "./publicCleaningReviews";

const row = (index: number, rating = 5) => ({
  id: `TEST-public-${index}`,
  reviewer: "client",
  recipient_type: "professional",
  rating,
  comment: "TEST ONLY public feedback",
  created_at: "2026-11-05T00:00:00Z",
  recipient_name: "not needed by the cleaning card",
});
function client(data: unknown, error: unknown = null) {
  return {
    rpc: async (name: string, args: unknown) => {
      assert.equal(name, "public_reviews_feed");
      assert.deepEqual(args, { p_limit: 60 });
      return { data, error };
    },
    from: () => assert.fail("Private review tables must not be queried"),
  } as unknown as SupabaseClient;
}
test("uses only the existing public feed and returns a field whitelist", async () => {
  const result = await loadPublicCleaningBookingReviews(client([row(1)]));
  assert.deepEqual(Object.keys(result[0]), ["id", "rating", "comment", "created_at"]);
  assert.equal(result[0].id, "TEST-public-1");
});
test("keeps negative public reviews rather than suppressing them", async () => {
  const result = await loadPublicCleaningBookingReviews(client([row(1, 1), row(2, 3)]));
  assert.deepEqual(result.map((review) => review.rating), [1, 3]);
});
test("never renders professional-to-customer feedback", async () => {
  const result = await loadPublicCleaningBookingReviews(client([
    { ...row(0), reviewer: "provider", recipient_type: "client" }, row(1),
  ]));
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "TEST-public-1");
});
test("renders at most six reviews in feed order", async () => {
  const result = await loadPublicCleaningBookingReviews(client(Array.from({ length: 10 }, (_, i) => row(i))));
  assert.equal(result.length, 6);
  assert.equal(result[5].id, "TEST-public-5");
});
test("empty or failed feed has no private fallback", async () => {
  assert.deepEqual(await loadPublicCleaningBookingReviews(client(null)), []);
  assert.deepEqual(await loadPublicCleaningBookingReviews(client([row(1)], { message: "TEST error" })), []);
});
