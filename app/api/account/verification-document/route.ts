import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { accountContext, accountError, isAccountError } from "@/lib/accountApi";
import {
  isProviderDocumentType, PROVIDER_DOCUMENT_LABELS, validDocumentDate,
} from "@/lib/providerVerification";
import { isDbsCertificateNumber, isDbsIssueDate } from "@/lib/providerDbs";

const BUCKET = "provider-verification";
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_MULTIPART_BYTES = MAX_BYTES + 65536;

async function boundedFormData(request: NextRequest, contentType: string): Promise<FormData | null> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_MULTIPART_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Response(body, { headers: { "content-type": contentType } }).formData();
}

function fileKind(bytes: Uint8Array): { mime: string; extension: string } | null {
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) {
    return { mime: "application/pdf", extension: "pdf" };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: "image/jpeg", extension: "jpg" };
  }
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte)) {
    return { mime: "image/png", extension: "png" };
  }
  return null;
}

export async function POST(request: NextRequest) {
  const ctx = await accountContext(request, { provider: true, mutation: true });
  if (isAccountError(ctx)) return ctx;
  const contentType = request.headers.get("content-type");
  if (!contentType?.startsWith("multipart/form-data")) {
    return accountError("Choose a PDF, JPEG or PNG document.", 415);
  }
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_MULTIPART_BYTES) return accountError("Choose a file no larger than 4 MB.", 413);

  try {
    const form = await boundedFormData(request, contentType);
    if (!form) return accountError("Choose a file no larger than 4 MB.", 413);
    const type = form.get("type");
    const file = form.get("file");
    if (!isProviderDocumentType(type) && type !== "dbs") return accountError("Choose a supported document type.");
    const reference = String(form.get("reference") ?? "").trim().toUpperCase().replace(/\s/g, "");
    if(type==='right_to_work'&&reference&&(!(file instanceof File)||file.size===0)){
      if(!/^[A-Z0-9]{9}$/.test(reference))return accountError('Enter a valid 9-character share code.');
      const {data:previous,error}=await ctx.admin.rpc('submit_rtw_share_code',{p_provider_id:ctx.providerId,p_code:reference});
      if(error)return accountError('Share code could not be submitted.',503);
      if(previous)await ctx.admin.storage.from(BUCKET).remove([previous]);
      return NextResponse.json({ok:true,status:'pending'});
    }
    if (!(file instanceof File) || file.size === 0 || file.size > MAX_BYTES) {
      return accountError("Choose a file no larger than 4 MB.");
    }

    const issuedAt = String(form.get("issuedAt") ?? "").trim();
    const expiresAt = String(form.get("expiresAt") ?? "").trim();
    const today = new Date().toISOString().slice(0, 10);
    if (type === "right_to_work" && reference && !/^[A-Z0-9]{9}$/.test(reference)) return accountError("Enter a valid 9-character share code, or leave it blank and provide your visa document.");
    if (type === "dbs" && (!/^\d{12}$/.test(reference) || !isDbsCertificateNumber(reference) || !isDbsIssueDate(issuedAt))) return accountError("Enter the 12-digit DBS certificate number and issue date.");
    if ((issuedAt && (!validDocumentDate(issuedAt) || issuedAt > today)) ||
        (expiresAt && (!validDocumentDate(expiresAt) || expiresAt < today)) ||
        (issuedAt && expiresAt && expiresAt < issuedAt)) {
      return accountError("Check the document issue and expiry dates.");
    }
    if (type === "public_liability_insurance" && !expiresAt) {
      return accountError("Enter the insurance expiry date.");
    }
    if (type === "trade_certificate") {
      const { data: provider, error } = await ctx.admin.from("providers")
        .select("services").eq("id", ctx.providerId!).single();
      if (error || !provider?.services?.includes("handyman")) {
        return accountError("Trade certificates are available for handyman profiles.", 403);
      }
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const kind = fileKind(bytes);
    if (!kind) return accountError("The file must be a PDF, JPEG or PNG document.");

    const bucket = type === "dbs" ? "provider-dbs" : BUCKET;
    const path = `${ctx.providerId}/${type}/${randomUUID()}.${kind.extension}`;
    const { error: uploadError } = await ctx.admin.storage.from(bucket).upload(path, bytes, {
      contentType: kind.mime,
      cacheControl: "0",
      upsert: false,
    });
    if (uploadError) return accountError("Document could not be uploaded. Please try again.", 503);

    const originalName = file.name.replace(/[\\/\x00-\x1f\x7f]/g, " ").trim().slice(0, 240) || "document";
    const { data: previousPath, error: recordError } = type === "dbs" ? await ctx.admin.rpc("replace_provider_dbs_certificate", {
      p_provider_id: ctx.providerId!, p_number: reference, p_issue_date: issuedAt,
      p_path: path, p_name: originalName, p_mime: kind.mime,
    }) : await ctx.admin.rpc("replace_provider_verification_document", {
      p_provider_id: ctx.providerId!,
      p_document_type: type,
      p_label: PROVIDER_DOCUMENT_LABELS[type],
      p_document_storage_path: path,
      p_document_original_name: originalName,
      p_document_mime_type: kind.mime,
      p_issued_at: issuedAt || null,
      p_expires_at: expiresAt || null,
      p_reference: type === "right_to_work" ? reference || null : null,
    });
    if (recordError) {
      await ctx.admin.storage.from(bucket).remove([path]);
      return accountError("Document record could not be saved. Please try again.", 503);
    }
    if (previousPath && previousPath !== path) {
      const { error: removeError } = await ctx.admin.storage.from(bucket)
        .remove([previousPath]);
      if (removeError) console.error("Could not remove a replaced provider verification document", removeError);
    }
    return NextResponse.json({ ok: true, status: "pending" });
  } catch {
    return accountError("Document could not be uploaded. Please try again.", 400);
  }
}

export async function GET(request: NextRequest) {
  const ctx = await accountContext(request, { provider: true });
  if (isAccountError(ctx)) return ctx;
  const type = request.nextUrl.searchParams.get("type");
  if (!isProviderDocumentType(type)) return accountError("Choose a supported document type.");
  const { data: record, error } = await ctx.admin.from("provider_verification_items")
    .select("document_storage_path")
    .eq("provider_id", ctx.providerId!)
    .eq("document_type", type)
    .maybeSingle();
  if (error) return accountError("Document could not be loaded.", 503);
  if (!record?.document_storage_path) return accountError("Document not found.", 404);
  const { data, error: signedError } = await ctx.admin.storage.from(BUCKET)
    .createSignedUrl(record.document_storage_path, 60);
  if (signedError || !data?.signedUrl) return accountError("Document could not be opened.", 503);
  return NextResponse.redirect(data.signedUrl, { headers: { "Cache-Control": "private, no-store" } });
}
