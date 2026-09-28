export type ReviewVisibility = "public" | "private";
export type ReviewAuthor = "client" | "provider";

/**
 * The reviewer decides whether their review is public. The rating never
 * decides it: hiding negative reviews from public pages is a banned practice
 * under the Digital Markets, Competition and Consumers Act 2024. Anything other
 * than an explicit "public" request stays private.
 */
export function effectiveReviewVisibility(
  requested: string | null | undefined,
): ReviewVisibility {
  return requested === "public" ? "public" : "private";
}
