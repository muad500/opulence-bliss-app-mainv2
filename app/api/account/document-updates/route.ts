import { isIP } from "node:net";
import { NextRequest, NextResponse } from "next/server";
import {
  accountContext,
  isAccountError,
  readAccountBody,
} from "@/lib/accountApi";
import { createClient } from "@/lib/supabase/server";
import { isAccountRole } from "@/lib/accountRoles";
import { handymanEnabled } from "@/lib/handymanMarketplace";

export async function POST(request: NextRequest) {
  const context = await accountContext(request, { mutation: true });
  if (isAccountError(context)) return context;
  const body = await readAccountBody(request);
  if (body instanceof NextResponse) return body;
  if (
    !isAccountRole(body.role) ||
    (body.role === "handyman" && !handymanEnabled()) ||
    typeof body.plan !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(body.plan) ||
    body.checked !== true
  )
    return NextResponse.json(
      { error: "Read the document and tick its acceptance box." },
      { status: 400 },
    );
  const client = await createClient();
  const membership = await client.rpc("my_account_roles");
  if (
    membership.error ||
    !membership.data?.some((item: { role: string }) => item.role === body.role)
  )
    return NextResponse.json({ error: "Role unavailable." }, { status: 403 });
  const forwarded =
    process.env.VERCEL === "1"
      ? request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim()
      : null;
  const result = await context.admin.rpc("accept_role_document_update", {
    p_user: context.user.id,
    p_role: body.role,
    p_plan: body.plan,
    p_checked: true,
    p_ip: forwarded && isIP(forwarded) ? forwarded : null,
    p_user_agent:
      request.headers
        .get("user-agent")
        ?.replace(/[\r\n\u0000]/g, " ")
        .slice(0, 500) ?? null,
  });
  return result.error
    ? NextResponse.json(
        { error: "This version could not be accepted. Reload and try again." },
        { status: 409 },
      )
    : NextResponse.json({ ok: true });
}
