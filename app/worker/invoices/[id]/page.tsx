import type {
  PrivateInvoice,
  PrivateBookingTiming,
} from "@/lib/privateVisitTypes";
import { createClient } from "@/lib/supabase/server";
import { SignedOut } from "@/app/account/page";
import PrintInvoiceButton from "./PrintInvoiceButton";
import type { ProviderInvoicePdfData } from "@/lib/invoicePdf";

const money = (value: number | null) =>
  value === null ? "—" : `£${Number(value).toFixed(2)}`;

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export default async function ProviderInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return <SignedOut area="provider" />;

  const { data: invoice } = await supabase
    .rpc("worker_visible_invoices")
    .select(
      "*, providers(display_name, profile:profiles!providers_profile_id_fkey(full_name, email))",
    )
    .eq("id", id)
    .returns<PrivateInvoice[]>()
    .maybeSingle();

  if (!invoice)
    return (
      <main style={page}>
        <h1>Invoice not found</h1>
        <a href="/worker/earnings">← Earnings</a>
      </main>
    );
  const provider = Array.isArray(invoice.providers)
    ? invoice.providers[0]
    : invoice.providers;
  const profileValue = provider?.profile;
  const profile = Array.isArray(profileValue) ? profileValue[0] : profileValue;
  const providerName =
    provider?.display_name ??
    profile?.full_name ??
    profile?.email ??
    "Professional";
  const { data: booking } = await supabase
    .rpc("worker_visible_bookings")
    .select("scheduled_at, check_ins(arrived_at, left_at)")
    .eq("id", invoice.booking_id)
    .returns<PrivateBookingTiming[]>()
    .maybeSingle();
  const checkIn = one(booking?.check_ins as never) as {
    arrived_at: string | null;
    left_at: string | null;
  } | null;
  const pdfInvoice: ProviderInvoicePdfData = {
    invoiceNumber: invoice.invoice_number,
    issuedAt: invoice.issued_at,
    status: invoice.status,
    professionalName: providerName,
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
  };

  return (
    <main style={page}>
      <div
        className="screen-actions"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <a href="/worker/earnings">← Earnings</a>
        <PrintInvoiceButton invoice={pdfInvoice} />
      </div>
      <article style={invoiceCard}>
        <header style={header}>
          <div>
            <p style={eyebrow}>Opulence Bliss</p>
            <h1 style={title}>Job invoice</h1>
          </div>
          <div style={{ textAlign: "right" }}>
            <strong>{invoice.invoice_number}</strong>
            <p style={muted}>
              Issued {new Date(invoice.issued_at).toLocaleDateString("en-GB")}
            </p>
          </div>
        </header>
        <section style={parties}>
          <div>
            <span style={label}>Professional</span>
            <strong>{providerName}</strong>
          </div>
          <div>
            <span style={label}>Customer</span>
            <strong>{invoice.customer_name}</strong>
          </div>
        </section>
        <section style={details}>
          <Row label="Service" value={invoice.service_name} />
          <Row
            label="Completed"
            value={new Date(invoice.completed_at).toLocaleString("en-GB", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          />
          <Row label="Address" value={invoice.address ?? "—"} />
          <Row
            label="Property size"
            value={
              invoice.property_size_sqm
                ? `${invoice.property_size_sqm} m²`
                : "—"
            }
          />
          <Row label="Duration" value={`${invoice.duration_minutes} minutes`} />
          <Row label="Customer total" value={money(invoice.gross_amount)} />
          <Row label="Platform fee" value={money(invoice.platform_fee)} />
          <Row
            label="Professional payout"
            value={money(invoice.payout_amount)}
            strong
          />
        </section>
        <footer style={footer}>
          Payment schedule:{" "}
          {String(invoice.payout_schedule).replace(
            "fortnightly",
            "every 2 weeks",
          )}{" "}
          · due{" "}
          {new Date(`${invoice.payout_due_on}T12:00:00`).toLocaleDateString(
            "en-GB",
          )}
        </footer>
      </article>
      <p className="print-help" style={printHelp}>
        Your PDF invoice is generated from this completed cleaning session.
      </p>
      <style>{`@media print { .portal-nav, .screen-actions, .print-help { display:none !important } body { background:white !important } }`}</style>
    </main>
  );
}

function Row({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div
      style={{
        ...row,
        ...(strong ? { fontSize: 18, borderTop: "2px solid #16202a" } : {}),
      }}
    >
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

const page: React.CSSProperties = {
  maxWidth: 820,
  margin: "0 auto",
  color: "#16202a",
  paddingBottom: 60,
};
const invoiceCard: React.CSSProperties = {
  border: "1px solid #dfe3e8",
  borderRadius: 18,
  background: "#fff",
  padding: 30,
};
const header: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 20,
  paddingBottom: 22,
  borderBottom: "2px solid #16202a",
};
const eyebrow: React.CSSProperties = {
  margin: 0,
  color: "#6d28d9",
  fontSize: 12,
  fontWeight: 900,
  letterSpacing: ".12em",
  textTransform: "uppercase",
};
const title: React.CSSProperties = {
  margin: "4px 0 0",
  fontSize: 32,
  fontWeight: 900,
};
const muted: React.CSSProperties = {
  margin: "4px 0 0",
  color: "#68717d",
  fontSize: 13,
};
const parties: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 20,
  padding: "22px 0",
};
const label: React.CSSProperties = {
  display: "block",
  color: "#68717d",
  fontSize: 11,
  fontWeight: 900,
  textTransform: "uppercase",
};
const details: React.CSSProperties = { display: "grid" };
const row: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 20,
  padding: "11px 0",
  borderTop: "1px solid #edf0f2",
};
const footer: React.CSSProperties = {
  marginTop: 22,
  borderRadius: 10,
  background: "#f4ecfe",
  padding: 13,
  color: "#5b2a86",
  fontWeight: 800,
};
const printHelp: React.CSSProperties = {
  color: "#68717d",
  fontSize: 13,
  textAlign: "center",
};
