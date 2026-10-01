// SETUP: code "app/account/page.tsx"
//
// Client dashboard — bright, friendly, chunky.

import { createClient } from "@/lib/supabase/server";
import CurrentVisit, { type Visit } from "./CurrentVisit";
import {
  RateBooking,
  TipBooking,
  type BookingServiceOption,
} from "./BookingTools";
import VisitHistoryCard from "@/components/VisitHistoryCard";
import CustomerInvoiceDownloadButton from "@/components/CustomerInvoiceDownloadButton";
import {
  customerInvoiceNumber,
  type CustomerInvoicePdfData,
} from "@/lib/invoicePdf";

type Row = {
  duration_minutes: number | null;
  property_size_sqm: number | null;
  id: string;
  scheduled_at: string;
  status: string;
  address: string | null;
  package_id: string | null;
  subscription_id: string | null;
  household_notes: string | null;
  provider_delay_minutes: number | null;
  provider_delay_reported_at: string | null;
  packages:
    | { name: string; duration_minutes: number | null; price: number | null }
    | { name: string; duration_minutes: number | null; price: number | null }[]
    | null;
  providers:
    | {
        display_name: string | null;
        photo_url: string | null;
        years_experience: number | null;
        vetting_status: string | null;
        dbs_verified: boolean | null;
        public_rating_avg: number | null;
        public_rating_count: number | null;
      }
    | {
        display_name: string | null;
        photo_url: string | null;
        years_experience: number | null;
        vetting_status: string | null;
        dbs_verified: boolean | null;
        public_rating_avg: number | null;
        public_rating_count: number | null;
      }[]
    | null;
  check_ins:
    | { arrived_at: string | null; left_at: string | null }
    | { arrived_at: string | null; left_at: string | null }[]
    | null;
};

function one<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

const LABEL: Record<string, { text: string; bg: string; fg: string }> = {
  offered: { text: "Finding your pro", bg: "#FFF3D6", fg: "#8A5A00" },
  declined: { text: "Finding someone else", bg: "#FFF3D6", fg: "#8A5A00" },
  scheduled: { text: "Confirmed", bg: "#DFF5E8", fg: "#137B4E" },
  in_progress: { text: "Happening now", bg: "#DDEDFB", fg: "#1B5E9E" },
  completed: { text: "Completed", bg: "#EFEFF1", fg: "#4B5563" },
  cancelled: { text: "Cancelled", bg: "#FFE6EA", fg: "#B0384F" },
};

function when(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function clock(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function elapsed(
  start: string | null | undefined,
  end: string | null | undefined,
) {
  if (!start || !end) return null;
  const minutes = Math.max(
    0,
    Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000),
  );
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours}h ${rest}m` : `${rest}m`;
}

function firstName(name: string | null, email: string) {
  const n = (name ?? "").trim().split(" ")[0] || email.split("@")[0];
  return n.charAt(0).toUpperCase() + n.slice(1);
}

export default async function AccountPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return <SignedOut area="client" />;

  const { data: me } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", user.id)
    .maybeSingle();

  if (me?.role === "admin") return <WrongArea role="admin" />;

  const { data: rowsData } = await supabase
    .from("bookings")
    .select(
      "id, scheduled_at, status, address, package_id, subscription_id, household_notes, provider_delay_minutes, provider_delay_reported_at, duration_minutes, property_size_sqm, packages(name, duration_minutes, price), providers(display_name, photo_url, years_experience, vetting_status, dbs_verified, public_rating_avg, public_rating_count), check_ins(arrived_at, left_at)",
    )
    .order("scheduled_at", { ascending: false });

  const rows = (rowsData ?? []) as unknown as Row[];

  const { data: packageOptionsData } = await supabase
    .from("packages")
    .select("id, name, price, duration_minutes, service_type")
    .eq("active", true)
    .eq("billing_type", "per_visit")
    .order("price");
  const serviceOptions: BookingServiceOption[] = (packageOptionsData ?? []).map(
    (item) => ({
      id: item.id,
      name: item.name,
      price: Number(item.price),
      durationMinutes: item.duration_minutes,
      serviceType: item.service_type,
    }),
  );

  const { data: reviewData } = await supabase
    .from("reviews")
    .select("booking_id, rating, comment, reviewer, visibility");
  const { data: submissionData } = await supabase.rpc(
    "my_review_submission_states",
  );
  const clientSubmissionMap = new Map(
    (submissionData ?? [])
      .filter((review) => review.reviewer === "client")
      .map((review) => [review.booking_id as string, review.visibility as string]),
  );
  const clientReviewMap = new Map<
    string,
    { rating: number; comment: string | null; visibility?: "public" | "private" }
  >();
  const providerReviewMap = new Map<
    string,
    { rating: number; comment: string | null }
  >();
  for (const review of reviewData ?? []) {
    if (review.reviewer === "provider") {
      providerReviewMap.set(review.booking_id as string, {
        rating: review.rating as number,
        comment: review.comment as string | null,
      });
    } else {
      clientReviewMap.set(review.booking_id as string, {
        rating: review.rating as number,
        comment: review.comment as string | null,
        visibility: review.visibility as "public" | "private",
      });
    }
  }

  const { data: paymentData } = await supabase
    .from("payments")
    .select("booking_id, gross_amount, status, kind");
  const paymentMap = new Map(
    (paymentData ?? [])
      .filter((p) => p.booking_id && p.kind !== "tip")
      .map((p) => [
        p.booking_id as string,
        { amount: Number(p.gross_amount ?? 0), status: p.status as string },
      ]),
  );
  const tipMap = new Map<string, number>();
  for (const payment of paymentData ?? []) {
    if (
      !payment.booking_id ||
      payment.kind !== "tip" ||
      payment.status !== "succeeded"
    ) {
      continue;
    }
    const bookingId = payment.booking_id as string;
    tipMap.set(
      bookingId,
      (tipMap.get(bookingId) ?? 0) + Number(payment.gross_amount ?? 0),
    );
  }

  const active = rows.find((r) => r.status === "in_progress");
  const upcoming = rows
    .filter((r) => ["offered", "declined", "scheduled"].includes(r.status))
    .sort(
      (a, b) =>
        new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime(),
    );
  const history = rows.filter((r) =>
    ["completed", "cancelled"].includes(r.status),
  );
  const featured = active ?? upcoming[0] ?? null;
  const rest = upcoming.filter((r) => r.id !== featured?.id);
  const toVisit = (r: Row): Visit => {
    const pkg = one(r.packages);
    const prv = one(r.providers);
    const ci = one(r.check_ins);
    const payment = paymentMap.get(r.id);
    const amount = payment?.amount ?? Number(pkg?.price ?? 0);
    const paymentLabel =
      payment?.status === "refunded"
        ? `£${amount.toFixed(2)} refunded`
        : payment?.status === "partially_refunded"
          ? "Partly refunded"
        : payment?.status === "cancelled"
          ? "Hold released"
          : payment?.status === "capture_failed"
            ? "Payment issue"
            : payment?.status === "succeeded"
              ? `£${amount.toFixed(2)} paid`
              : payment?.status === "authorised"
                ? `£${amount.toFixed(2)} held`
                : amount > 0
                  ? `£${amount.toFixed(2)}`
                  : "Included";
    return {
      id: r.id,
      packageId: r.package_id ?? "",
      status: r.status,
      scheduled_at: r.scheduled_at,
      address: r.address,
      service: pkg?.name ?? "Service",
      durationMinutes: r.duration_minutes ?? pkg?.duration_minutes ?? null,
      providerName: prv?.display_name ?? null,
      providerPhoto: prv?.photo_url ?? null,
      providerYearsExperience: prv?.years_experience ?? null,
      providerVerified: prv?.dbs_verified === true,
      providerRating: prv?.public_rating_avg ?? null,
      providerRatingCount: prv?.public_rating_count ?? 0,
      paymentAmount: amount > 0 ? amount : null,
      paymentStatus: payment?.status ?? null,
      paymentLabel,
      arrivedAt: ci?.arrived_at ?? null,
      finishedAt: ci?.left_at ?? null,
      delayMinutes: r.provider_delay_minutes ?? null,
      delayReportedAt: r.provider_delay_reported_at ?? null,
      bookingNotes: r.household_notes ?? "",
    };
  };

  const unrated = history.filter(
    (b) => b.status === "completed" && !clientSubmissionMap.has(b.id),
  );

  return (
    <main style={wrap}>
      <link rel="stylesheet" href={FONT} />

      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        {/* ---- welcome ---- */}
        <h1 style={h1}>
          Hey {firstName(me?.full_name ?? null, user.email ?? "there")} 👋
        </h1>
        <p style={lede}>
          {featured
            ? "Here's what's coming up."
            : "Nothing booked — fancy sorting that?"}
        </p>

        {/* ---- rate prompt ---- */}
        {unrated.length > 0 && (
          <div style={rateBox}>
            <strong style={{ fontSize: 17, fontWeight: 900 }}>
              How was your{" "}
              {one<{ name: string }>(unrated[0].packages)?.name ?? "visit"}?
            </strong>
            <p style={{ margin: "4px 0 0", fontSize: 14.5, color: "#8A5A00" }}>
              A quick rating helps other customers and rewards good pros.
            </p>
            <RateBooking id={unrated[0].id} existing={null} />
          </div>
        )}

        {/* ---- current visit ---- */}
        {featured ? (
          <>
            <h2 style={h2}>{active ? "Current booking" : "Next booking"}</h2>
            <CurrentVisit
              visit={toVisit(featured)}
              serviceOptions={serviceOptions}
            />
          </>
        ) : (
          <EmptyNextBooking />
        )}

        {/* ---- also coming up ---- */}
        {rest.length > 0 && (
          <>
            <h2 style={h2}>Also coming up</h2>
            <div style={{ display: "grid", gap: 12, marginBottom: 30 }}>
              {rest.map((booking) => (
                <CurrentVisit
                  key={booking.id}
                  visit={toVisit(booking)}
                  serviceOptions={serviceOptions}
                />
              ))}
            </div>
          </>
        )}

        {/* ---- past ---- */}
        <h2 style={h2}>Past visits</h2>
        {history.length === 0 ? (
          <div style={{ ...card, textAlign: "center", color: "#6b7280" }}>
            Nothing yet.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {history.map((b) => {
              const pkg = one(b.packages);
              const prv = one(b.providers);
              const ci = one(b.check_ins);
              const st = LABEL[b.status] ?? LABEL.completed;
              const clientReview = clientReviewMap.get(b.id);
              const submittedVisibility = clientSubmissionMap.get(b.id);
              const providerReview = providerReviewMap.get(b.id);
              const payment = paymentMap.get(b.id);
              const tipAmount = tipMap.get(b.id) ?? 0;
              const actualDuration = elapsed(ci?.arrived_at, ci?.left_at);
              const invoiceIssuedAt = ci?.left_at ?? b.scheduled_at;
              const clientInvoice: CustomerInvoicePdfData | null =
                b.status === "completed"
                  ? {
                      invoiceNumber: customerInvoiceNumber(
                        b.id,
                        invoiceIssuedAt,
                      ),
                      issuedAt: invoiceIssuedAt,
                      status: b.subscription_id
                        ? "Included with membership"
                        : payment?.status === "succeeded"
                          ? "Paid"
                          : "Payment recorded",
                      customerName:
                        me?.full_name ?? user.email ?? "Customer",
                      professionalName:
                        prv?.display_name ?? "Professional",
                      serviceName: pkg?.name ?? "Service",
                      address: b.address,
                      propertySizeSqm:
                        b.property_size_sqm === null
                          ? null
                          : Number(b.property_size_sqm),
                      bookedAt: b.scheduled_at,
                      durationMinutes: Number(
                        b.duration_minutes ?? pkg?.duration_minutes ?? 0,
                      ),
                      checkedInAt: ci?.arrived_at ?? null,
                      checkedOutAt: ci?.left_at ?? null,
                      serviceAmount: b.subscription_id
                        ? null
                        : (payment?.amount ?? Number(pkg?.price ?? 0)),
                      tipAmount,
                      membership: Boolean(b.subscription_id),
                    }
                  : null;
              return (
                <VisitHistoryCard
                  key={b.id}
                  title={pkg?.name ?? "Service"}
                  when={when(b.scheduled_at)}
                  status={st.text}
                  statusTone={b.status === "completed" ? "good" : "bad"}
                  rating={
                    b.status === "completed"
                      ? {
                          label: "Your rating for the provider",
                          rating: clientReview?.rating ?? null,
                          comment: clientReview?.comment ?? null,
                          submitted: Boolean(submittedVisibility),
                          pending: submittedVisibility
                            ? "Your private review was sent to the provider"
                            : "Your rating is still needed",
                        }
                      : null
                  }
                  secondaryRating={
                    b.status === "completed"
                      ? {
                          label: "Provider's rating of you",
                          rating: providerReview?.rating ?? null,
                          comment: providerReview?.comment ?? null,
                          pending: "The provider has not rated this visit yet",
                        }
                      : null
                  }
                  facts={[
                    {
                      label: "Provider",
                      value: prv?.display_name ?? "Not assigned",
                    },
                    { label: "Address", value: b.address ?? "—" },
                    {
                      label: "Duration",
                      value:
                        actualDuration ??
                        ((b.duration_minutes ?? pkg?.duration_minutes)
                          ? `${b.duration_minutes ?? pkg?.duration_minutes} minutes planned`
                          : "—"),
                    },
                    {
                      label: "Arrival / finish",
                      value: ci?.arrived_at
                        ? `${clock(ci.arrived_at)} – ${clock(ci.left_at)}`
                        : "No check-in recorded",
                    },
                    {
                      label: "Amount",
                      value: payment
                        ? `£${payment.amount.toFixed(2)}`
                        : pkg?.price
                          ? `£${Number(pkg.price).toFixed(2)}`
                          : "—",
                    },
                    { label: "Payment", value: payment?.status ?? "—" },
                  ]}
                >
                  {b.status === "completed" && (
                    <>
                      {clientInvoice && (
                        <CustomerInvoiceDownloadButton
                          invoice={clientInvoice}
                          label="Download invoice"
                          style={invoiceButton}
                        />
                      )}
                      {!submittedVisibility && (
                        <RateBooking id={b.id} existing={null} />
                      )}
                      <TipBooking id={b.id} />
                      <p style={{ margin: "12px 0 0" }}>
                        <a
                          href={`/book?service=${b.package_id ?? ""}&pc=${b.address ?? ""}`}
                          style={{
                            color: "#6D28D9",
                            fontWeight: 800,
                            fontSize: 14,
                            textDecoration: "none",
                          }}
                        >
                          Book this again →
                        </a>
                      </p>
                    </>
                  )}
                </VisitHistoryCard>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

function EmptyNextBooking() {
  return (
    <section className="account-empty-booking" style={emptyBig}>
      <div style={emptyIcon} aria-hidden="true">
        ◫
      </div>
      <div style={{ minWidth: 0 }}>
        <strong style={emptyTitle}>
          You don&apos;t have any upcoming bookings yet
        </strong>
        <p style={emptyCopy}>
          Treat yourself to a little self-care. Book a service in just a few
          taps.
        </p>
      </div>
      <a href="/book" style={emptyButton}>
        Book a service
      </a>
    </section>
  );
}

/* ---------- shared notices ---------- */

export function SignedOut({ area }: { area: "client" | "provider" }) {
  const isClient = area === "client";
  return (
    <Notice
      emoji="🔑"
      title="Please log in"
      body={
        isClient
          ? "Log in to see your visits and bookings."
          : "Log in to see the jobs assigned to you."
      }
      href="/login"
      cta="Go to log in"
    />
  );
}

export function WrongArea({ role }: { role: "admin" | "provider" }) {
  const isAdmin = role === "admin";
  return (
    <Notice
      emoji={isAdmin ? "🛠" : "🧹"}
      title="This is the customer area"
      body={
        isAdmin
          ? "You're signed in as an admin — your tools are in the control panel."
          : "You're signed in as a provider — your jobs are in the provider area."
      }
      href={isAdmin ? "/admin" : "/worker"}
      cta={isAdmin ? "Go to control panel" : "Go to my jobs"}
    />
  );
}

function Notice({
  emoji,
  title,
  body,
  href,
  cta,
}: {
  emoji: string;
  title: string;
  body: string;
  href: string;
  cta: string;
}) {
  return (
    <main style={{ ...wrap, display: "grid", placeItems: "center" }}>
      <link rel="stylesheet" href={FONT} />
      <div
        style={{
          ...card,
          maxWidth: 420,
          textAlign: "center",
          padding: "34px 30px",
        }}
      >
        <div style={{ fontSize: 38 }}>{emoji}</div>
        <h1 style={{ ...h1, fontSize: 25, margin: "10px 0 6px" }}>{title}</h1>
        <p style={{ color: "#6b7280", margin: "0 0 22px", fontSize: 15 }}>
          {body}
        </p>
        <a href={href} style={btn}>
          {cta}
        </a>
      </div>
    </main>
  );
}

/* ---------- styles ---------- */

const FONT =
  "https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap";

const wrap: React.CSSProperties = {
  minHeight: "100vh",
  background: "#FCFAFF",
  color: "#1F2933",
  fontFamily: "'Nunito', system-ui, sans-serif",
};
const h1: React.CSSProperties = {
  fontSize: 32,
  fontWeight: 900,
  letterSpacing: "-0.025em",
  margin: "0 0 4px",
};
const lede: React.CSSProperties = {
  color: "#6b7280",
  fontSize: 16,
  fontWeight: 600,
  margin: "0 0 24px",
};
const h2: React.CSSProperties = {
  fontSize: 21,
  fontWeight: 900,
  letterSpacing: "-0.02em",
  margin: "0 0 14px",
};
const card: React.CSSProperties = {
  background: "#fff",
  border: "2px solid #F1F1F2",
  borderRadius: 20,
  padding: "20px 22px",
};
const btn: React.CSSProperties = {
  display: "inline-block",
  background: "linear-gradient(100deg,#F5C542,#C86FC9 55%,#7B2FF7)",
  color: "#fff",
  padding: "13px 28px",
  borderRadius: 999,
  textDecoration: "none",
  fontWeight: 900,
  fontSize: 15.5,
};
const invoiceButton: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  border: 0,
  borderRadius: 999,
  background: "#6D28D9",
  color: "#fff",
  padding: "10px 16px",
  font: "inherit",
  fontSize: 13.5,
  fontWeight: 900,
  cursor: "pointer",
};
const rateBox: React.CSSProperties = {
  background: "#FFF3D6",
  border: "2px solid #FFDF9E",
  borderRadius: 20,
  padding: "20px 22px",
  marginBottom: 20,
  color: "#8A5A00",
};
const emptyBig: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto minmax(0, 1fr) auto",
  alignItems: "center",
  gap: 28,
  minHeight: 150,
  boxSizing: "border-box",
  marginBottom: 22,
  padding: "24px 34px",
  border: "1px solid var(--ob-border)",
  borderRadius: 18,
  background: "var(--ob-surface)",
};
const emptyIcon: React.CSSProperties = {
  display: "grid",
  placeItems: "center",
  width: 86,
  height: 86,
  borderRadius: "50%",
  background: "var(--ob-purple-soft)",
  color: "var(--ob-purple)",
  fontSize: 44,
  fontWeight: 900,
};
const emptyTitle: React.CSSProperties = {
  display: "block",
  maxWidth: 320,
  color: "var(--ob-text)",
  fontSize: 18,
  fontWeight: 900,
};
const emptyCopy: React.CSSProperties = {
  maxWidth: 430,
  margin: "5px 0 0",
  color: "var(--ob-muted)",
  fontSize: 13.5,
  fontWeight: 650,
};
const emptyButton: React.CSSProperties = {
  display: "inline-block",
  minWidth: 190,
  boxSizing: "border-box",
  borderRadius: 10,
  background: "linear-gradient(100deg,#F5C542,#C86FC9 55%,#7B2FF7)",
  color: "#fff",
  padding: "13px 24px",
  textAlign: "center",
  fontSize: 14,
  fontWeight: 900,
  textDecoration: "none",
};
