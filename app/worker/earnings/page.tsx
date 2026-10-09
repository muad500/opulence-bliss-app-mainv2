// Provider earnings — what you've made and what's coming.
// Save at: app/worker/earnings/page.tsx

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { SignedOut } from "@/app/account/page";
import { handymanEnabled } from "@/lib/handymanMarketplace";
import { handymanEarnings } from "@/lib/professionalEarnings";
import {
  allHandymanEarnings,
  privatePortalClient,
} from "@/lib/professionalPortal";
import { earningsPeriodTotals } from "@/lib/earningsPeriod";
import PayoutScheduleForm from "./PayoutScheduleForm";

const gbp = (n: number) =>
  "£" + Number(n || 0).toLocaleString("en-GB", { minimumFractionDigits: 2 });

type Bk = {
  scheduled_at: string;
  status: string;
  packages: { name: string } | { name: string }[] | null;
};

type Pay = {
  id: string;
  booking_id: string;
  gross_amount: number;
  split_breakdown: { provider?: number } | null;
  status: string;
  kind: string | null;
  created_at: string;
  bookings: Bk | Bk[] | null;
};

function one<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function svc(p: Pay) {
  const b = one<Bk>(p.bookings);
  const pk = one<{ name: string }>(b?.packages ?? null);
  return pk?.name ?? "Service";
}

async function allEarningsRows(
  client: SupabaseClient,
  table: string,
  fields: string,
  providerId: string,
) {
  const rows: unknown[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await client
      .from(table)
      .select(fields)
      .eq("bookings.provider_id", providerId)
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, from + 499);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 500) return rows;
  }
}

export default async function EarningsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return <SignedOut area="provider" />;

  const { data: prov } = await supabase
    .from("providers")
    .select("id, rating_avg, rating_count, payout_schedule")
    .eq("profile_id", user.id)
    .maybeSingle();

  if (!prov) return <p>Your professional account could not be found.</p>;

  let paysData: unknown[];
  let payoutData: unknown[];
  try {
    [paysData, payoutData] = await Promise.all([
      allEarningsRows(
        supabase,
        "payments",
        "id,booking_id,gross_amount,split_breakdown,status,kind,created_at,bookings!inner(provider_id,scheduled_at,status,packages(name))",
        prov.id,
      ),
      allEarningsRows(
        supabase,
        "payouts",
        "id,booking_id,amount,status,note,created_at,bookings!inner(provider_id,scheduled_at,status,packages(name))",
        prov.id,
      ),
    ]);
  } catch {
    return (
      <main style={wrap}>
        <h1 style={h1}>My earnings</h1>
        <p>Earnings could not be loaded. Please try again.</p>
      </main>
    );
  }

  const { data: invoiceData } = await supabase
    .from("provider_job_invoices")
    .select(
      "id, invoice_number, issued_at, payout_amount, status, service_name",
    )
    .eq("provider_id", prov.id)
    .order("issued_at", { ascending: false })
    .limit(12);

  const handyman = handymanEarnings(
    handymanEnabled()
      ? await allHandymanEarnings(privatePortalClient(), prov.id)
      : [],
  );
  const handymanPeriods = earningsPeriodTotals(handyman.periods);
  const pays = (paysData ?? []) as unknown as Pay[];
  const share = (p: Pay) => Number(p.split_breakdown?.provider ?? 0);

  const jobs = pays.filter((p) => p.kind !== "tip");
  const tips = pays.filter((p) => p.kind === "tip" && p.status === "succeeded");

  const paid = jobs.filter((p) => p.status === "succeeded");
  const held = jobs.filter((p) =>
    ["created", "authorised", "capturing"].includes(p.status),
  );

  // Membership visits, paid by transfer
  type Payout = {
    id: string;
    booking_id: string;
    amount: number;
    status: string;
    note: string | null;
    created_at: string;
    bookings: Bk | Bk[] | null;
  };
  const payouts = (payoutData ?? []) as unknown as Payout[];
  const payoutsPaid = payouts.filter((p) => p.status === "paid");
  const settledPayoutBookingIds = new Set(payoutsPaid.map((p) => p.booking_id));
  const paidWithoutPayout = paid.filter(
    (p) => !settledPayoutBookingIds.has(p.booking_id),
  );

  const earned =
    paidWithoutPayout.reduce((s, p) => s + share(p), 0) +
    payoutsPaid.reduce((s, p) => s + Number(p.amount ?? 0), 0);
  const payoutBookingIds = new Set(payouts.map((p) => p.booking_id));
  const pendingTotal =
    held
      .filter((p) => !payoutBookingIds.has(p.booking_id))
      .reduce((s, p) => s + share(p), 0) +
    payouts
      .filter((p) =>
        ["not_ready", "pending", "processing", "held"].includes(p.status),
      )
      .reduce((s, p) => s + Number(p.amount ?? 0), 0);
  const tipTotal = tips.reduce((s, p) => s + share(p), 0);
  const visitCount = new Set(
    [...paid, ...payoutsPaid]
      .filter((p) => one<Bk>(p.bookings)?.status === "completed")
      .map((p) => p.booking_id),
  ).size;
  const periods = earningsPeriodTotals([
    ...paidWithoutPayout
      .filter((p) => one<Bk>(p.bookings)?.status === "completed")
      .map((p) => ({
        date: one<Bk>(p.bookings)?.scheduled_at ?? p.created_at,
        amount: share(p),
      })),
    ...tips.map((p) => ({ date: p.created_at, amount: share(p) })),
    ...payoutsPaid
      .filter((p) => one<Bk>(p.bookings)?.status === "completed")
      .map((p) => ({
        date: one<Bk>(p.bookings)?.scheduled_at ?? p.created_at,
        amount: Number(p.amount ?? 0),
      })),
  ]);

  // One combined list, newest first
  const rows: {
    key: string;
    service: string;
    when: string | null;
    label: string;
    amount: number;
    state: string;
    note?: string | null;
    gross?: number;
  }[] = [
    ...handyman.rows,
    ...pays.map((p) => ({
      key: `pay-${p.id}`,
      service:
        p.kind === "tip" ? `Cleaning tip · ${svc(p)}` : `Cleaning · ${svc(p)}`,
      when: one<Bk>(p.bookings)?.scheduled_at ?? null,
      label: `customer paid ${gbp(p.gross_amount)}`,
      amount: share(p),
      state:
        p.status === "succeeded"
          ? "Paid"
          : p.status === "refunded"
            ? "Cancelled"
            : "Pending",
      gross: p.gross_amount,
    })),
    ...payouts.map((p) => ({
      key: `out-${p.id}`,
      service: `Cleaning visit payout · ${
        one<{ name: string }>(one<Bk>(p.bookings)?.packages ?? null)?.name ??
        "Service"
      }`,
      when: one<Bk>(p.bookings)?.scheduled_at ?? null,
      label: "professional payout",
      amount: Number(p.amount ?? 0),
      state: p.status === "paid" ? "Paid" : "Pending",
      note: p.note,
    })),
  ].sort((a, b) => {
    const x = a.when ? new Date(a.when).getTime() : 0;
    const y = b.when ? new Date(b.when).getTime() : 0;
    return y - x;
  });

  return (
    <main style={wrap}>
      <link rel="stylesheet" href={FONTS} />
      <div style={{ maxWidth: 760 }}>
        <h1 style={h1}>Earnings</h1>
        <p style={{ color: "#7A828C", margin: "0 0 26px", fontWeight: 600 }}>
          Your payments, tips and settlement history, split by service.
        </p>

        <div className="worker-status-grid" style={statGrid}>
          <Stat
            label="Payments recorded"
            value={gbp(earned + tipTotal + handyman.settled)}
            big
          />
          <Stat
            label="Settled earnings this week"
            value={gbp(periods.week + handymanPeriods.week)}
          />
          <Stat
            label="Settled earnings this month"
            value={gbp(periods.month + handymanPeriods.month)}
          />
          <Stat
            label="Awaiting settlement"
            value={gbp(pendingTotal + handyman.awaitingSettlement)}
          />
          <Stat label="Tips received" value={gbp(tipTotal)} />
          <Stat
            label="Visits completed"
            value={String(visitCount + handyman.paid.length)}
          />
          <Stat
            label="Your rating"
            value={
              prov?.rating_avg
                ? `${Number(prov.rating_avg).toFixed(1)} ★ (${prov.rating_count})`
                : "No ratings yet"
            }
          />
        </div>

        <p style={{ color: "#7A828C", fontSize: 13 }}>
          Week and month totals include settled completed visits, using the
          visit date in London time; tips use the recorded date. Captured visit
          payments and their payouts count once. These figures do not confirm
          arrival in your bank account.
        </p>
        <p>
          <a href="/api/account/earnings-statement" style={link}>
            Download earnings statement (CSV)
          </a>
        </p>
        <section style={card}>
          <h2 style={sectionTitle}>By service</h2>
          <p>
            Cleaning — recorded payments: {gbp(earned + tipTotal)} · settled
            this week: {gbp(periods.week)} · this month: {gbp(periods.month)}
          </p>
          {handymanEnabled() && (
            <p>
              Handyman — settled transfers: {gbp(handyman.settled)} · this week:{" "}
              {gbp(handymanPeriods.week)} · this month:{" "}
              {gbp(handymanPeriods.month)}. Materials and VAT pass through to
              you.
            </p>
          )}
        </section>
        <PayoutScheduleForm current={prov?.payout_schedule ?? "weekly"} />

        <h2 style={sectionTitle}>Job invoices</h2>
        {(invoiceData ?? []).length === 0 ? (
          <div style={{ ...empty, marginBottom: 30 }}>
            Invoices appear automatically after completed jobs.
          </div>
        ) : (
          <div
            className="worker-payment-list"
            style={{ ...card, padding: "6px 22px", marginBottom: 30 }}
          >
            {(invoiceData ?? []).map((invoice) => (
              <div className="worker-payment-row" key={invoice.id} style={row}>
                <div>
                  <strong style={{ fontSize: 15 }}>
                    {invoice.invoice_number}
                  </strong>
                  <div style={{ color: "#7A828C", fontSize: 13 }}>
                    {invoice.service_name} ·{" "}
                    {new Date(invoice.issued_at).toLocaleDateString("en-GB")}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <strong>{gbp(invoice.payout_amount)}</strong>
                  <div>
                    <a href={`/worker/invoices/${invoice.id}`} style={link}>
                      View invoice
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <h2 style={sectionTitle}>Every payment</h2>
        {rows.length === 0 ? (
          <div style={empty}>
            No earnings yet. Once you complete a visit it&apos;ll appear here.
          </div>
        ) : (
          <div
            className="worker-payment-list"
            style={{ ...card, padding: "6px 22px" }}
          >
            {rows.map((r) => (
              <div className="worker-payment-row" key={r.key} style={row}>
                <div>
                  <strong style={{ fontSize: 15, color: "#16202A" }}>
                    {r.service}
                  </strong>
                  <div style={{ color: "#7A828C", fontSize: 13 }}>
                    {r.when
                      ? new Date(r.when).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })
                      : "—"}{" "}
                    · {r.label}
                  </div>
                  {r.note && (
                    <div style={{ color: "#B0384F", fontSize: 12.5 }}>
                      {r.note}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <strong style={{ fontSize: 16 }}>{gbp(r.amount)}</strong>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: r.state === "Paid" ? "#16202A" : "#B0384F",
                    }}
                  >
                    {r.state}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <p
          className="worker-status-links"
          style={{ marginTop: 28, display: "flex", gap: 18 }}
        >
          <a href="/worker" style={link}>
            ← My jobs
          </a>
          <a href="/worker/profile" style={link}>
            My profile
          </a>
          <a href="/worker/availability" style={link}>
            My availability
          </a>
        </p>
      </div>
    </main>
  );
}

function Stat({
  label,
  value,
  big,
}: {
  label: string;
  value: string;
  big?: boolean;
}) {
  return (
    <div
      className="worker-status-card"
      style={{ ...card, padding: "20px 22px" }}
    >
      <p
        className="worker-status-value"
        style={{
          fontFamily: "'Nunito', system-ui, sans-serif",
          fontSize: big ? 30 : 22,
          color: "#16202A",
          margin: "0 0 3px",
        }}
      >
        {value}
      </p>
      <span style={{ color: "#7A828C", fontSize: 13.5 }}>{label}</span>
    </div>
  );
}

const FONTS =
  "https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap";
const wrap: React.CSSProperties = {
  background: "transparent",
  color: "#16202A",
  fontFamily: "'Nunito', system-ui, sans-serif",
  padding: 0,
};
const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #EDEFF1",
  borderRadius: 16,
};
const statGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
  gap: 12,
  marginBottom: 34,
};
const row: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 14,
  padding: "15px 0",
  borderBottom: "1px solid #F1F2F4",
};
const h1: React.CSSProperties = {
  fontFamily: "'Nunito', system-ui, sans-serif",
  fontWeight: 900,
  fontSize: 38,
  color: "#16202A",
  margin: "0 0 6px",
};
const sectionTitle: React.CSSProperties = {
  fontFamily: "'Nunito', system-ui, sans-serif",
  fontWeight: 900,
  fontSize: 22,
  color: "#16202A",
  margin: "0 0 14px",
};
const empty: React.CSSProperties = {
  background: "#fff",
  border: "1.5px dashed #E5E7EA",
  borderRadius: 14,
  padding: "28px 24px",
  textAlign: "center",
  color: "#7A828C",
};
const link: React.CSSProperties = { color: "#6D28D9", fontSize: 14 };
