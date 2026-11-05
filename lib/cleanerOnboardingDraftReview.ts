/** Read-only staff draft review does not enable the applicant/assessment flow. */
export function cleanerOnboardingDraftReviewEnabled(
  env: Record<string, string | undefined> = process.env,
) {
  if (env.VERCEL_ENV !== "preview") return false;
  try {
    return (
      new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname ===
      "comwdjprdedmsnxtvuuk.supabase.co"
    );
  } catch {
    return false;
  }
}
