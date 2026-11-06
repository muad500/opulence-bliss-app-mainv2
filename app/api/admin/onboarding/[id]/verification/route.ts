import { NextRequest, NextResponse } from "next/server";
import { adminApi } from "@/lib/adminApi";
import {
  isProviderDocumentType,
  PROVIDER_DOCUMENT_LABELS,
} from "@/lib/providerVerification";
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await adminApi(request, "staff");
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id))
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  let type: unknown;
  try {
    type = (await request.json()).type;
  } catch {}
  if (!isProviderDocumentType(type))
    return NextResponse.json(
      { error: "Choose a document type." },
      { status: 400 },
    );
  const opened = await ctx.client.rpc("staff_open_verification_record", {
    p_provider: id,
    p_type: type,
  });
  const headers = { "Cache-Control": "private, no-store" };
  if (opened.error || opened.data?.allowed !== true)
    return NextResponse.json(
      {
        error:
          "Only named onboarding staff with authenticator sign-in can open private records.",
      },
      { status: 403, headers },
    );
  const item = opened.data.record;
  if (!item)
    return NextResponse.json(
      {
        record: {
          type,
          label: PROVIDER_DOCUMENT_LABELS[type],
          status: "not submitted",
          uploadedAt: null,
          originalName: null,
          signedUrl: null,
          issuedAt: null,
          expiresAt: null,
          nextCheckAt: null,
          reference: null,
          reviewNote: null,
        },
      },
      { headers },
    );
  // Short-lived, staff-host file route rechecks and logs each deliberate view.
  return NextResponse.json(
    {
      record: {
        type,
        label: PROVIDER_DOCUMENT_LABELS[type],
        status: item.status,
        uploadedAt: item.uploaded_at,
        originalName: item.document_original_name,
        signedUrl: item.document_storage_path
          ? `/api/admin/onboarding/${id}/verification/file?type=${type}`
          : null,
        issuedAt: item.issued_at,
        expiresAt: item.expires_at,
        nextCheckAt: item.next_check_at,
        reference: item.reference,
        reviewNote: item.review_note,
        govCheckedOn: item.gov_uk_checked_on,
      },
    },
    { headers },
  );
}
