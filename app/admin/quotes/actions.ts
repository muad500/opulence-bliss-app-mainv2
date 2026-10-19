"use server";

import { revalidatePath } from "next/cache";
import { requireAdminPage } from "@/lib/adminSession";

const STATUSES = new Set([
  "new",
  "reviewing",
  "quoted",
  "accepted",
  "declined",
  "closed",
]);

async function requireAdmin() {
  return (await requireAdminPage()).supabase;
}

export async function updateHandymanQuote(id: string, formData: FormData) {
  const supabase = await requireAdmin();
  const status = String(formData.get("status") ?? "");
  const adminNotes = String(formData.get("adminNotes") ?? "")
    .trim()
    .slice(0, 4000);
  if (!STATUSES.has(status)) throw new Error("Invalid quote status");

  const { error } = await supabase
    .from("handyman_quote_requests")
    .update({
      status,
      admin_notes: adminNotes || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/quotes");
}
