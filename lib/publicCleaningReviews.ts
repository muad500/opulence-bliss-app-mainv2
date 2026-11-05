import type { SupabaseClient } from "@supabase/supabase-js";

type PublicBookingReview = {
  id: string;
  reviewer: string;
  recipient_type: string;
  rating: number;
  comment: string | null;
  created_at: string;
};

/** The feed already enforces publication on the server. Never open the private
 * reviews table merely to display public cleaning feedback. */
export async function loadPublicCleaningBookingReviews(client: SupabaseClient) {
  const { data, error } = await client.rpc("public_reviews_feed", { p_limit: 60 });
  if (error) return [];
  return ((data ?? []) as PublicBookingReview[])
    .filter(
      (review) =>
        review.reviewer === "client" && review.recipient_type === "professional",
    )
    .slice(0, 6)
    .map(({ id, rating, comment, created_at }) => ({
      id,
      rating,
      comment,
      created_at,
    }));
}
