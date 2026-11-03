"use client";
import { useEffect, useState } from "react";
export default function RecordedVisitOutcome({
  bookingId,
}: {
  bookingId: string;
}) {
  const [bill, setBill] = useState<{
      revision: number;
      amount_pence: number;
    } | null>(null),
    [outcome, setOutcome] = useState<Record<string, string> | null>(null),
    [mode, setMode] = useState("customer_stopped"),
    [reason, setReason] = useState(""),
    [minutes, setMinutes] = useState(0),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    fetch(`/api/admin/visit-outcomes?booking=${bookingId}`)
      .then((r) => r.json())
      .then((r) => {
        if (active) {
          setBill(r.bill ?? null);
          setOutcome(r.outcome ?? null);
          setMessage(r.error ?? "");
        }
      });
    return () => {
      active = false;
    };
  }, [bookingId]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!bill) return;
    setBusy(true);
    try {
      const response = await fetch("/api/admin/visit-outcomes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookingId,
          mode,
          reason,
          workedMinutes: minutes,
          revision: bill.revision,
        }),
      });
      const r = await response.json();
      if (!response.ok) throw Error(r.error);
      setMessage(
        r.status === "succeeded"
          ? "Decision saved and payment adjustment completed."
          : "Decision saved. The existing payment recovery will finish this same adjustment; do not submit another.",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      style={{
        border: "1px solid #d9cdec",
        borderRadius: 16,
        padding: 20,
        margin: "20px 0",
        background: "#fff",
      }}
    >
      <h2>Visit stopped: staff decision</h2>
      <p>
        Ordinary cancellations keep their agreed bands. Only an unsafe-home or
        disrespect decision can retain up to the full booking price under the
        final accepted terms. This does not create a new charge or take back an
        existing refund.
      </p>
      {outcome ? (
        <p>
          Recorded: {outcome.mode.replaceAll("_", " ")} · {outcome.reason}
        </p>
      ) : (
        bill && (
          <form onSubmit={save} style={{ display: "grid", gap: 12 }}>
            <p>
              Original visit total: £{(bill.amount_pence / 100).toFixed(2)}. No
              VAT is charged.
            </p>
            <label>
              Reason for stopping
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="customer_stopped">
                  Customer asked to stop — time worked only
                </option>
                <option value="unsafe_home">
                  Cleaner left an unsafe home — full price exception
                </option>
                <option value="disrespect">
                  Cleaner left after disrespect or threats — full price
                  exception
                </option>
              </select>
            </label>
            {mode === "customer_stopped" && (
              <label>
                Verified minutes actually worked
                <input
                  type="number"
                  min={0}
                  max={480}
                  step={1}
                  value={minutes}
                  onChange={(e) => setMinutes(Number(e.target.value))}
                  required
                />
              </label>
            )}
            <label>
              Required evidence and reason (logged against your account)
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                minLength={10}
                maxLength={2000}
                required
              />
            </label>
            <button disabled={busy || reason.trim().length < 10}>
              {busy ? "Saving…" : "Record decision and settle visit"}
            </button>
          </form>
        )
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
