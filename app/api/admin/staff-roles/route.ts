import { NextRequest, NextResponse } from "next/server";
import { adminApi } from "@/lib/adminApi";
import { isStaffRole } from "@/lib/staffPermissions";
import { readAccountBody } from "@/lib/accountApi";
export async function POST(request: NextRequest) {
  const context = await adminApi(request);
  if (context instanceof NextResponse) return context;
  const body = await readAccountBody(request);
  if (body instanceof NextResponse) return body;
  if (
    typeof body.profile !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(body.profile) ||
    !isStaffRole(body.role) ||
    typeof body.active !== "boolean" ||
    typeof body.reason !== "string" ||
    body.reason.trim().length < 10 ||
    body.reason.length > 1000
  )
    return NextResponse.json(
      { error: "Choose a named account, role and reason." },
      { status: 400 },
    );
  const result = await context.client.rpc("assign_staff_role", {
    p_profile: body.profile,
    p_role: body.role,
    p_active: body.active,
    p_reason: body.reason,
  });
  return result.error
    ? NextResponse.json(
        {
          error:
            "Access could not be saved. You cannot change your own access.",
        },
        { status: 403 },
      )
    : NextResponse.json({ ok: true });
}
