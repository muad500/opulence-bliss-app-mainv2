"use server";

import { createClient as createAdminClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { requireAdminPage } from "@/lib/adminSession";
import {
  isProviderDocumentType, PROVIDER_DOCUMENT_LABELS, validDocumentDate,
} from "@/lib/providerVerification";

export async function reviewProviderDocument(
  providerId: string,
  documentType: string,
  expectedUploadedAt: string,
  decision: "verified" | "rejected",
  form: FormData,
) {
  const { user } = await requireAdminPage();
  if (!isProviderDocumentType(documentType)) throw new Error("Unsupported document type.");
  if (decision !== "verified" && decision !== "rejected") throw new Error("Unsupported review decision.");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Verification service is unavailable.");
  const admin = createAdminClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: record, error: readError } = await admin.from("provider_verification_items")
    .select("document_storage_path,uploaded_at,status,reference")
    .eq("provider_id", providerId)
    .eq("document_type", documentType)
    .maybeSingle();
  if (readError) throw new Error("Document record could not be loaded.");
  const codeOnly=documentType==='right_to_work'&&!!record?.reference&&/^[A-Z0-9]{9}$/.test(record.reference);
  if (!record || (!record.document_storage_path&&!codeOnly) || !record.uploaded_at || (record.status !== "pending" && !(documentType==='right_to_work'&&['verified','expired'].includes(record.status)))) {
    throw new Error("This document is no longer awaiting review.");
  }
  if (record.uploaded_at !== expectedUploadedAt) {
    throw new Error("A newer document was uploaded. Reload this page before reviewing it.");
  }
  if(record.document_storage_path){
  const pathPrefix = `${providerId}/${documentType}/`;
  if (!record.document_storage_path.startsWith(pathPrefix)) {
    throw new Error("The document path is invalid.");
  }
  const pathParts = record.document_storage_path.split("/");
  const fileName = pathParts.pop();
  const folder = pathParts.join("/");
  const { data: files, error: storageError } = await admin.storage.from("provider-verification")
    .list(folder, { search: fileName, limit: 10 });
  if (storageError || !fileName || !files?.some((file) => file.name === fileName)) {
    throw new Error("The uploaded document could not be found.");
  }
  }

  const issuedAt = String(form.get("issuedAt") ?? "").trim();
  const expiresAt = String(form.get("expiresAt") ?? "").trim();
  const nextCheckAt = String(form.get("nextCheckAt") ?? "").trim();
  const reference = String(form.get("reference") ?? "").trim();
  const govCheckedOn=String(form.get('govCheckedOn')??'').trim();
  const note = String(form.get("note") ?? "").trim();
  const today = new Date().toISOString().slice(0, 10);
  if(documentType==='right_to_work'&&decision==='verified'&&(!govCheckedOn||!validDocumentDate(govCheckedOn)||govCheckedOn>today))throw new Error('Record the date you completed the GOV.UK right-to-work check.');
  if ((issuedAt && (!validDocumentDate(issuedAt) || issuedAt > today)) ||
      (expiresAt && (!validDocumentDate(expiresAt) || (decision === "verified" && expiresAt < today))) ||
      (nextCheckAt && (!validDocumentDate(nextCheckAt) || (decision === "verified" && nextCheckAt < today))) ||
      (issuedAt && expiresAt && expiresAt < issuedAt)) {
    throw new Error("Check the issue, expiry and re-check dates.");
  }
  if (decision === "verified" && documentType === "public_liability_insurance" && !expiresAt) {
    throw new Error("Record the insurance expiry date before verifying it.");
  }
  if (reference.length > 120 || note.length > 500) {
    throw new Error("Keep the reference under 120 characters and note under 500 characters.");
  }
  if (decision === "rejected" && !note) {
    throw new Error("Explain why this document needs to be replaced.");
  }

  const { data: updated, error: updateError } = await admin.from("provider_verification_items")
    .update({
      status: decision,
      reference: reference || null,
      issued_at: issuedAt || null,
      expires_at: expiresAt || null,
      next_check_at: nextCheckAt || null,
      review_note: note || null,
      reviewed_by: user.id,
      checked_at: new Date().toISOString(),
      ...(documentType==='right_to_work'?{gov_uk_checked_on:govCheckedOn||null}:{}),
      updated_at: new Date().toISOString(),
    })
    .eq("provider_id", providerId)
    .eq("document_type", documentType)
    .eq("uploaded_at", expectedUploadedAt)
    .eq("status", record.status)
    .select("id")
    .maybeSingle();
  if (updateError) throw new Error("Document review could not be saved.");
  if (!updated) throw new Error("A newer review or upload was saved. Reload the page.");

  const { data: provider } = await admin.from("providers")
    .select("profile_id").eq("id", providerId).maybeSingle();
  if (provider?.profile_id) {
    const title = decision === "verified"
      ? `${PROVIDER_DOCUMENT_LABELS[documentType]} verified`
      : `${PROVIDER_DOCUMENT_LABELS[documentType]} needs attention`;
    const body = decision === "verified"
      ? "Your document has been reviewed and verified."
      : `Please replace this document.${note ? ` Review note: ${note}` : ""}`;
    const { error: notificationError } = await admin.from("notifications").insert({
      user_id: provider.profile_id, title, body, href: "/worker/profile#verification",
    });
    if (notificationError) console.error("Could not create a provider verification notification", notificationError);
  }
  revalidatePath(`/admin/cleaners/${providerId}`);
  revalidatePath("/admin/cleaners");
  revalidatePath("/worker/profile");
}
