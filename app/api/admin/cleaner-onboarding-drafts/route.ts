import { NextRequest, NextResponse } from "next/server";
import { adminApi } from "@/lib/adminApi";
import { cleanerOnboardingDraftReviewEnabled } from "@/lib/cleanerOnboardingDraftReview";
import { cleanerOnboardingDraftCatalog } from "@/lib/cleanerOnboardingDraftsServer";
import { renderCleanerOnboardingReview } from "@/lib/cleanerOnboardingDraftFormat";

export async function GET(request: NextRequest) {
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (!cleanerOnboardingDraftReviewEnabled())
    return NextResponse.json({ error: "Not found" }, { status: 404, headers });
  const ctx = await adminApi(request, "onboarding");
  if (ctx instanceof NextResponse) return ctx;
  return new NextResponse(
    renderCleanerOnboardingReview(cleanerOnboardingDraftCatalog()),
    {
      headers: {
        ...headers,
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition":
          'attachment; filename="opulence-bliss-cleaner-onboarding-drafts.md"',
      },
    },
  );
}
