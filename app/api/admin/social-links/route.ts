import { NextRequest, NextResponse } from "next/server";
import { adminApi } from "@/lib/adminApi";
import {
  parseSocialLinks,
  socialLinksFromRows,
  SOCIAL_PLATFORMS,
} from "@/lib/socialLinks";

export async function GET(request: NextRequest) {
  const context = await adminApi(request);
  if (context instanceof NextResponse) return context;
  const { data, error } = await context.admin
    .from("site_social_links")
    .select("platform,url");
  if (error)
    return NextResponse.json(
      {
        error:
          "Social links could not be loaded. Please check the social links migration is installed.",
      },
      { status: 503 },
    );
  return NextResponse.json(
    { links: socialLinksFromRows(data ?? []) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const context = await adminApi(request);
  if (context instanceof NextResponse) return context;
  let links;
  try {
    links = parseSocialLinks((await request.json()).links);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Check the social links.",
      },
      { status: 400 },
    );
  }
  const { error } = await context.admin.from("site_social_links").upsert(
    SOCIAL_PLATFORMS.map((platform) => ({
      platform,
      url: links[platform] || null,
      updated_by: context.user.id,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: "platform" },
  );
  if (error)
    return NextResponse.json(
      { error: "Social links could not be saved. Please try again." },
      { status: 503 },
    );
  return NextResponse.json({ links });
}
