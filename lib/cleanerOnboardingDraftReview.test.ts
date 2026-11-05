import test from "node:test";
import assert from "node:assert/strict";
import { cleanerOnboardingDraftReviewEnabled } from "./cleanerOnboardingDraftReview";
test("draft review works on isolated Preview without enabling applicant intake", () => {
  assert.equal(
    cleanerOnboardingDraftReviewEnabled({
      VERCEL_ENV: "preview",
      NEXT_PUBLIC_SUPABASE_URL: "https://comwdjprdedmsnxtvuuk.supabase.co",
    }),
    true,
  );
});
test("production, wrong projects and malformed addresses cannot expose the review", () => {
  const stage = {
    VERCEL_ENV: "preview",
    NEXT_PUBLIC_SUPABASE_URL: "https://comwdjprdedmsnxtvuuk.supabase.co",
  };
  for (const patch of [
    { VERCEL_ENV: "production" },
    { VERCEL_ENV: undefined },
    { NEXT_PUBLIC_SUPABASE_URL: "https://uiqcsihgqaktpjumyeap.supabase.co" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://auth.opulencebliss.com" },
    {
      NEXT_PUBLIC_SUPABASE_URL:
        "https://comwdjprdedmsnxtvuuk.supabase.co.attacker.invalid",
    },
    { NEXT_PUBLIC_SUPABASE_URL: "bad" },
  ])
    assert.equal(
      cleanerOnboardingDraftReviewEnabled({ ...stage, ...patch }),
      false,
    );
});
