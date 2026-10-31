"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type Offer = {
  id: string;
  minutes: number;
  amount_pence: number;
  status: string;
};
type State = {
  worker: boolean;
  offer: Offer | null;
  canOffer: boolean;
  canApprove: boolean;
  maxMinutes: number;
};
const money = (pence: number) => "£" + (pence / 100).toFixed(2);

export default function CleaningExtraHours({
  bookingId,
}: {
  bookingId: string;
}) {
  const endpoint = "/api/cleaning-extra-hours/" + bookingId;
  const [state, setState] = useState<State | null>(null);
  const [minutes, setMinutes] = useState(30);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const router = useRouter();
  const refresh = useCallback(async () => {
    const response = await fetch(endpoint, { cache: "no-store" });
    if (response.ok) setState(await response.json());
  }, [endpoint]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(endpoint, { cache: "no-store", signal: controller.signal })
      .then(async (response) => (response.ok ? response.json() : null))
      .then(setState)
      .catch(() => undefined);
    return () => controller.abort();
  }, [endpoint]);
  const pollActive = Boolean(
    state &&
    (state.canOffer ||
      state.canApprove ||
      state.offer?.status === "processing"),
  );
  useEffect(() => {
    if (!pollActive) return;
    const tick = () => {
      if (!document.hidden) void refresh().catch(() => undefined);
    };
    const timer = window.setInterval(tick, 10_000);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", tick);
    };
  }, [refresh, pollActive]);
  async function send(body: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, confirm: true }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Please try again.");
      setMessage(
        body.action === "offer"
          ? "Offer sent. Wait for the customer to approve and pay before doing extra work."
          : body.action === "decline"
            ? "Offer closed. The original visit is unchanged."
            : data.status === "succeeded"
              ? "Extra time paid and confirmed."
              : data.status === "processing"
                ? "Payment is processing. Do not pay again or start extra work until confirmed."
                : "Extra time was not added. Check your saved card and ask for a new offer.",
      );
      await refresh();
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  if (!state || (!state.canOffer && !state.offer)) return null;
  const offer = state.offer;
  return (
    <section
      aria-label="Extra cleaning time"
      className="rounded-2xl border p-5 my-4 space-y-3"
    >
      <h2 className="text-lg font-bold">Extra cleaning time</h2>
      <p>
        Extra time uses the original booked hourly price. It is only added after
        the customer approves and pays. The whole visit, including add-ons,
        stays within eight hours.
      </p>
      {offer?.status === "pending" && (
        <div className="space-y-3">
          <p>
            {offer.minutes} extra minutes for {money(offer.amount_pence)}.
          </p>
          {state.canApprove && (
            <>
              <p>
                Approve {offer.minutes} extra cleaning minutes and pay{" "}
                {money(offer.amount_pence)} now at the original booked hourly
                price.
              </p>
              <Button
                variant="outline"
                className="h-auto min-h-11 whitespace-normal rounded-full bg-[#6d28d9] px-5 py-3 text-white hover:bg-[#5b21b6] hover:text-white"
                disabled={busy}
                onClick={() =>
                  void send({
                    action: "approve",
                    offerId: offer.id,
                    amountPence: offer.amount_pence,
                  })
                }
              >
                {busy
                  ? "Processing…"
                  : "Approve and pay " + money(offer.amount_pence)}
              </Button>{" "}
            </>
          )}
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void send({ action: "decline", offerId: offer.id })}
          >
            {state.worker ? "Withdraw offer" : "Decline extra time"}
          </Button>
        </div>
      )}
      {offer?.status === "processing" && (
        <p role="status">
          Payment is processing. Wait for confirmation before starting extra
          work.
        </p>
      )}
      {offer?.status === "paid" && (
        <p>
          {offer.minutes} extra minutes paid and confirmed at{" "}
          {money(offer.amount_pence)}.
        </p>
      )}
      {["payment_failed", "review"].includes(offer?.status ?? "") && (
        <p>
          The extra-time payment needs attention. The original visit stays
          recorded. Check payment status before making another offer.
        </p>
      )}
      {state.canOffer &&
        offer?.status !== "pending" &&
        offer?.status !== "processing" &&
        state.maxMinutes >= 30 && (
          <div className="flex flex-wrap items-center gap-3">
            <label>
              Extra time{" "}
              <select
                value={minutes}
                onChange={(event) => setMinutes(Number(event.target.value))}
              >
                {Array.from(
                  { length: Math.floor(state.maxMinutes / 30) },
                  (_, i) => (i + 1) * 30,
                ).map((value) => (
                  <option key={value} value={value}>
                    {value} minutes
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void send({ action: "offer", minutes })}
            >
              {busy ? "Sending…" : "Offer extra time"}
            </Button>
          </div>
        )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
