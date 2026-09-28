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
  const homepageFeatured = formData.get("homepageFeatured") === "on";
  const isDemo = formData.get("isDemo") === "on";
  if (homepageFeatured && isDemo) {
    throw new Error("Prototype samples cannot be shown on the homepage.");
  }

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
    published: requestedPublished && !isDemo,
    homepage_featured: homepageFeatured,
    is_demo: isDemo,
    sort_order: Number.isFinite(sortOrder) ? Math.trunc(sortOrder) : 0,
    updated_at: new Date().toISOString(),
  };
}

async function checkHomepageLimit(
  supabase: Awaited<ReturnType<typeof createClient>>,
  homepageFeatured: boolean,
  currentId?: string,
) {
  if (!homepageFeatured) return;
  const { data, error } = await supabase
    .from("marketing_reviews")
    .select("id")
    .eq("service_type", "cleaning")
    .eq("homepage_featured", true);
  if (error) throw new Error(error.message);
  if (!data?.some((review) => review.id === currentId) && (data?.length ?? 0) >= 3) {
    throw new Error("The homepage can show up to three editable testimonials. Remove one first.");
  }
}

function refreshReviews() {
  revalidatePath("/admin/reviews");
  revalidatePath("/services/cleaning");
  revalidatePath("/");
}

export async function createMarketingReview(formData: FormData) {
  const { supabase, user } = await requireAdmin();
  const values = reviewValues(formData);
  const { error } = await supabase.from("marketing_reviews").insert({
    ...values,
    homepage_featured: false,
    created_by: user.id,
  });
  if (error) throw new Error(error.message);
  refreshReviews();
}

export async function updateMarketingReview(id: string, formData: FormData) {
  const { supabase } = await requireAdmin();
  const values = reviewValues(formData);
  if (values.homepage_featured) {
    const { data: existing, error: existingError } = await supabase
      .from("marketing_reviews")
      .select("source_review_id")
      .eq("id", id)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (!existing?.source_review_id) {
      throw new Error("Only a testimonial copied from a public booking review can appear on the homepage.");
    }
  }
  await checkHomepageLimit(supabase, values.homepage_featured, id);
  const { error } = await supabase
    .from("marketing_reviews")
    .update(values)
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

export async function copyBookingReviewToTestimonial(formData: FormData) {
  const reviewId = String(formData.get("reviewId") ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reviewId)) {
    throw new Error("Invalid review.");
  }

  const { supabase, user } = await requireAdmin();
  const { data: review, error: reviewError } = await supabase
    .from("reviews")
    .select("booking_id, reviewer, rating, comment, visibility, created_at")
    .eq("id", reviewId)
    .maybeSingle();
  if (reviewError) throw new Error(reviewError.message);
  if (review?.reviewer !== "client" || review.visibility !== "public" || !review.comment?.trim()) {
    throw new Error("Only written public customer booking reviews can be copied.");
  }

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("package_id")
    .eq("id", review.booking_id)
    .maybeSingle();
  if (bookingError) throw new Error(bookingError.message);
  if (!booking?.package_id) throw new Error("Booking package not found.");
  const { data: service, error: serviceError } = await supabase
    .from("packages")
    .select("name, service_type")
    .eq("id", booking.package_id)
    .maybeSingle();
  if (serviceError) throw new Error(serviceError.message);
  if (!service?.service_type?.includes("clean")) {
    throw new Error("Only cleaning reviews can be copied into cleaning testimonials.");
  }

  const { data: existing, error: existingError } = await supabase
    .from("marketing_reviews")
    .select("id")
    .eq("source_review_id", reviewId)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing) throw new Error("This booking review is already an editable testimonial.");

  const { error } = await supabase.from("marketing_reviews").insert({
    source_review_id: reviewId,
    service_type: "cleaning",
    service_label: service.name,
    rating: review.rating,
    comment: review.comment.trim(),
    customer_name: "Customer",
    location: null,
    reviewed_at: review.created_at.slice(0, 10),
    published: false,
    homepage_featured: false,
    is_demo: false,
    sort_order: 0,
    created_by: user.id,
  });
  if (error) throw new Error(error.message);
  refreshReviews();
}
