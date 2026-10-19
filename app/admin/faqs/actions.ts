"use server";

import { revalidatePath } from "next/cache";
import { requireAdminPage } from "@/lib/adminSession";
import { isFaqCategory } from "@/lib/faqs";

async function requireAdmin() {
  return requireAdminPage();
}

function faqValues(formData: FormData) {
  const category = String(formData.get("category") ?? "");
  const question = String(formData.get("question") ?? "").trim();
  const answer = String(formData.get("answer") ?? "").trim();
  const sortOrder = Number(formData.get("sortOrder") ?? 0);

  if (!isFaqCategory(category)) throw new Error("Choose a valid FAQ section");
  if (question.length < 5 || question.length > 220) {
    throw new Error("Use a question between 5 and 220 characters");
  }
  if (answer.length < 5 || answer.length > 5000) {
    throw new Error("Use an answer between 5 and 5,000 characters");
  }

  return {
    category,
    question,
    answer,
    published: formData.get("published") === "on",
    sort_order: Number.isFinite(sortOrder) ? Math.trunc(sortOrder) : 0,
    updated_at: new Date().toISOString(),
  };
}

function refreshFaqs() {
  revalidatePath("/admin/faqs");
  revalidatePath("/faq");
  revalidatePath("/services/cleaning");
  revalidatePath("/services/handyman");
}

export async function createFaq(formData: FormData) {
  const { supabase, user } = await requireAdmin();
  const { error } = await supabase.from("faqs").insert({
    ...faqValues(formData),
    created_by: user.id,
  });
  if (error) throw new Error(error.message);
  refreshFaqs();
}

export async function updateFaq(id: string, formData: FormData) {
  const { supabase } = await requireAdmin();
  const { error } = await supabase
    .from("faqs")
    .update(faqValues(formData))
    .eq("id", id);
  if (error) throw new Error(error.message);
  refreshFaqs();
}

export async function deleteFaq(id: string) {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.from("faqs").delete().eq("id", id);
  if (error) throw new Error(error.message);
  refreshFaqs();
}
