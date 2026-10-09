import { NextRequest, NextResponse } from "next/server";
import {
  accountContext,
  accountError,
  isAccountError,
  readAccountBody,
} from "@/lib/accountApi";
import { handymanEnabled } from "@/lib/handymanMarketplace";
import { isProfessionalService } from "@/lib/professionalServices";

export async function POST(request: NextRequest) {
  const context = await accountContext(request, {
    provider: true,
    mutation: true,
  });
  if (isAccountError(context)) return context;
  const body = await readAccountBody(request);
  if (body instanceof NextResponse) return body;
  if (
    !isProfessionalService(body.service) ||
    (body.service === "handyman" && !handymanEnabled())
  ) {
    return accountError("This service is not available.", 404);
  }
  const { error } = await context.admin.rpc("request_professional_service", {
    p_user: context.user.id,
    p_service: body.service,
  });
  if (error)
    return accountError("The service application could not be saved.", 503);
  return NextResponse.json({ ok: true, next: "/worker/profile#services" });
}
