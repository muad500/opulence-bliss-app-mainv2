import { NextRequest, NextResponse } from "next/server";
import { adminApi } from "@/lib/adminApi";
import { isProviderDocumentType } from "@/lib/providerVerification";
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (
    request.headers.get("sec-purpose")?.includes("prefetch") ||
    request.headers.get("purpose") === "prefetch"
  )
    return new NextResponse(null, { status: 204 });
  const ctx = await adminApi(request, "staff");
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params,
    type = request.nextUrl.searchParams.get("type");
  if (!/^[0-9a-f-]{36}$/i.test(id) || !isProviderDocumentType(type))
    return new NextResponse("Not found", { status: 404 });
  const access = await ctx.client.rpc("staff_open_verification_record", {
    p_provider: id,
    p_type: type,
    p_action: "document_view",
  });
  if (access.error || access.data?.allowed !== true)
    return new NextResponse("Named onboarding access required", {
      status: 403,
    });
  const path = access.data.record?.document_storage_path;
  if (
    typeof path !== "string" ||
    !path.startsWith(`${id}/${type}/`) ||
    path.includes("\\") ||
    path
      .split("/")
      .some((segment) => !segment || segment === "." || segment === "..")
  )
    return new NextResponse("Document unavailable", { status: 404 });
  const file = await ctx.admin.storage
    .from("provider-verification")
    .download(path);
  if (file.error || !file.data)
    return new NextResponse("Document unavailable", { status: 404 });
  const mime = ["application/pdf", "image/jpeg", "image/png"].includes(
    file.data.type,
  )
    ? file.data.type
    : "application/octet-stream";
  return new NextResponse(await file.data.arrayBuffer(), {
    headers: {
      "Content-Type": mime,
      "Content-Disposition":
        mime === "application/octet-stream" ? "attachment" : "inline",
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
    },
  });
}
export function HEAD() {
  return new NextResponse(null, { status: 405, headers: { Allow: "GET" } });
}
