"use client";
import { useState } from "react";
export default function ReplacementCancellation({
  bookingId,
  revision,
}: {
  bookingId: string;
  revision: number;
}) {
  const [confirm, setConfirm] = useState(false),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function cancel() {
    setBusy(true);
    try {
      const response = await fetch("/api/account/replacement-cancellation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId, revision, confirm }),
      });
      const r = await response.json();
      if (!response.ok) throw Error(r.error);
      setMessage(
        r.status === "succeeded"
          ? "Cancelled at no charge. Any payment for this visit has been refunded in full."
          : "Free cancellation recorded. Your refund is processing; please do not pay again.",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not cancel.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      style={{
        background: "#f8f3ff",
        padding: 20,
        borderRadius: 16,
        margin: "16px 0",
      }}
    >
      <h2>Your original cleaner cannot attend</h2>
      <p>
        We are offering this visit to another cleaner. You can keep the visit,
        or choose to cancel instead at no charge. Any payment for this visit
        will be refunded in full.
      </p>
      <label>
        <input
          type="checkbox"
          checked={confirm}
          onChange={(e) => setConfirm(e.target.checked)}
        />{" "}
        I want to cancel this visit instead of accepting a replacement.
      </label>
      <p>
        <button
          disabled={!confirm || busy || !!message}
          onClick={() => void cancel()}
        >
          Cancel this visit free
        </button>
      </p>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
