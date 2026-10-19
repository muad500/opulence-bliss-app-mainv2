import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { handymanContext, isAccountError } from "@/lib/handymanServer";
import { accessibleQuoteJob } from "@/lib/handymanQuoteServer";
import sharp from "sharp";
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await handymanContext(req, true);
  if (isAccountError(ctx)) return ctx;
  const { id } = await params;
  const job = await accessibleQuoteJob(
    ctx.admin,
    id,
    ctx.user.id,
    ctx.providerId,
  );
  if (!job)
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  if (
    job.customer_id !== ctx.user.id ||
    !["draft", "posted"].includes(job.status)
  )
    return NextResponse.json(
      { error: "Only the customer can attach photos to an open request." },
      { status: 403 },
    );
  if (
    !req.headers.get("content-type")?.startsWith("multipart/form-data") ||
    Number(req.headers.get("content-length")) > 4259840
  )
    return NextResponse.json(
      { error: "Choose a file up to 4 MB." },
      { status: 413 },
    );
  const reader = req.body?.getReader();
  if (!reader)
    return NextResponse.json({ error: "Choose a file." }, { status: 400 });
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const r = await reader.read();
    if (r.done) break;
    length += r.value.length;
    if (length > 4259840) {
      await reader.cancel();
      return NextResponse.json(
        { error: "Choose a file up to 4 MB." },
        { status: 413 },
      );
    }
    chunks.push(r.value);
  }
  try {
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.length;
    }
    const form = await new Response(bytes, {
        headers: { "content-type": req.headers.get("content-type")! },
      }).formData(),
      file = form.get("file"),
      kind = form.get("kind"),
      amount = null;
    if (
      !(file instanceof File) ||
      file.size === 0 ||
      file.size > 4194304 ||
      kind !== "photo"
    )
      throw Error();
    const data = new Uint8Array(await file.arrayBuffer());
    const png = [137, 80, 78, 71, 13, 10, 26, 10].every(
        (v, i) => data[i] === v,
      ),
      jpeg = data[0] === 255 && data[1] === 216 && data[2] === 255,
      pdf = Buffer.from(data.subarray(0, 5)).toString() === "%PDF-";
    const mime = png
      ? "image/png"
      : jpeg
        ? "image/jpeg"
        : pdf
          ? "application/pdf"
          : null;
    if (!mime || (kind === "photo" && pdf)) throw Error();
    // Decode the photo, bound dimensions and strip EXIF (including GPS).
    const photo = await sharp(data, {
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
    const path = id + "/" + randomUUID() + ".jpg";
    const { error: uploadError } = await ctx.admin.storage
      .from("handyman-job-files")
      .upload(path, photo, { contentType: "image/jpeg", upsert: false });
    if (uploadError) throw Error();
    const { error } = await ctx.admin.rpc("add_handyman_file", {
      p_job: id,
      p_user: ctx.user.id,
      p_kind: kind,
      p_path: path,
      p_name: file.name.replace(/[\\/\x00-\x1f]/g, " ").slice(0, 200),
      p_mime: "image/jpeg",
      p_amount: amount,
    });
    if (error) {
      await ctx.admin.storage.from("handyman-job-files").remove([path]);
      return NextResponse.json(
        { error: "You cannot add this file at the current stage of the job." },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      {
        error: "Choose a valid JPEG or PNG photo, up to 4 MB.",
      },
      { status: 400 },
    );
  }
}
