import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { cleanerStage2Enabled } from "@/lib/cleanerApplication";
import { adminApi } from "@/lib/adminApi";
import {
  privateDocumentFile,
  privateDocumentForm,
} from "@/lib/privateDocumentUpload";
import { validDocumentDate } from "@/lib/providerVerification";
const headers = { "Cache-Control": "private, no-store" };
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!cleanerStage2Enabled())
    return NextResponse.json({ error: "Not found" }, { status: 404, headers });
  const ctx = await adminApi(request, "private_evidence");
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id))
    return NextResponse.json({ error: "Not found" }, { status: 404, headers });
  const opened = await ctx.client.rpc("staff_open_cleaner_application", {
    p_application: id,
    p_private: true,
  });
  if (
    opened.error ||
    opened.data?.accessDenied ||
    !opened.data?.application?.provider_id
  )
    return NextResponse.json(
      { error: "Named staff access to the passed applicant required." },
      { status: 403, headers },
    );
  const bucket = ctx.admin.storage.from("provider-verification");
  let path: string | null = null;
  try {
    const form = await privateDocumentForm(request);
    const type = String(form.get("type"));
    const note = String(form.get("note") ?? "").trim(),
      expires = String(form.get("expires") ?? "").trim();
    const cover = Number(form.get("cover"));
    if (
      ![
        "photo_id",
        "right_to_work",
        "proof_of_address",
        "public_liability_insurance",
      ].includes(type) ||
      note.length < 10 ||
      note.length > 2000 ||
      (expires && !validDocumentDate(expires)) ||
      (type === "public_liability_insurance" &&
        (!Number.isSafeInteger(cover) || cover < 1000000 || !expires))
    )
      throw Error();
    const file = await privateDocumentFile(form.get("file"));
    path = `${opened.data.application.provider_id}/${type}/${randomUUID()}.${file.extension}`;
    const uploaded = await bucket.upload(path, file.bytes, {
      contentType: file.mime,
      cacheControl: "0",
      upsert: false,
    });
    if (uploaded.error) throw Error();
    const saved = await ctx.client.rpc("staff_file_cleaner_evidence", {
      p_application: id,
      p_type: type,
      p_path: path,
      p_name: file.name,
      p_mime: file.mime,
      p_expires: expires || null,
      p_note: note,
      p_cover_pence: type === "public_liability_insurance" ? cover * 100 : null,
    });
    if (saved.error) throw Error();
    const previous = saved.data;
    path = null;
    if (previous) await bucket.remove([previous]);
    return NextResponse.json({ ok: true }, { headers });
  } catch {
    if (path) await bucket.remove([path]);
    return NextResponse.json(
      {
        error:
          "Evidence was not filed. Check the file, dates, cover, factual note and applicant stage.",
      },
      { status: 409, headers },
    );
  }
}
