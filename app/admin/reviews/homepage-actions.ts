"use server";

import { revalidatePath } from "next/cache";
import { requireAdminPage } from "@/lib/adminSession";

function reviewId(formData: FormData) {
  const id = String(formData.get("reviewId") ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error("Invalid review");
  }
  return id;
}

function refresh() {
  revalidatePath("/");
  revalidatePath("/admin/reviews");
}

export async function featureHomepageReview(formData: FormData) {
  const id = reviewId(formData);
  const { supabase, user } = await requireAdminPage();
  const { data: review, error: reviewError } = await supabase
    .from("reviews")
    .select("reviewer, rating, comment, visibility")
    .eq("id", id)
    .maybeSingle();
  if (reviewError) throw new Error(reviewError.message);
  if (
    review?.reviewer !== "client" ||
    review.rating < 4 ||
    review.visibility !== "public" ||
    !review.comment?.trim()
  ) {
    throw new Error("Only positive, public customer booking reviews with a comment can be featured.");
  }

  const { data: selected, error: selectedError } = await supabase
    .from("homepage_review_highlights")
    .select("review_id");
  if (selectedError) throw new Error(selectedError.message);
  if (selected?.some((row) => row.review_id === id)) return;
  if ((selected?.length ?? 0) >= 3) {
    throw new Error("Remove a homepage highlight before adding another. The limit is three.");
  }

  const { error } = await supabase.from("homepage_review_highlights").insert({
    review_id: id,
    selected_by: user.id,
  });
  if (error) throw new Error(error.message);
  refresh();
}

export async function unfeatureHomepageReview(formData: FormData) {
  const id = reviewId(formData);
  const { supabase } = await requireAdminPage();
  const { error } = await supabase
    .from("homepage_review_highlights")
    .delete()
    .eq("review_id", id);
  if (error) throw new Error(error.message);
  refresh();
}
