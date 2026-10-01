import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export default async function TipSuccess({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string; saved?: string; payout?: string; error?: string }>;
}) {
  const { session_id, saved, payout } = await searchParams;
  let amount = 0;
  let paid = false;
  if (session_id) {
    try {
      const session = await stripe.checkout.sessions.retrieve(session_id, { expand: ["payment_intent"] });
      const intent = session.payment_intent as Stripe.PaymentIntent;
      paid = intent.status === "succeeded";
      amount = intent.amount;
    } catch {
      paid = false;
    }
  }
  const ok = paid && saved === "1";
  return (
    <main style={{ minHeight: "70vh", background: "#FFFFFF", color: "#16202A", fontFamily: "'Nunito', system-ui, sans-serif", display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ background: "#fff", border: "1px solid #EDEFF1", borderRadius: 18, padding: "38px 34px", maxWidth: 420, textAlign: "center" }}>
        <p style={{ textTransform: "uppercase", letterSpacing: "0.14em", fontSize: 12, fontWeight: 600, color: "#6D28D9", margin: "0 0 8px" }}>Thank you</p>
        <h1 style={{ fontWeight: 900, fontSize: 28, margin: "0 0 8px" }}>{ok ? "Tip received" : "Couldn't confirm the tip"}</h1>
        <p style={{ color: "#7A828C", margin: "0 0 24px" }}>{ok ? payout === "sent" ? `£${(amount / 100).toFixed(2)} has been sent to your professional.` : `Your £${(amount / 100).toFixed(2)} tip was paid. Its transfer to your professional is pending review.` : "Please check your bookings before trying again, or contact support."}</p>
        <a href="/account" style={{ display: "inline-block", background: "#16202A", color: "#fff", padding: "12px 26px", borderRadius: 999, textDecoration: "none", fontWeight: 600 }}>Back to my bookings</a>
      </div>
    </main>
  );
}
