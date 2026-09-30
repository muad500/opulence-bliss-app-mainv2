"use server";
import { revalidatePath } from "next/cache";
import { requireAdminPage } from "@/lib/adminSession";
import { deletionRequestAdminClient } from "../deletion-requests/data";

export async function reviewIncident(_: { message: string; ok: boolean }, form: FormData) {
  const { user } = await requireAdminPage();
  const id = String(form.get("id") ?? "");
  const status = String(form.get("status") ?? "");
  const note = String(form.get("note") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id) || !["in_review","resolved"].includes(status) || note.length > 2000 || status === "resolved" && note.length < 10) return { ok: false, message: "Choose a status and add an outcome note when resolving a report." };
  const admin = deletionRequestAdminClient();
  if (!admin) return { ok: false, message: "Reports are unavailable." };
  const { data, error } = await admin.from("account_incidents").update({ status, resolution_note: note || null, reviewed_at: new Date().toISOString(), reviewed_by: user.id }).eq("id", id).in("status", ["open","in_review"]).select("id").maybeSingle();
  if (error || !data) return { ok: false, message: "This report could not be updated. Refresh and try again." };
  revalidatePath("/admin/incidents");
  return { ok: true, message: "Report updated." };
}
