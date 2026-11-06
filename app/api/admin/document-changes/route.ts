import { NextRequest, NextResponse } from "next/server";
import { adminApi } from "@/lib/adminApi";
import { documentChangePdf } from "@/lib/documentChangePdf";
export async function POST(request: NextRequest) {
  const context = await adminApi(request);
  if (context instanceof NextResponse) return context;
  const raw = await request.text();
  if (raw.length > 550000)
    return NextResponse.json(
      { error: "Document is too large." },
      { status: 413 },
    );
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json(
      { error: "Invalid document details." },
      { status: 400 },
    );
  }
  if (
    !body ||
    typeof body !== "object" ||
    body.approved !== "yes" ||
    [
      "slug",
      "title",
      "version",
      "sourceContentHtml",
      "summary",
      "effectiveAt",
      "pdfPath",
      "pdfSha256",
    ].some((key) => typeof body[key] !== "string")
  )
    return NextResponse.json(
      { error: "Supply all approved document details." },
      { status: 400 },
    );
  const effectiveAt = String(body.effectiveAt);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(effectiveAt))
    return NextResponse.json(
      { error: "Choose an effective date and time in UTC." },
      { status: 400 },
    );
  try {
    await documentChangePdf(String(body.pdfPath), String(body.pdfSha256));
  } catch {
    return NextResponse.json(
      {
        error:
          "The approved PDF must be included in this build with its matching fingerprint.",
      },
      { status: 400 },
    );
  }
  const result = await context.client.rpc("announce_document_change", {
    p_document: {
      slug: body.slug,
      title: body.title,
      version: body.version,
      sourceContentHtml: body.sourceContentHtml,
      pdfPath: body.pdfPath,
      pdfSha256: body.pdfSha256,
    },
    p_summary: body.summary,
    p_effective_at: effectiveAt + ":00Z",
  });
  return result.error
    ? NextResponse.json({ error: result.error.message }, { status: 400 })
    : NextResponse.json({ ok: true, id: result.data }, { status: 201 });
}
