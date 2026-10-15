import Stripe from "stripe";

export const dynamic = "force-dynamic";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const gbp = (pence: number) => "£" + (pence / 100).toFixed(2);

export default async function Success({
  searchParams,
}: {
  searchParams: Promise<{
    session_id?: string;
    saved?: string;
    error?: string;
  }>;
}) {
  const { session_id, saved, error } = await searchParams;
  let total = 0;
  let name = "";
  let ok = false;
  let upfrontRegular = false;
  let captured = false;
  let perVisit = false;
  let regularVisitCount = 6;
  if (session_id) {
    try {
      const session = await stripe.checkout.sessions.retrieve(session_id, {
        expand: ["payment_intent"],
      });
      const pi = session.payment_intent as Stripe.PaymentIntent;
      ok = pi.status === "requires_capture" || pi.status === "succeeded";
      captured = pi.status === "succeeded";
      total = captured ? pi.amount_received : pi.amount;
      name = pi.metadata?.package ?? "";
      upfrontRegular = pi.metadata?.upfront_regular === "1";
      perVisit = pi.metadata?.billing_model === "per_visit";
      const count = Number(pi.metadata?.regular_visit_count);
      if (Number.isInteger(count) && count >= 6 && count <= 10)
        regularVisitCount = count;
    } catch {
      ok = false;
    }
  }
  const persisted = saved === "1";
  const canRetry = ok && !persisted && Boolean(session_id);
  const paymentState = captured
    ? "Your payment was received"
    : "Your card was authorised";
  const statusMessage =
    ok && persisted
      ? captured
        ? upfrontRegular
          ? perVisit
            ? `${name} — your first visit is paid and all ${regularVisitCount} dates are booked. Each later visit is charged 48 hours before it starts. You can see each date in My Bookings.`
            : `${name} — all ${regularVisitCount} visits are booked and paid upfront. You can see each date in My Bookings.`
          : `${name} — your payment has been received. You can find your visit in My Bookings.`
        : `${name} — your card is held, not charged. You'll only be charged once the visit is complete.`
      : error === "booking_update_pending"
        ? `${paymentState}, but the booking system update is still being applied. Do not pay again. Retry saving this booking once the update is complete.`
        : error === "finalize_failed"
          ? `${paymentState}, but the booking could not be saved yet. Do not pay again. Use the retry button below or contact support.`
          : "We couldn't confirm the payment. Please check your account before trying again.";

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#FFFFFF",
        color: "#16202A",
        fontFamily: "'Nunito', system-ui, sans-serif",
        display: "grid",
        placeItems: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          background: "#fff",
          border: "1px solid #EDEFF1",
          borderRadius: 18,
          padding: "40px 36px",
          maxWidth: 460,
          width: "100%",
        }}
      >
        <p
          style={{
            textTransform: "uppercase",
            letterSpacing: "0.14em",
            fontSize: 12,
            fontWeight: 600,
            color: "#6D28D9",
            margin: "0 0 8px",
          }}
        >
          {ok
            ? captured
              ? "Payment received"
              : "Payment authorised"
            : "Payment status"}
        </p>
        <h1 style={{ fontWeight: 900, fontSize: 30, margin: "0 0 6px" }}>
          {ok && persisted ? "You're booked" : "Couldn't confirm the booking"}
        </h1>
        <p style={{ color: "#7A828C", margin: "0 0 24px" }}>{statusMessage}</p>
        {ok && (
          <dl style={{ margin: 0 }}>
            {[
              [
                captured
                  ? upfrontRegular && perVisit
                    ? "First visit paid"
                    : "Amount paid"
                  : "Amount authorised",
                gbp(total),
              ],
            ].map(([key, value]) => (
              <div
                key={key}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "14px 0",
                  borderBottom: "1px solid #F1F2F4",
                }}
              >
                <dt style={{ color: "#7A828C", fontSize: 14 }}>{key}</dt>
                <dd style={{ margin: 0, fontWeight: 600 }}>{value}</dd>
              </div>
            ))}
          </dl>
        )}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            flexWrap: "wrap",
            marginTop: 24,
          }}
        >
          {canRetry && (
            <a
              href={`/api/book/finalize?session_id=${encodeURIComponent(session_id!)}`}
              style={{
                display: "inline-block",
                padding: "10px 16px",
                borderRadius: 10,
                background: "#6D28D9",
                color: "#fff",
                fontSize: 14,
                fontWeight: 700,
              }}
            >
              Retry saving booking
            </a>
          )}
          <a href="/account" style={{ color: "#6D28D9", fontSize: 14 }}>
            View my bookings →
          </a>
        </div>
      </div>
    </main>
  );
}
