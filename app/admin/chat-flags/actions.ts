"use server";

import { revalidatePath } from "next/cache";
import { requireAdminPage } from "@/lib/adminSession";

export async function reviewChatFlag(formData: FormData) {
  const flagId = Number(formData.get("flagId"));
  const status = String(formData.get("status") ?? "");

  if (!Number.isSafeInteger(flagId) || flagId <= 0) {
    throw new Error("Invalid safety flag.");
  }
  if (status !== "reviewed" && status !== "dismissed") {
    throw new Error("Invalid review decision.");
  }

  const { supabase } = await requireAdminPage();

  const { error } = await supabase.rpc("review_chat_moderation_flag", {
    p_flag_id: flagId,
    p_status: status,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/admin/chat-flags");
}
