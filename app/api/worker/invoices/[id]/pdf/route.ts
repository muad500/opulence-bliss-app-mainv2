import type {
  PrivateInvoice,
  PrivateBookingTiming,
} from "@/lib/privateVisitTypes";
import { generateProviderInvoicePdf } from "@/lib/invoicePdf";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json(
      { error: "Sign in to download this invoice." },
      { status: 401 },
    );
  }

  const { data: invoice, error: invoiceError } = await supabase
    .rpc("worker_visible_invoices")
    .select("*, providers(display_name, profiles(full_name, email))")
    .eq("id", id)
    .returns<PrivateInvoice[]>()
    .maybeSingle();

  if (invoiceError || !invoice) {
    return Response.json({ error: "Invoice not found." }, { status: 404 });
  }

  const { data: booking } = await supabase
    .rpc("worker_visible_bookings")
    .select("scheduled_at, check_ins(arrived_at, left_at)")
    .eq("id", invoice.booking_id)
    .returns<PrivateBookingTiming[]>()
    .maybeSingle();

  const provider = one(invoice.providers as never) as {
    display_name: string | null;
    profiles:
      | { full_name: string | null; email: string | null }
      | Array<{ full_name: string | null; email: string | null }>
      | null;
  } | null;
  const profile = one(provider?.profiles);
  const checkIn = one(booking?.check_ins as never) as {
    arrived_at: string | null;
    left_at: string | null;
  } | null;

  const pdf = await generateProviderInvoicePdf({
    invoiceNumber: invoice.invoice_number,
    issuedAt: invoice.issued_at,
    status: invoice.status,
    professionalName:
      provider?.display_name ??
      profile?.full_name ??
      profile?.email ??
      "Professional",
    customerName: invoice.customer_name,
    serviceName: invoice.service_name,
    address: invoice.address,
    propertySizeSqm:
      invoice.property_size_sqm === null
        ? null
        : Number(invoice.property_size_sqm),
    bookedAt: booking?.scheduled_at ?? invoice.completed_at,
    durationMinutes: Number(invoice.duration_minutes),
    checkedInAt: checkIn?.arrived_at ?? null,
    checkedOutAt: checkIn?.left_at ?? null,
    grossAmount:
      invoice.gross_amount === null ? null : Number(invoice.gross_amount),
    platformFee:
      invoice.platform_fee === null ? null : Number(invoice.platform_fee),
    payoutAmount: Number(invoice.payout_amount),
    payoutSchedule: invoice.payout_schedule,
    payoutDueOn: invoice.payout_due_on,
  });

  const safeName = String(invoice.invoice_number).replace(
    /[^a-zA-Z0-9_-]/g,
    "-",
  );
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${safeName}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
