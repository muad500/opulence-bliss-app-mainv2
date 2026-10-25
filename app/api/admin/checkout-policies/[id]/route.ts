import { NextRequest, NextResponse } from "next/server";
import { adminApi } from "@/lib/adminApi";
import {
  checkoutPolicyDownload,
  checkoutPolicyHeaders,
  loadCheckoutPolicyCopy,
  policyCopyId,
} from "@/lib/checkoutPolicyCopy";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await adminApi(request);
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  if (!policyCopyId(id))
    return NextResponse.json(
      { error: "Checkout policy copy not found" },
      { status: 404, headers: checkoutPolicyHeaders },
    );
  try {
    const copy = await loadCheckoutPolicyCopy(ctx.admin, id);
    if (!copy)
      return NextResponse.json(
        { error: "Checkout policy copy not found" },
        { status: 404, headers: checkoutPolicyHeaders },
      );
    return checkoutPolicyDownload(request, copy);
  } catch {
    return NextResponse.json(
      { error: "Checkout policy copies are temporarily unavailable" },
      { status: 503, headers: checkoutPolicyHeaders },
    );
  }
}
