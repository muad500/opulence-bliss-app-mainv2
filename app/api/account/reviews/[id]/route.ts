import { NextRequest, NextResponse } from "next/server";
import { accountContext, accountError, isAccountError, readAccountBody } from "@/lib/accountApi";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Context) {
  const ctx = await accountContext(request, { mutation: true });
  if (isAccountError(ctx)) return ctx;
  const body = await readAccountBody(request);
  if (body instanceof NextResponse) return body;
  if (Object.keys(body).some((key) => !["rating", "comment", "visibility"].includes(key))) {
    return accountError("Unsupported review field.");
  }
  const { id } = await params;
  const { data: review, error: reviewError } = await ctx.admin.from("reviews")
    .select("id,booking_id,reviewer,rating,comment,visibility").eq("id", id).maybeSingle();
  if (reviewError || !review) return accountError("Review not found.", 404);
  const { data: booking } = await ctx.admin.from("bookings")
    .select("customer_id,provider_id,status").eq("id", review.booking_id).maybeSingle();
  if (!booking || booking.status !== "completed") return accountError("This review cannot be edited.", 409);
  const owner = review.reviewer === "client"
    ? booking.customer_id === ctx.user.id
    : review.reviewer === "provider" && booking.provider_id === ctx.providerId;
  if (!owner) return accountError("Review not found.", 404);
  const rating = body.rating === undefined ? review.rating : body.rating;
  if (!Number.isInteger(rating) || Number(rating) < 1 || Number(rating) > 5) return accountError("Choose a rating from 1 to 5.");
  const visibility = body.visibility === undefined ? review.visibility : body.visibility;
  if (visibility !== "public" && visibility !== "private") return accountError("Choose public or private.");
  if (body.comment !== undefined && body.comment !== null && typeof body.comment !== "string") return accountError("Enter a review comment.");
  const comment = body.comment === undefined ? review.comment : String(body.comment ?? "").trim();
  if (comment && comment.length > 2000) return accountError("Keep the review under 2,000 characters.");
  const effectiveVisibility = review.reviewer === "client" && Number(rating) < 4 ? "private" : visibility;
  const { data: updated, error } = await ctx.admin.from("reviews")
    .update({ rating, comment: comment || null, visibility: effectiveVisibility })
    .eq("id", id).select("id,booking_id,reviewer,rating,comment,visibility,created_at").single();
  if (error) return accountError("Review could not be updated.", 503);
  return NextResponse.json({ ok: true, review: {
    id: updated.id, bookingId: updated.booking_id, reviewer: updated.reviewer,
    rating: updated.rating, comment: updated.comment, visibility: updated.visibility,
    createdAt: updated.created_at,
  } });
}
