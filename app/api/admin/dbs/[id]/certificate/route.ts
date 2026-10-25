import { NextRequest, NextResponse } from "next/server";
import { adminApi } from "@/lib/adminApi";

// Never expose a reusable signed Storage URL. Each request rechecks named
// access/MFA, logs the view, then streams the file with no browser/proxy cache.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (
    request.headers.get("sec-purpose")?.includes("prefetch") ||
    request.headers.get("purpose") === "prefetch"
  )
    return new NextResponse(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
  const ctx = await adminApi(request);
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id))
    return new NextResponse("Not found", { status: 404 });
  const { data, error } = await ctx.client.rpc("staff_view_dbs_record", {
    p_provider: id,
    p_action: "certificate_view",
  });
  if (error)
    return new NextResponse("Named onboarding staff access required", {
      status: 403,
    });
  const record = data?.[0];
  if (!record?.certificate_storage_path)
    return new NextResponse("Certificate copy is no longer held", {
      status: 404,
    });
  const file = await ctx.admin.storage
    .from("provider-dbs")
    .download(record.certificate_storage_path);
  if (file.error || !file.data)
    return new NextResponse("Certificate unavailable", { status: 404 });
  return new NextResponse(await file.data.arrayBuffer(), {
    headers: {
      "Content-Type": record.certificate_mime_type,
      "Content-Disposition": 'inline; filename="dbs-certificate"',
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
    },
  });
}

// A browser/link checker may probe a file without opening it. Never audit
// HEAD as a human certificate view or send certificate bytes in response.
export function HEAD() {
  return new NextResponse(null, {
    status: 405,
    headers: { Allow: "GET", "Cache-Control": "no-store" },
  });
}
