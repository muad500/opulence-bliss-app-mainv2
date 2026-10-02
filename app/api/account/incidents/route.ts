import { NextRequest, NextResponse } from "next/server";
import { accountContext, accountError, isAccountError, readAccountBody } from "@/lib/accountApi";

export async function POST(request: NextRequest) {
  const ctx = await accountContext(request, { mutation: true });
  if (isAccountError(ctx)) return ctx;
  const body = await readAccountBody(request);
  if (body instanceof NextResponse) return body;
  if (!['booking','safety','payment','account','other'].includes(String(body.category))) return accountError("Choose a report category.");
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (description.length < 20 || description.length > 5000) return accountError("Describe the problem using 20 to 5,000 characters.");
  const bookingId = typeof body.bookingId === "string" ? body.bookingId.trim() : "";
  if (bookingId) {
    if (!/^[0-9a-f-]{36}$/i.test(bookingId)) return accountError("Enter a valid booking reference or leave it blank.");
    const { data: booking, error } = await ctx.admin.from("bookings").select("customer_id,provider_id").eq("id", bookingId).maybeSingle();
    if (error) return accountError("Could not check this booking.", 503);
    if (!booking || booking.customer_id !== ctx.user.id && (!ctx.providerId || booking.provider_id !== ctx.providerId)) return accountError("Choose a booking from your account.", 403);
  }
  const { count, error: countError } = await ctx.admin.from("account_incidents").select("id", { count: "exact", head: true }).eq("reporter_id", ctx.user.id).gte("created_at", new Date(Date.now() - 3600000).toISOString());
  if (countError) return accountError("Reports are unavailable right now.", 503);
  if ((count ?? 0) >= 10) return accountError("Please wait before submitting another report.", 429);
  const { data, error } = await ctx.admin.from("account_incidents").insert({ reporter_id: ctx.user.id, category: body.category, description, booking_id: bookingId || null }).select("id").single();
  if (error) return accountError("Your report could not be saved. Please try again.", 503);
  return NextResponse.json({ reference: data.id }, { headers: { "Cache-Control": "private, no-store" } });
}
