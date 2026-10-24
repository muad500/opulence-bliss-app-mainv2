"use client";
import { useEffect, useState } from "react";
type Row = {
  booking_id: string;
  charge_percent: number;
  charge_pence: number;
  cleaner_pay_pence: number;
  waived_pence: number;
  revision: number;
  created_at: string;
};
const money = (value: number) => `£${(value / 100).toFixed(2)}`;
export default function CleaningCancellationCompensation({
  admin = false,
  bookingId,
}: {
  admin?: boolean;
  bookingId?: string;
}) {
  const endpoint = admin
    ? "/api/admin/cleaning-cancellations"
    : "/api/account/cleaning-cancellations";
  const [rows, setRows] = useState<Row[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  async function load() {
    const response = await fetch(endpoint, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    setRows(data.rows);
  }
  useEffect(() => {
    let active = true;
    fetch(endpoint, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        if (active) setRows(data.rows);
      })
      .catch(() => {
        if (active)
          setMessage("Cancellation compensation could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, [endpoint]);
  async function adjust(input: Record<string, unknown>) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setMessage(
        result.status === "succeeded"
          ? "Refund confirmed to the customer's original payment method."
          : result.status === "failed"
            ? "The adjustment could not be completed. No additional refund was made. Please contact the resolution team."
            : "Payment adjustment is processing. Do not submit it again; it will be reconciled safely.",
      );
      await load();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "The adjustment needs review.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      style={{
        padding: 20,
        margin: "24px 0",
        border: "1px solid #e5ddef",
        borderRadius: 14,
        background: "#fff",
      }}
    >
      <h2 style={{ marginTop: 0 }}>
        {admin ? "Cleaning cancellation charges" : "Cancellation compensation"}
      </h2>
      <p>
        {admin
          ? "Charges apply only to cleaning hours, never tips, add-ons or products. Reduce a charge below its agreed band; never above 70%. No access requires a report and a 15-minute wait."
          : "You receive the same proportion of your cleaning-hours pay as the cancellation charge. You may waive some or all of your compensation, even after payout; that amount is refunded to the customer. Products are not paid on cancelled visits."}
      </p>
      {message && <p role="status">{message}</p>}
      {admin && bookingId && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            if (
              window.confirm(
                "Cancel this reported no-access visit and apply this cleaning-hours-only charge?",
              )
            )
              void adjust({
                action: "no_access",
                bookingId,
                chargePercent: Number(form.get("percent")),
              });
          }}
        >
          <p>No-access booking: {bookingId}</p>
          <label>
            Charge %{" "}
            <input
              name="percent"
              type="number"
              min="0"
              max="70"
              step="1"
              defaultValue="70"
              required
            />
          </label>{" "}
          <button disabled={busy}>Confirm no-access cancellation</button>
        </form>
      )}
      {(expanded ? rows : rows.slice(0, 5)).map((row) => (
        <article
          key={row.booking_id}
          style={{
            borderTop: "1px solid #e5ddef",
            paddingTop: 16,
            marginTop: 16,
          }}
        >
          <p>
            <a
              href={
                admin
                  ? `/admin/cleaning-cancellations?booking=${row.booking_id}`
                  : `/worker/job/${row.booking_id}`
              }
            >
              Booking {row.booking_id.slice(0, 8)}
            </a>{" "}
            · {new Date(row.created_at).toLocaleDateString("en-GB")}
          </p>
          <p>
            {admin && (
              <>
                Customer charge: {money(row.charge_pence)} ({row.charge_percent}
                % before any waiver).{" "}
              </>
            )}
            Cleaner compensation:{" "}
            <strong>{money(row.cleaner_pay_pence)}</strong>. Waived so far:{" "}
            {money(row.waived_pence)}.
          </p>
          {(admin ? row.charge_pence > 0 : row.cleaner_pay_pence > 0) && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                const value = Number(form.get("value"));
                if (
                  !window.confirm(
                    admin
                      ? "Reduce this cancellation charge and refund the difference?"
                      : `Waive ${money(Math.round(value * 100))} of your compensation and refund it to the customer?`,
                  )
                )
                  return;
                void adjust({
                  action: admin ? "reduce_charge" : "waive",
                  bookingId: row.booking_id,
                  revision: row.revision,
                  ...(admin
                    ? { chargePercent: value }
                    : { amountPence: Math.round(value * 100) }),
                });
              }}
            >
              <label>
                {admin ? "New charge percentage" : "Amount to waive (£)"}{" "}
                <input
                  name="value"
                  type="number"
                  required
                  min={admin ? 0 : 0.01}
                  max={
                    admin ? row.charge_percent - 1 : row.cleaner_pay_pence / 100
                  }
                  step={admin ? 1 : 0.01}
                  defaultValue={
                    admin
                      ? Math.max(0, row.charge_percent - 1)
                      : (row.cleaner_pay_pence / 100).toFixed(2)
                  }
                />
              </label>{" "}
              <button disabled={busy}>
                {admin
                  ? "Reduce charge and refund"
                  : "Waive and refund customer"}
              </button>
            </form>
          )}
        </article>
      ))}
      {!rows.length && !message && (
        <p>No cancellation compensation recorded yet.</p>
      )}
      {rows.length > 5 && (
        <button onClick={() => setExpanded((value) => !value)}>
          {expanded ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      )}
    </section>
  );
}
