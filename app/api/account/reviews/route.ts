import { NextRequest, NextResponse } from "next/server";
import { accountContext, accountError, isAccountError } from "@/lib/accountApi";

export async function GET(request: NextRequest) {
  const ctx = await accountContext(request);
  if (isAccountError(ctx)) return ctx;
  const [customerBookings, providerBookings] = await Promise.all([
    ctx.admin.from("bookings").select("id,customer_id,provider_id,packages(name),providers(display_name)").eq("customer_id", ctx.user.id).limit(500),
    ctx.providerId
      ? ctx.admin.from("bookings").select("id,customer_id,provider_id,packages(name),providers(display_name)").eq("provider_id", ctx.providerId).limit(500)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (customerBookings.error || providerBookings.error) return accountError("Reviews could not be loaded.", 503);
  const bookings = [...(customerBookings.data ?? []), ...(providerBookings.data ?? [])];
  const byId = new Map(bookings.map((booking) => [booking.id, booking]));
  if (bookings.length === 0) return NextResponse.json({ left: [], received: [] });
  const { data: reviews, error } = await ctx.admin.from("reviews")
    .select("id,booking_id,reviewer,rating,comment,visibility,created_at")
    .in("booking_id", [...byId.keys()]).order("created_at", { ascending: false }).limit(1000);
  if (error) return accountError("Reviews could not be loaded.", 503);
  const left: Record<string, unknown>[] = [];
  const received: Record<string, unknown>[] = [];
  for (const review of reviews ?? []) {
    const booking = byId.get(review.booking_id);
    if (!booking) continue;
    const service = Array.isArray(booking.packages) ? booking.packages[0] : booking.packages;
    const provider = Array.isArray(booking.providers) ? booking.providers[0] : booking.providers;
    const customerSide = booking.customer_id === ctx.user.id;
    const workerSide = booking.provider_id === ctx.providerId;
    const row = {
      id: review.id, bookingId: review.booking_id, rating: review.rating,
      comment: review.comment, visibility: review.visibility, createdAt: review.created_at,
      serviceName: service?.name ?? "Visit", recipientName: provider?.display_name ?? "Professional",
    };
    if (review.reviewer === "client" && customerSide) left.push({ ...row, roleSide: "client" });
    if (review.reviewer === "provider" && workerSide) left.push({ ...row, recipientName: "Client", roleSide: "worker" });
    if (review.reviewer === "provider" && customerSide) received.push({ ...row, roleSide: "client" });
    if (review.reviewer === "client" && workerSide) received.push({ ...row, roleSide: "worker" });
  }
  return NextResponse.json({ left, received });
}
