"use server";
import { revalidatePath } from "next/cache";
import { requireAdminPage } from "@/lib/adminSession";
import { deletionRequestAdminClient } from "../deletion-requests/data";

export async function createIncident(
  _: { message: string; ok: boolean },
  form: FormData,
) {
  const { user } = await requireAdminPage();
  const kind = String(form.get("kind") ?? "");
  const category = String(form.get("category") ?? "");
  const description = String(form.get("description") ?? "").trim();
  const booking = String(form.get("booking") ?? "").trim();
  const provider = String(form.get("provider") ?? "").trim();
  if (
    !["incident", "complaint", "breach"].includes(kind) ||
    !["booking", "safety", "payment", "account", "other"].includes(category) ||
    description.length < 20 ||
    description.length > 5000 ||
    [booking, provider].some(
      (id) =>
        id &&
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          id,
        ),
    )
  )
    return {
      ok: false,
      message:
        "Check the references and add at least 20 characters describing what happened.",
    };
  const admin = deletionRequestAdminClient();
  if (!admin) return { ok: false, message: "Reports are unavailable." };
  const result = await admin.from("account_incidents").insert({
    reporter_id: user.id,
    booking_id: booking || null,
    subject_provider_id: provider || null,
    log_kind: kind,
    category,
    description,
  });
  if (result.error)
    return {
      ok: false,
      message:
        "The report could not be saved. Check that the booking and professional exist.",
    };
  revalidatePath("/admin/incidents");
  return { ok: true, message: "Private report saved." };
}

export async function reviewIncident(
  _: { message: string; ok: boolean },
  form: FormData,
) {
  const { user } = await requireAdminPage();
  const id = String(form.get("id") ?? "");
  const status = String(form.get("status") ?? "");
  const note = String(form.get("note") ?? "").trim();
  if (
    !/^[0-9a-f-]{36}$/i.test(id) ||
    !["in_review", "resolved"].includes(status) ||
    note.length > 2000 ||
    (status === "resolved" && note.length < 10)
  )
    return {
      ok: false,
      message:
        "Choose a status and add an outcome note when resolving a report.",
    };
  const admin = deletionRequestAdminClient();
  if (!admin) return { ok: false, message: "Reports are unavailable." };
  const { data, error } = await admin
    .from("account_incidents")
    .update({
      status,
      resolution_note: note || null,
      reviewed_at: new Date().toISOString(),
      reviewed_by: user.id,
    })
    .eq("id", id)
    .in("status", ["open", "in_review"])
    .select("id")
    .maybeSingle();
  if (error || !data)
    return {
      ok: false,
      message: "This report could not be updated. Refresh and try again.",
    };
  revalidatePath("/admin/incidents");
  return { ok: true, message: "Report updated." };
}
