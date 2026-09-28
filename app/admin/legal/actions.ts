"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  isLegalDocumentSlug,
  sanitizeLegalHtml,
} from "@/lib/legalDocuments";

export type LegalSaveState = { ok: boolean; message: string };

export async function saveLegalDocument(
  _previousState: LegalSaveState,
  formData: FormData,
): Promise<LegalSaveState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in as an administrator." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin") {
    return { ok: false, message: "Administrators only." };
  }

  const slug = String(formData.get("slug") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const version = String(formData.get("version") ?? "").trim();
  const contentHtml = sanitizeLegalHtml(String(formData.get("contentHtml") ?? ""));

  if (!isLegalDocumentSlug(slug)) {
    return { ok: false, message: "That legal document is not recognised." };
  }
  if (title.length < 3 || title.length > 120) {
    return { ok: false, message: "Use a title between 3 and 120 characters." };
  }
  if (!/^(?:\d{4}-\d{2}-\d{2}(?:\.\d+)?|\d+\.\d+)$/.test(version)) {
    return { ok: false, message: "Use a version such as 2.0, 2026-09-20 or 2026-09-20.2." };
  }
  if (contentHtml.replace(/<[^>]*>/g, "").trim().length < 80) {
    return { ok: false, message: "The document is too short to publish." };
  }

  const audience =
    slug === "terms" || slug === "cancellation-refund" || slug === "handyman-terms"
      ? "customers"
      : slug === "professional-partner-agreement"
        ? "professionals"
        : "everyone";

  const { error } = await supabase.from("legal_documents").upsert(
    {
      slug,
      title,
      audience,
      content_html: contentHtml,
      version,
      published: true,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "slug" },
  );

  if (error) {
    return { ok: false, message: `Could not save: ${error.message}` };
  }

  revalidatePath("/admin/legal");
  revalidatePath(`/legal/${slug}`);
  return { ok: true, message: "Saved and published successfully." };
}
