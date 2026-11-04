import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { documentChangePdf } from "@/lib/documentChangePdf";
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return new NextResponse("Sign in required", { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id))
    return new NextResponse("Not found", { status: 404 });
  const { data, error } = await client.rpc("document_change_for_me", {
    p_plan: id,
  });
  const plan = data?.[0];
  if (error || !plan) return new NextResponse("Not found", { status: 404 });
  try {
    const bytes = await documentChangePdf(plan.pdf_path, plan.pdf_sha256);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="document-${plan.document_slug.replace(/[^a-z0-9-]/gi, "")}-v${plan.version.replace(/[^a-z0-9.-]/gi, "")}.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse("Approved PDF unavailable", { status: 503 });
  }
}
