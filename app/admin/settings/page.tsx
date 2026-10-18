"use client";

import { useEffect, useState } from "react";
import AdminNav from "../AdminNav";
import { CLEANING_ADDONS } from "@/lib/cleaningExtras";
import type { CleaningBillingTerms } from "@/lib/cleaningBillingTerms";

export default function BillingSettings() {
  const [terms, setTerms] = useState<CleaningBillingTerms | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    fetch("/api/admin/billing-settings", { cache: "no-store" })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        setTerms(data);
      })
      .catch(() => setMessage("Settings could not be loaded. Please refresh."));
  }, []);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!terms) return;
    setBusy(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const pence = (key: string) => Math.round(Number(form.get(key)) * 100);
    try {
      const response = await fetch("/api/admin/billing-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: terms.version,
          cleanerHourlyPence: pence("pay"),
          addonPrices: Object.fromEntries(
            CLEANING_ADDONS.map((addon) => [addon.id, pence(addon.id)]),
          ),
          productsFeePence: pence("products"),
          tipMinimumPence: pence("tip"),
          cancellationRefundPercent: Object.fromEntries(
            ["full", "three_quarter", "half", "none"].map((band) => [
              band,
              Number(form.get(band)),
            ]),
          ),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setTerms(result);
      setMessage(
        "Saved. These settings apply to new bookings only. Existing bookings keep their agreed terms.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Settings could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  const field = (
    name: string,
    label: string,
    value: number,
    percent = false,
  ) => (
    <label key={name}>
      {label} {percent ? "(%)" : "(£)"}
      <input
        name={name}
        type="number"
        required
        min={percent ? 0 : name === "pay" ? 0.01 : name === "tip" ? 0.5 : 0}
        max={percent ? 100 : 500}
        step={percent ? 1 : 0.01}
        defaultValue={percent ? value : value / 100}
      />
    </label>
  );
  return (
    <>
      <AdminNav email="Staff settings" />
      <main className="billing-settings">
        <p className="eyebrow">ADMIN SETTINGS</p>
        <h1>Booking prices and cleaner pay</h1>
        <p>
          Changes apply to new bookings only. Each booking keeps its own prices,
          pay rate, tip minimum and refund percentages.
        </p>
        <p>
          Add-ons and products are retained by the business. Tips go to the
          cleaner in full. Cleaner pay covers booked cleaning hours, excluding
          extra time reserved for add-ons.
        </p>
        {message && <p role="status">{message}</p>}
        {terms ? (
          <form onSubmit={save} key={terms.version}>
            <fieldset disabled={busy}>
              <legend>Pay and prices</legend>
              {field(
                "pay",
                "Cleaner pay per booked cleaning hour",
                terms.cleanerHourlyPence,
              )}
              {CLEANING_ADDONS.map((addon) =>
                field(addon.id, addon.label, terms.addonPrices[addon.id]),
              )}
              {field("products", "Products per visit", terms.productsFeePence)}
              {field("tip", "Minimum tip", terms.tipMinimumPence)}
            </fieldset>
            <fieldset disabled={busy}>
              <legend>Cancellation refunds</legend>
              {field(
                "full",
                "At least 48 hours before",
                terms.cancellationRefundPercent.full,
                true,
              )}
              {field(
                "three_quarter",
                "24 to 48 hours before",
                terms.cancellationRefundPercent.three_quarter,
                true,
              )}
              {field(
                "half",
                "Under 24 hours, before the visit day",
                terms.cancellationRefundPercent.half,
                true,
              )}
              {field(
                "none",
                "On the day / no access",
                terms.cancellationRefundPercent.none,
                true,
              )}
            </fieldset>
            <button disabled={busy}>
              {busy ? "Saving…" : "Save for new bookings"}
            </button>
          </form>
        ) : (
          <p role="status">Loading settings…</p>
        )}
      </main>
      <style jsx>{`
        .billing-settings {
          max-width: 850px;
          margin: 36px auto;
          padding: 24px;
          color: #18232d;
        }
        .eyebrow {
          color: #782bd1;
          font-weight: 800;
          font-size: 12px;
          letter-spacing: 0.1em;
        }
        fieldset {
          border: 1px solid #e3ddef;
          border-radius: 16px;
          padding: 20px;
          margin: 22px 0;
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
          gap: 18px;
        }
        legend {
          font-weight: 800;
        }
        label {
          display: grid;
          gap: 7px;
          font-weight: 700;
        }
        input {
          width: 100%;
          border: 1px solid #cfc6df;
          border-radius: 8px;
          padding: 10px;
          font: inherit;
        }
        button {
          padding: 12px 20px;
          border: 0;
          border-radius: 10px;
          background: #7028c7;
          color: white;
          font-weight: 800;
        }
      `}</style>
    </>
  );
}
