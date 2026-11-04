import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { NextRequest, NextResponse } from "next/server";
import { accountContext, isAccountError } from "@/lib/accountApi";
import { quotePhotoKind } from "@/lib/quotePhotos";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await accountContext(req, {
    mutation: true,
    approvedProvider: true,
  });
  if (isAccountError(ctx)) return ctx;
  const { id } = await params;
  const { data: booking } = await ctx.admin
    .from("bookings")
    .select("provider_id,status")
    .eq("id", id)
    .maybeSingle();
  if (
    !booking ||
    booking.provider_id !== ctx.providerId ||
    !["scheduled", "in_progress"].includes(booking.status)
  )
    return NextResponse.json(
      {
        error:
          "Only the assigned cleaner can add work photos to an active visit.",
      },
      { status: 403 },
    );
  if (!req.headers.get("content-type")?.startsWith("multipart/form-data"))
    return NextResponse.json({ error: "Choose a photo." }, { status: 415 });
  try {
    const reader = req.body?.getReader();
    if (!reader) throw Error();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 3 * 1024 * 1024 + 65536) {
        await reader.cancel();
        throw Error();
      }
      chunks.push(part.value);
    }
    const body = await new Response(Buffer.concat(chunks), {
      headers: { "content-type": req.headers.get("content-type")! },
    }).formData();
    const file = body.get("file"),
      stage = body.get("stage");
    if (
      !(file instanceof File) ||
      !file.size ||
      file.size > 3 * 1024 * 1024 ||
      !["before", "after"].includes(String(stage))
    )
      throw Error();
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!quotePhotoKind(bytes)) throw Error();
    const photo = await sharp(bytes, {
      limitInputPixels: 16000000,
      animated: false,
    })
      .rotate()
      .resize({
        width: 1600,
        height: 1600,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 82 })
      .toBuffer();
    const path = `${id}/${randomUUID()}.jpg`;
    const uploaded = await ctx.admin.storage
      .from("cleaning-job-photos")
      .upload(path, photo, { contentType: "image/jpeg", upsert: false });
    if (uploaded.error) throw Error();
    const saved = await ctx.admin.rpc("add_cleaning_job_photo", {
      p_booking: id,
      p_user: ctx.user.id,
      p_stage: stage,
      p_path: path,
    });
    if (saved.error) {
      await ctx.admin.storage.from("cleaning-job-photos").remove([path]);
      throw Error();
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      {
        error:
          "Choose a JPEG, PNG or WebP photo up to 3 MB. At most six photos per stage.",
      },
      { status: 400 },
    );
  }
}
