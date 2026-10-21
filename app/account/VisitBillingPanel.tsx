"use client";

import { useEffect, useState } from "react";
import type { CleaningBillingTerms } from "@/lib/cleaningBillingTerms";
import { CLEANING_ADDONS } from "@/lib/cleaningExtras";
import {
  LEGACY_SCHEDULED_VISIT_PAYMENT_COPY,
  ONE_OFF_PAYMENT_COPY,
  REGULAR_PAYMENT_COPY,
} from "@/lib/cleaningPaymentCopy";
import type { CancellationPolicy } from "@/lib/cancellationPolicy";

export type VisitBillingDetails = {
  model: "legacy" | "per_visit";
  regular?: boolean;
  pricing: Omit<CleaningBillingTerms, "cleanerHourlyPence">;
  chargeOnAcceptance?: boolean;
  revision: number;
  status: string;
  processing: boolean;
  amountPence: number;
  paidPence: number;
  dueAt: string;
  cardUpdateDeadline?: string | null;
  addons: string[];
  bringsProducts: boolean;
  canChange: boolean;
  cancellationPolicy: CancellationPolicy;
};
type Quote = {
  revision: number;
  chargePence: number;
  refundPence: number;
  amountPence: number;
  durationMinutes: number;
  changed: boolean;
};
const money = (pence: number) => `£${(pence / 100).toFixed(2)}`;

export default function VisitBillingPanel({
  bookingId,
  onLoaded,
}: {
  bookingId: string;
  onLoaded: (details: VisitBillingDetails) => void;
}) {
  const [details, setDetails] = useState<VisitBillingDetails | null>(null);
  const [addons, setAddons] = useState<string[]>([]);
  const [products, setProducts] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const endpoint = `/api/account/visits/${bookingId}/billing`;

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const response = await fetch(endpoint, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        if (stopped) return;
        setDetails(data);
        onLoaded(data);
        setAddons(data.addons ?? []);
        setProducts(data.bringsProducts ?? false);
        if (data.processing) timer = setTimeout(refresh, 5000);
      } catch {
        if (!stopped)
          setMessage(
            "Payment details could not be loaded. Please refresh before making a change.",
          );
      }
    }
    void refresh();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [endpoint, onLoaded]);

  async function requestChange(confirm = false) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: confirm ? "confirm" : "quote",
          confirm,
          addons,
          bringsProducts: products,
          ...(confirm && quote
            ? {
                revision: quote.revision,
                chargePence: quote.chargePence,
                refundPence: quote.refundPence,
              }
            : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (!confirm) setQuote(data);
      else if (data.status === "succeeded") window.location.reload();
      else if (data.status === "failed") {
        setQuote(null);
        setMessage(
          "Your card was not charged. Update your saved card in Payments, then try again.",
        );
      } else {
        setQuote(null);
        setDetails((old) =>
          old ? { ...old, processing: true, canChange: false } : old,
        );
        setMessage(
          "Your change is processing. Do not pay again; refresh shortly for its status.",
        );
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The update failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!details)
    return <p role="status">{message ?? "Loading visit payment details…"}</p>;
  if (details.model === "legacy")
    return (
      <p>
        To change add-ons on this existing booking,{" "}
        <a href="mailto:hello@opulencebliss.com">contact us</a>.
      </p>
    );
  return (
    <section className="visit-billing" aria-label="Visit payment and add-ons">
      <h2>Payment and add-ons</h2>
      <p>
        Visit price: <strong>{money(details.amountPence)}</strong> · Paid after
        refunds: <strong>{money(details.paidPence)}</strong>
      </p>
      {["unpaid", "failed", "requires_action"].includes(details.status) && (
        <p>
          {details.chargeOnAcceptance
            ? REGULAR_PAYMENT_COPY
            : details.regular
              ? LEGACY_SCHEDULED_VISIT_PAYMENT_COPY
              : ONE_OFF_PAYMENT_COPY}{" "}
          Paused visits are not charged.{" "}
          <a href="/account/profile#payments">Manage your saved card</a>.
        </p>
      )}
      {["failed", "requires_action"].includes(details.status) &&
        details.cardUpdateDeadline && (
          <p role="alert">
            Update your saved card before{" "}
            {new Intl.DateTimeFormat("en-GB", {
              dateStyle: "medium",
              timeStyle: "short",
              timeZone: "Europe/London",
            }).format(new Date(details.cardUpdateDeadline))}{" "}
            (London time). If payment still fails, this visit will be cancelled.
          </p>
        )}
      {details.processing && (
        <p role="status">
          A payment change is processing. Please do not pay again.
        </p>
      )}
      {details.status === "review" && (
        <p role="status">
          Our team needs to review this visit’s payment before further changes.
          Your existing payments remain recorded; please contact support.
        </p>
      )}
      <fieldset disabled={busy || !details.canChange}>
        <legend>Add-ons for this visit</legend>
        {CLEANING_ADDONS.map((addon) => (
          <label key={addon.id}>
            <input
              type="checkbox"
              checked={addons.includes(addon.id)}
              onChange={(event) => {
                setAddons(
                  event.target.checked
                    ? [...addons, addon.id]
                    : addons.filter((id) => id !== addon.id),
                );
                setQuote(null);
              }}
            />
            {addon.label} · {money(details.pricing.addonPrices[addon.id])} · up
            to 1 hour
          </label>
        ))}
        <label>
          <input
            type="checkbox"
            checked={products}
            onChange={(event) => {
              setProducts(event.target.checked);
              setQuote(null);
            }}
          />
          Cleaner brings products · {money(details.pricing.productsFeePence)}{" "}
          for this visit
        </label>
        <button type="button" onClick={() => requestChange()}>
          {busy ? "Checking…" : "Review changes"}
        </button>
      </fieldset>
      {!details.canChange && !details.processing && (
        <p>
          Add-on changes close 24 hours before the visit or when the visit has
          started or closed.
        </p>
      )}
      {quote && (
        <div className="change-quote" role="status">
          <p>
            Updated visit: {money(quote.amountPence)} ·{" "}
            {quote.durationMinutes / 60} hours reserved.
          </p>
          <p>
            {quote.chargePence
              ? `Charge your saved card ${money(quote.chargePence)} now. `
              : "No extra payment now. "}
            {quote.refundPence
              ? `Refund ${money(quote.refundPence)} for removed add-ons.`
              : ""}
          </p>
          {quote.changed ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => requestChange(true)}
            >
              {busy ? "Processing…" : "Confirm this change"}
            </button>
          ) : (
            <p>No changes selected.</p>
          )}
        </div>
      )}
      {message && <p role="alert">{message}</p>}
      <style jsx>{`
        .visit-billing {
          margin: 20px 0;
          padding: 20px;
          border: 1px solid var(--ob-border);
          border-radius: 16px;
          background: var(--ob-surface);
        }
        h2 {
          margin-top: 0;
          font-size: 18px;
        }
        fieldset {
          border: 0;
          padding: 0;
          display: grid;
          gap: 12px;
        }
        legend {
          font-weight: 800;
          margin-bottom: 12px;
        }
        label {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 14px;
        }
        input {
          width: 18px;
          height: 18px;
          flex-shrink: 0;
        }
        button {
          justify-self: start;
          border: 0;
          padding: 12px 18px;
          border-radius: 10px;
          background: var(--ob-purple);
          color: white;
          font: inherit;
          font-weight: 800;
          cursor: pointer;
        }
        button:disabled {
          opacity: 0.6;
          cursor: wait;
        }
        a {
          color: var(--ob-purple);
        }
        .change-quote {
          margin-top: 16px;
          padding: 14px;
          background: var(--ob-purple-soft);
          border-radius: 12px;
        }
      `}</style>
    </section>
  );
}
