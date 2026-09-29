"use server";

import { revalidatePath } from "next/cache";
import { requireAdminPage } from "@/lib/adminSession";
import { deletionRequestAdminClient } from "./data";

export type ReviewState = { ok: boolean; message: string };

export async function updateDeletionRequest(
  _previous: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  await requireAdminPage();

  const idValue = formData.get("requestId");
  const statusValue = formData.get("nextStatus");
  const noteValue = formData.get("note");
  const id = typeof idValue === "string" ? idValue : "";
  const nextStatus = typeof statusValue === "string" ? statusValue : "";
  const note = typeof noteValue === "string" ? noteValue.trim() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return { ok: false, message: "Choose a valid request." };
  }
  if (!["in_review", "completed", "declined"].includes(nextStatus)) {
    return { ok: false, message: "Choose a valid review action." };
  }
  if (note.length > 1000) {
    return { ok: false, message: "Keep the outcome note under 1,000 characters." };
  }
  if (nextStatus !== "in_review" && note.length < 10) {
    return { ok: false, message: "Add an outcome note of at least 10 characters." };
  }
  if (nextStatus === "completed" && formData.get("workConfirmed") !== "yes") {
    return { ok: false, message: "Confirm the separate account and data work is complete." };
  }

  const admin = deletionRequestAdminClient();
  if (!admin) return { ok: false, message: "Account requests are unavailable right now." };

  const { data: request, error: lookupError } = await admin
    .from("account_deletion_requests")
    .select("status")
    .eq("id", id)
    .maybeSingle();
  if (lookupError) return { ok: false, message: "Could not load this request." };
  if (!request) return { ok: false, message: "This request no longer exists." };

  const currentStatus = request.status as string;
  if (
    (currentStatus !== "pending" || nextStatus !== "in_review") &&
    (currentStatus !== "in_review" || !["completed", "declined"].includes(nextStatus))
  ) {
    return { ok: false, message: "This request has changed. Refresh the page to see its current status." };
  }

  const { data: updated, error } = await admin
    .from("account_deletion_requests")
    .update({
      status: nextStatus,
      resolution_note: note || null,
      resolved_at: nextStatus === "in_review" ? null : new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", currentStatus)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, message: "Could not save the review decision." };
  if (!updated) return { ok: false, message: "This request changed while you were reviewing it. Refresh the page." };

  revalidatePath("/admin/deletion-requests");
  return {
    ok: true,
    message: nextStatus === "in_review"
      ? "Request moved to In review. No account data was changed."
      : nextStatus === "completed"
        ? "Request marked completed. The outcome was recorded."
        : "Request declined. The reason was recorded.",
  };
}
