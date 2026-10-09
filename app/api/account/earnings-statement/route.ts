import { NextRequest, NextResponse } from "next/server";
import { accountContext, accountError, isAccountError } from "@/lib/accountApi";
import { handymanEnabled } from "@/lib/handymanMarketplace";
import { allHandymanEarnings } from "@/lib/professionalPortal";
import { handymanEarnings } from "@/lib/professionalEarnings";
import { csvCell } from "@/lib/earningsPeriod";

export async function GET(request: NextRequest) {
  const ctx = await accountContext(request, {
    provider: true,
    approvedProvider: true,
  });
  if (isAccountError(ctx)) return ctx;
  try {
    const rows: unknown[][] = [];
    for (const table of ["payments", "payouts"]) {
      for (let from = 0; ; from += 500) {
        const query = ctx.admin
          .from(table)
          .select(
            table === "payments"
              ? "id,gross_amount,split_breakdown,status,kind,created_at,bookings!inner(provider_id,scheduled_at)"
              : "id,amount,status,created_at,bookings!inner(provider_id,scheduled_at)",
          );
        const { data, error } = await query
          .eq("bookings.provider_id", ctx.providerId!)
          .order("created_at")
          .order("id")
          .range(from, from + 499);
        if (error) throw error;
        for (const entry of data ?? []) {
          const row = entry as unknown as {
            id: string;
            created_at: string;
            gross_amount?: number;
            split_breakdown?: { provider?: number };
            amount?: number;
            kind?: string;
            status: string;
          };
          rows.push([
            row.created_at,
            row.id,
            "Cleaning",
            table === "payments"
              ? row.kind === "tip"
                ? "Tip"
                : "Visit payment"
              : "Payout",
            Number(
              table === "payments"
                ? (row.split_breakdown?.provider ?? 0)
                : (row.amount ?? 0),
            ).toFixed(2),
            row.status,
          ]);
        }
        if (!data || data.length < 500) break;
      }
    }
    if (handymanEnabled()) {
      for (const row of handymanEarnings(
        await allHandymanEarnings(ctx.admin, ctx.providerId!),
      ).rows)
        rows.push([
          row.when,
          row.key,
          "Handyman",
          row.label,
          row.amount.toFixed(2),
          row.state,
        ]);
    }
    rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    const csv = [
      ["Recorded at", "Reference", "Service", "Type", "Amount GBP", "Status"],
      ...rows,
    ]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n");
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition":
          'attachment; filename="opulence-earnings-statement.csv"',
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return accountError(
      "Your statement could not be prepared. Please try again.",
      503,
    );
  }
}
