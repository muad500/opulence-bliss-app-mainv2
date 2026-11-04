"use server";
import { revalidatePath } from "next/cache";
import { requireAdminPage } from "@/lib/adminSession";
export async function recordWelfareStep(
  _: { message: string },
  form: FormData,
) {
  const { supabase } = await requireAdminPage();
  const { error } = await supabase.rpc("record_booking_welfare_step", {
    p_booking: form.get("booking"),
    p_scheduled: form.get("scheduled"),
    p_action: form.get("action"),
    p_note: form.get("note"),
  });
  revalidatePath("/admin/welfare");
  return {
    message: error ? error.message : "Step logged with your name and the time.",
  };
}
