import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountContext, isAccountError } from "@/lib/accountApi";

type Row = Record<string, unknown>;

async function allFor(client: SupabaseClient, table: string, column: string, value: string): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from(table).select("*").eq(column, value).range(from, from + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

async function allByIds(client: SupabaseClient, table: string, column: string, ids: string[]): Promise<Row[]> {
  const rows: Row[] = [];
  for (let index = 0; index < ids.length; index += 100) {
    const chunk = ids.slice(index, index + 100);
    for (let from = 0; ; from += 1000) {
      const { data, error } = await client.from(table).select("*").in(column, chunk).range(from, from + 999);
      if (error) throw error;
      rows.push(...((data ?? []) as Row[]));
      if (!data || data.length < 1000) break;
    }
  }
  return rows;
}

export async function GET(request: NextRequest) {
  const ctx = await accountContext(request);
  if (isAccountError(ctx)) return ctx;
  try {
    const userId = ctx.user.id;
    const providerId = ctx.providerId;
    const [profile, details, addresses, favourites, legal, consents, marketingConsents, notifications, deletionRequests, clientBookings, providerBookings] = await Promise.all([
      allFor(ctx.admin, "profiles", "id", userId),
      allFor(ctx.admin, "account_profile_details", "user_id", userId),
      allFor(ctx.admin, "customer_addresses", "user_id", userId),
      allFor(ctx.admin, "customer_favourite_providers", "user_id", userId),
      allFor(ctx.admin, "account_legal_acceptances", "user_id", userId),
      allFor(ctx.admin, "signup_consents", "user_id", userId),
      allFor(ctx.admin, "account_marketing_consents", "user_id", userId),
      allFor(ctx.admin, "notifications", "user_id", userId),
      allFor(ctx.admin, "account_deletion_requests", "user_id", userId),
      allFor(ctx.admin, "bookings", "customer_id", userId),
      providerId ? allFor(ctx.admin, "bookings", "provider_id", providerId) : Promise.resolve([]),
    ]);
    const bookings = [...new Map([...clientBookings, ...providerBookings].map((row) => [String(row.id), row])).values()];
    const bookingIds = bookings.map((row) => String(row.id));
    const [payments, reviews, messages, provider, onboarding, settings, timeOff, taskRates, verification, dbsChecks, payoutRuns, jobInvoices] = await Promise.all([
      allByIds(ctx.admin, "payments", "booking_id", bookingIds),
      allByIds(ctx.admin, "reviews", "booking_id", bookingIds),
      allByIds(ctx.admin, "booking_messages", "booking_id", bookingIds),
      providerId ? allFor(ctx.admin, "providers", "id", providerId) : Promise.resolve([]),
      providerId ? allFor(ctx.admin, "provider_onboarding_details", "provider_id", providerId) : Promise.resolve([]),
      providerId ? allFor(ctx.admin, "provider_profile_settings", "provider_id", providerId) : Promise.resolve([]),
      providerId ? allFor(ctx.admin, "provider_time_off", "provider_id", providerId) : Promise.resolve([]),
      providerId ? allFor(ctx.admin, "provider_task_rates", "provider_id", providerId) : Promise.resolve([]),
      providerId ? allFor(ctx.admin, "provider_verification_items", "provider_id", providerId) : Promise.resolve([]),
      providerId ? allFor(ctx.admin, "provider_dbs_checks", "provider_id", providerId) : Promise.resolve([]),
      providerId ? allFor(ctx.admin, "provider_payout_runs", "provider_id", providerId) : Promise.resolve([]),
      providerId ? allFor(ctx.admin, "provider_job_invoices", "provider_id", providerId) : Promise.resolve([]),
    ]);
    const professionalJobs = providerBookings.map((booking) => ({
      id: booking.id, status: booking.status, scheduledAt: booking.scheduled_at,
      durationMinutes: booking.duration_minutes, packageId: booking.package_id,
      providerPayout: booking.provider_payout,
    }));
    const incidents = await allFor(ctx.admin, "account_incidents", "reporter_id", userId);
    const exportData = {
      exportedAt: new Date().toISOString(),
      account: { email: ctx.user.email, userMetadata: ctx.user.user_metadata, profile, details, legal, consents, marketingConsents, deletionRequests },
      client: { addresses, favourites, bookings: clientBookings, payments: payments.filter((row) => clientBookings.some((booking) => booking.id === row.booking_id)), reviews, messages, notifications },
      incidents,
      professional: providerId ? { provider, onboarding, settings, timeOff, taskRates, verification, dbsChecks, bookings: professionalJobs, payouts: payoutRuns, invoices: jobInvoices } : null,
      note: "Payment card and bank details are held by Stripe and are not included in this file.",
    };
    const date = new Date().toISOString().slice(0, 10);
    return new NextResponse(JSON.stringify(exportData, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="opulence-bliss-account-${date}.json"`,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Account export failed:", error);
    return NextResponse.json({ error: "Your account data could not be prepared right now." }, { status: 503 });
  }
}
