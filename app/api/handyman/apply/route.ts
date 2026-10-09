// Compatibility endpoint. Shared details are completed once through provider signup.
import { NextRequest, NextResponse } from "next/server";
import { accountContext, accountError, isAccountError } from "@/lib/accountApi";
import { handymanEnabled } from "@/lib/handymanMarketplace";
export async function POST(request: NextRequest) {
  if (!handymanEnabled()) return accountError("Not found.", 404);
  const context = await accountContext(request, {
    provider: true,
    mutation: true,
  });
  if (isAccountError(context)) return context;
  const { data: providerId, error } = await context.admin.rpc(
    "apply_handyman_trade",
    { p_user: context.user.id, p_details: {} },
  );
  if (error) return accountError("Application could not be saved.", 503);
  return NextResponse.json({
    providerId,
    status: "pending",
    next: "/worker/profile#services",
  });
}
