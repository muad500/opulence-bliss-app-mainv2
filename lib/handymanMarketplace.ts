export const HANDYMAN_TASKS = [
  "Mounting and hanging",
  "Furniture assembly",
  "Minor repairs",
  "Curtains and blinds",
  "Furniture moving",
  "Minor decorating",
] as const;
/** Keep saved task identifiers stable while presenting the current service name. */
export function handymanTaskLabel(task: string) {
  return task === "Minor decorating" ? "Painting & decoration" : task;
}
export function handymanEnabled(
  env: Record<string, string | undefined> = process.env,
) {
  return (
    env.VERCEL_ENV !== "production" &&
    env.APP_ENV !== "production" &&
    env.HANDYMAN_MARKETPLACE_ENABLED === "true"
  );
}
export function isHandymanMarketplacePath(path: string) {
  return path === "/handyman" || path.startsWith("/handyman/");
}
export function validHandymanTask(
  task: unknown,
): task is (typeof HANDYMAN_TASKS)[number] {
  return (
    typeof task === "string" &&
    (HANDYMAN_TASKS as readonly string[]).includes(task)
  );
}
export function regulatedHandymanDescription(text: string) {
  return /\b(gas|boiler|electrical|electrics|wiring|rewir\w*|circuit\w*|socket\w*|consumer unit|asbestos|structural|load.bearing|plumbing installation)\b/i.test(
    text,
  );
}
export type HandymanReview = {
  rating: number;
  comment: string | null;
  is_public: boolean;
  reviewed_at: string;
};
export function handymanReviewSummary(reviews: HandymanReview[]) {
  return {
    ratingCount: reviews.length,
    rating: reviews.length
      ? reviews.reduce((n, r) => n + r.rating, 0) / reviews.length
      : null,
    publicReviews: reviews
      .filter((r) => r.is_public)
      .sort((a, b) => b.reviewed_at.localeCompare(a.reviewed_at))
      .slice(0, 10)
      .map(({ rating, comment, reviewed_at }) => ({
        rating,
        comment,
        reviewed_at,
      })),
  };
}
