"use client";

import { useEffect, useState } from "react";
import AdminSkeleton from "../AdminSkeleton";
import JobOfferSettings from "@/components/admin/JobOfferSettings";
import SocialLinksSettings from "@/components/admin/SocialLinksSettings";
import HandymanQuoteAdmin from "@/components/admin/HandymanQuoteAdmin";
import { CLEANING_ADDONS } from "@/lib/cleaningExtras";
import type { CleaningBillingTerms } from "@/lib/cleaningBillingTerms";
import DbsStaffSettings from "@/components/admin/DbsStaffSettings";
import SafeguardingLaunchSettings from "@/components/admin/SafeguardingLaunchSettings";

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
      const newRules = terms.cancellationBasis === "cleaning_hours";
      if (
        newRules &&
        !window.confirm(
          "Confirm the matching Cancellation & Refund Policy is published. These rules apply to new bookings only; existing bookings keep their agreed policy.",
        )
      )
        return;
      const response = await fetch("/api/admin/billing-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: terms.version,
          cleanerHourlyPence: pence("pay"),
          deepCleanerHourlyPence: pence("deepPay"),
          productsCleanerPayPence: pence("productsPay"),
          ...(newRules ? { cancellationBasis: "cleaning_hours" } : {}),
          confirmPolicyPublished: newRules,
          addonPrices: Object.fromEntries(
            CLEANING_ADDONS.map((addon) => [addon.id, pence(addon.id)]),
          ),
          productsFeePence: pence("products"),
          tipMinimumPence: pence("tip"),
          cancellationRefundPercent: !newRules
            ? { full: 100, three_quarter: 75, half: 50, none: 0 }
            : Object.fromEntries(
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
      <main className="billing-settings">
        <h1>Booking prices and cleaner pay</h1>
        <p>
          Changes apply to new bookings only. Each booking keeps its own prices,
          pay rate, tip minimum and refund percentages.
        </p>
        <p>
          Tips go to the cleaner in full. Cleaner pay covers booked cleaning
          hours, plus the products payment where selected. Extra time reserved
          for add-ons does not change the cleaning-hours pay calculation.
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
              {field(
                "deepPay",
                "Deep clean / End of Tenancy cleaner pay per hour",
                terms.deepCleanerHourlyPence ?? 1750,
              )}
              {field(
                "productsPay",
                "Cleaner receives for bringing products",
                terms.productsCleanerPayPence ?? 400,
              )}
              {CLEANING_ADDONS.map((addon) =>
                field(addon.id, addon.label, terms.addonPrices[addon.id]),
              )}
              {field("products", "Products per visit", terms.productsFeePence)}
              {field("tip", "Minimum tip", terms.tipMinimumPence)}
            </fieldset>
            <label>
              <input
                type="checkbox"
                checked={terms.cancellationBasis === "cleaning_hours"}
                style={{ width: "auto" }}
                onChange={(event) => {
                  const current = { ...terms };
                  delete current.cancellationBasis;
                  setTerms({
                    ...current,
                    ...(event.target.checked
                      ? { cancellationBasis: "cleaning_hours" as const }
                      : {}),
                    cancellationRefundPercent: {
                      full: 100,
                      three_quarter: 75,
                      half: 50,
                      none: event.target.checked ? 30 : 0,
                    },
                  });
                }}
              />
              Enable new cancellation policy for new bookings (publish-day
              switch)
            </label>
            <fieldset
              disabled={busy || terms.cancellationBasis !== "cleaning_hours"}
              key={terms.cancellationBasis ?? "published"}
            >
              <legend>
                Cancellation refunds —{" "}
                {terms.cancellationBasis === "cleaning_hours"
                  ? "new policy"
                  : "currently published policy"}
              </legend>
              <p>
                {terms.cancellationBasis === "cleaning_hours"
                  ? "Cleaning hours only: 0/25/50/up to 70% charges, extras/products/tips refunded, 12-hour band and 15-minute no-access wait. Publish matching policy before saving."
                  : "Published policy remains active: 0/25/50/up to 100% of the booking price, no separate 12-hour band, 30-minute no-access wait. Pay rates/products share remain active independently."}
              </p>
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
                terms.cancellationBasis
                  ? "12 to 24 hours before (not the same day)"
                  : "Under 24 hours (not the same day)",
                terms.cancellationRefundPercent.half,
                true,
              )}
              {field(
                "none",
                terms.cancellationBasis
                  ? "Under 12 hours / on the day / no access after 15 minutes"
                  : "On the day / no access after 30 minutes",
                terms.cancellationRefundPercent.none,
                true,
              )}
            </fieldset>
            <button disabled={busy}>
              {busy ? "Saving…" : "Save for new bookings"}
            </button>
          </form>
        ) : (
          !message && <AdminSkeleton compact label="Loading booking settings" />
        )}
        <JobOfferSettings />
        <HandymanQuoteAdmin settingsOnly />
        <SocialLinksSettings />
        <DbsStaffSettings />
        <SafeguardingLaunchSettings />
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
