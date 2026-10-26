import { NextRequest, NextResponse } from "next/server";
import { adminApi } from "@/lib/adminApi";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function POST(request: NextRequest) {
  const ctx = await adminApi(request);
  if (ctx instanceof NextResponse) return ctx;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Enter the record and reason." },
      { status: 400 },
    );
  }
  const { data, error } = await ctx.admin.rpc("admin_manage_retention_hold", {
    p_actor: ctx.user.id,
    p_hold:
      typeof body.resolveId === "string" && uuid.test(body.resolveId)
        ? body.resolveId
        : null,
    p_kind: typeof body.kind === "string" ? body.kind : "",
    p_record:
      typeof body.recordId === "string" && uuid.test(body.recordId)
        ? body.recordId
        : null,
    p_reason: typeof body.reason === "string" ? body.reason.trim() : "",
  });
  if (error)
    return NextResponse.json(
      {
        error:
          "The hold could not be changed. Check the record reference and reason.",
      },
      { status: 400 },
    );
  return NextResponse.json({ ok: true, id: data });
}
