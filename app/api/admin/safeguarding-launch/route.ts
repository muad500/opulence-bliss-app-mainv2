import { NextRequest, NextResponse } from "next/server";
import { adminApi } from "@/lib/adminApi";
import { safeguardingRegistration } from "@/lib/safeguardingRegistration";

export async function GET(request: NextRequest) {
  const ctx = await adminApi(request);
  if (ctx instanceof NextResponse) return ctx;
  try {
    return NextResponse.json(await safeguardingRegistration(ctx.admin), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Policy switch could not be checked." },
      { status: 503 },
    );
  }
}
export async function POST(request: NextRequest) {
  const ctx = await adminApi(request);
  if (ctx instanceof NextResponse) return ctx;
  try {
    const { enabled } = await request.json();
    if (typeof enabled !== "boolean") throw new Error("Choose on or off.");
    if (enabled) {
      const { data, error } = await ctx.admin
        .from("legal_documents")
        .select("version,content_html")
        .eq("slug", "safeguarding")
        .eq("published", true)
        .maybeSingle();
      if (error || !data?.version || !data.content_html?.trim())
        throw new Error(
          "Publish the Safeguarding Policy before enabling its signup tick box.",
        );
    }
    const { error } = await ctx.admin
      .from("professional_launch_controls")
      .update({
        safeguarding_enabled: enabled,
        updated_by: ctx.user.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", true);
    if (error) throw new Error("The policy switch could not be saved.");
    return NextResponse.json(await safeguardingRegistration(ctx.admin));
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The switch could not be saved.",
      },
      { status: 400 },
    );
  }
}
