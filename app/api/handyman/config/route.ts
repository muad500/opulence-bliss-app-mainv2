import { NextResponse } from "next/server";
import { handymanEnabled } from "@/lib/handymanMarketplace";
import { privatePortalClient } from "@/lib/professionalPortal";
export async function GET() {
  if (!handymanEnabled())
    return NextResponse.json(
      { enabled: false },
      { headers: { "Cache-Control": "no-store" } },
    );
  const admin = privatePortalClient();
  const { data, error } = await admin
    .from("handyman_categories")
    .select("name,position")
    .order("position");
  if (error)
    return NextResponse.json(
      { error: "Services could not be loaded." },
      { status: 503 },
    );
  const categories: string[] = [];
  for (const row of data ?? []) {
    const { data: open, error } = await admin.rpc("handyman_category_open", {
      p_task: row.name,
    });
    if (error)
      return NextResponse.json(
        { error: "Services could not be loaded." },
        { status: 503 },
      );
    if (open) categories.push(row.name);
  }
  return NextResponse.json(
    { enabled: true, categories },
    { headers: { "Cache-Control": "no-store" } },
  );
}
