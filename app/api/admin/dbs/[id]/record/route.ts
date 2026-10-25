import { NextRequest, NextResponse } from "next/server";
import { adminApi } from "@/lib/adminApi";

// POST only: page rendering, browser prefetch, polling and HEAD cannot create
// a record-view event. Recheck named access + MFA on EVERY deliberate opening.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await adminApi(request);
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const headers = { "Cache-Control": "private, no-store, max-age=0" };
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    return NextResponse.json({ error: "Not found" }, { status: 404, headers });
  const { data, error } = await ctx.client.rpc("staff_view_dbs_record", {
    p_provider: id,
    p_action: "record_view",
  });
  if (error)
    return NextResponse.json(
      { error: "Named onboarding staff access required" },
      { status: 403, headers },
    );
  const row = data?.[0];
  return NextResponse.json(
    {
      record: row
        ? {
            certificateNumber: row.certificate_number,
            issueDate: row.issue_date,
            originalName: row.certificate_original_name,
            status: row.status,
            uploadedAt: row.uploaded_at,
            deletedAt: row.certificate_deleted_at,
            reviewNote: row.review_note,
            hasCertificate: !!row.uploaded_at && !!row.certificate_storage_path,
          }
        : null,
    },
    { headers },
  );
}
