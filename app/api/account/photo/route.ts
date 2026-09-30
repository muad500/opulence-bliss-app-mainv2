import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { NextRequest, NextResponse } from "next/server";
import { accountContext, accountError, isAccountError, type AccountContext } from "@/lib/accountApi";
import { boundedFormData } from "@/lib/boundedFormData";

export const runtime = "nodejs";
const BUCKET = "profile-photos";
const MAX_BYTES = 4 * 1024 * 1024;

async function save(ctx: AccountContext, professional: boolean, path: string | null, origin: string) {
  const url = path && professional ? `${origin}/api/providers/${ctx.providerId}/photo` : null;
  const { data: previous, error } = await ctx.admin.rpc("replace_account_photo", {
    p_user_id: ctx.user.id, p_professional: professional, p_path: path, p_url: url,
  });
  if (error) throw new Error("Photo could not be saved.");
  if (previous && previous !== path) {
    const { error: removeError } = await ctx.admin.storage.from(BUCKET).remove([previous]);
    if (removeError) console.error("Old profile photo cleanup failed", removeError.message);
  }
}

export async function POST(request: NextRequest) {
  const ctx = await accountContext(request, { mutation: true });
  if (isAccountError(ctx)) return ctx;
  let path: string | null = null;
  try {
    const form = await boundedFormData(request, MAX_BYTES + 65536);
    const file = form?.get("file"); const scope = form?.get("scope");
    if (!form || !(file instanceof File) || !file.size || file.size > MAX_BYTES) return accountError("Choose a photo no larger than 4 MB.");
    if (scope !== "client" && scope !== "professional") return accountError("Choose a valid profile.");
    const professional = scope === "professional";
    if (professional && !ctx.providerId) return accountError("Professional profile not found.", 403);
    const input = Buffer.from(await file.arrayBuffer());
    const image = sharp(input, { limitInputPixels: 20000000, animated: false });
    const metadata = await image.metadata();
    if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format)) return accountError("Choose a JPEG, PNG or WebP photo.");
    // Re-encode to strip location/EXIF metadata and prevent SVG/script uploads.
    const output = await image.rotate().resize(512, 512, { fit: "cover", withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
    path = `${ctx.user.id}/${scope}/${randomUUID()}.webp`;
    const { error } = await ctx.admin.storage.from(BUCKET).upload(path, output, { contentType: "image/webp", upsert: false });
    if (error) throw new Error("Photo could not be uploaded.");
    await save(ctx, professional, path, request.nextUrl.origin);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (path) await ctx.admin.storage.from(BUCKET).remove([path]);
    return accountError(error instanceof Error && error.message.startsWith("Photo") ? error.message : "Choose a valid photo and try again.");
  }
}

export async function DELETE(request: NextRequest) {
  const ctx = await accountContext(request, { mutation: true });
  if (isAccountError(ctx)) return ctx;
  const scope = request.nextUrl.searchParams.get("scope");
  if (scope !== "client" && scope !== "professional") return accountError("Choose a valid profile.");
  if (scope === "professional" && !ctx.providerId) return accountError("Professional profile not found.", 403);
  try { await save(ctx, scope === "professional", null, request.nextUrl.origin); return NextResponse.json({ ok: true }); }
  catch { return accountError("Photo could not be removed.", 503); }
}
