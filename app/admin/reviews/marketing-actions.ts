"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin") throw new Error("Admins only");

  return { supabase, user };
}

function reviewValues(formData: FormData) {
  const rating = Number(formData.get("rating"));
  const serviceLabel = String(formData.get("serviceLabel") ?? "").trim();
  const comment = String(formData.get("comment") ?? "").trim();
  const customerName = String(formData.get("customerName") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim();
  const reviewedAt = String(formData.get("reviewedAt") ?? "").trim();
  const sortOrder = Number(formData.get("sortOrder") ?? 0);

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new Error("Rating must be between 1 and 5");
  }
  if (!serviceLabel || !comment || !customerName || !/^\d{4}-\d{2}-\d{2}$/.test(reviewedAt)) {
    throw new Error("Complete the service, review, customer and date fields");
  }

  const requestedPublished = formData.get("published") === "on";

  return {
    service_type: "cleaning",
    rating,
    service_label: serviceLabel.slice(0, 120),
    comment: comment.slice(0, 2000),
    customer_name: customerName.slice(0, 100),
    location: location ? location.slice(0, 100) : null,
    reviewed_at: reviewedAt,
    // Any rating may be published, as hiding negative reviews is a banned
    // practice. A prototype sample is never published, since publishing
    // reviews that are not from real customers is also banned; the database
    // enforces this as well.
    published: requestedPublished && formData.get("isDemo") !== "on",
    is_demo: formData.get("isDemo") === "on",
    sort_order: Number.isFinite(sortOrder) ? Math.trunc(sortOrder) : 0,
    updated_at: new Date().toISOString(),
  };
}

function refreshReviews() {
  revalidatePath("/admin/reviews");
  revalidatePath("/services/cleaning");
  revalidatePath("/");
}

export async function createMarketingReview(formData: FormData) {
  const { supabase, user } = await requireAdmin();
  const { error } = await supabase.from("marketing_reviews").insert({
    ...reviewValues(formData),
    created_by: user.id,
  });
  if (error) throw new Error(error.message);
  refreshReviews();
}

export async function updateMarketingReview(id: string, formData: FormData) {
  const { supabase } = await requireAdmin();
  const { error } = await supabase
    .from("marketing_reviews")
    .update(reviewValues(formData))
    .eq("id", id);
  if (error) throw new Error(error.message);
  refreshReviews();
}

export async function deleteMarketingReview(id: string) {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.from("marketing_reviews").delete().eq("id", id);
  if (error) throw new Error(error.message);
  refreshReviews();
}
