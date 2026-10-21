"use client";
import Link from "next/link";
import HandymanQuoteEvidence from "./HandymanQuoteEvidence";
import { useCallback, useEffect, useState } from "react";
import { handymanMoney } from "@/lib/handymanQuotes";
import styles from "@/app/handyman/marketplace.module.css";
type Desk = {
  settings: { commission_bps: number; version: number };
  disputes: {
    id: string;
    job_id: string;
    reason: string;
    created_at: string;
    handyman_jobs: {
      task_name: string;
      postcode: string;
      paid_pence: number;
      refunded_pence: number;
    };
  }[];
  holds: {
    id: string;
    job_id: string;
    kind: string;
    amount_pence: number;
    last_error: string;
  }[];
};
export default function HandymanQuoteAdmin({
  settingsOnly = false,
  preview = false,
}: {
  settingsOnly?: boolean;
  preview?: boolean;
}) {
  const [desk, setDesk] = useState<Desk | null>(null),
    [disabled, setDisabled] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await fetch("/api/handyman/admin", { cache: "no-store" });
    if (r.status === 404) {
      setDisabled(true);
      return;
    }
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    setDesk(d);
  }, []);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load]);
  async function action(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/handyman/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }
  if (disabled) return null;
  return (
    <section className={styles.card}>
      <h2>
        {settingsOnly
          ? "Property maintenance commission"
          : "Property maintenance resolution desk"}
      </h2>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {!desk && !error && <p role="status">Loading…</p>}
      {desk &&
        (settingsOnly ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action({
                action: "settings",
                version: desk.settings.version,
                commissionBps: Math.round(
                  Number(new FormData(e.currentTarget).get("fee")) * 100,
                ),
              });
            }}
            key={desk.settings.version}
          >
            <p>
              Default 20% of the entire fixed quote, including materials.
              Changes apply only to newly accepted jobs. Refund percentages use
              the editable cleaning cancellation bands above.
            </p>
            <label className={styles.field}>
              Platform commission (%)
              <input
                name="fee"
                type="number"
                min="0"
                max="50"
                step="0.01"
                required
                defaultValue={desk.settings.commission_bps / 100}
              />
            </label>
            <button disabled={busy} className={styles.button}>
              Save for new quote acceptances
            </button>
          </form>
        ) : (
          <>
            <p>
              {desk.disputes.length} open cases · {desk.holds.length} held
              payment operations.
            </p>
            {(preview ? desk.disputes.slice(0, 5) : desk.disputes).map((d) => (
              <article className={styles.quoteCard} key={d.id}>
                <h3>
                  {d.handyman_jobs.task_name} · {d.handyman_jobs.postcode}
                </h3>
                <p className={styles.scope}>{d.reason}</p>
                {!preview && <HandymanQuoteEvidence jobId={d.job_id} />}
                <p>
                  Net payment:{" "}
                  {handymanMoney(
                    d.handyman_jobs.paid_pence - d.handyman_jobs.refunded_pence,
                  )}
                </p>
                {!preview && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      if (
                        window.confirm(
                          "Apply this resolution? Refunds and any required payout reversals are processed once and recorded.",
                        )
                      )
                        void action({
                          action: "resolve",
                          disputeId: d.id,
                          refundPence: Math.round(
                            Number(f.get("refund")) * 100,
                          ),
                          reason: f.get("reason"),
                        });
                    }}
                  >
                    <label className={styles.field}>
                      Refund (£), or 0 to release the agreed payout
                      <input
                        name="refund"
                        type="number"
                        required
                        min="0"
                        step="0.01"
                        max={
                          (d.handyman_jobs.paid_pence -
                            d.handyman_jobs.refunded_pence) /
                          100
                        }
                        defaultValue="0"
                      />
                    </label>
                    <label className={styles.field}>
                      Evidence reviewed and resolution
                      <textarea
                        name="reason"
                        required
                        minLength={10}
                        maxLength={4000}
                      />
                    </label>
                    <button disabled={busy} className={styles.button}>
                      Resolve case
                    </button>
                  </form>
                )}
              </article>
            ))}
            {(preview ? desk.holds.slice(0, 5) : desk.holds).map((h) => (
              <p key={h.id}>
                {h.kind} · {handymanMoney(h.amount_pence)} · {h.last_error} ·
                Job {h.job_id}
              </p>
            ))}
            {preview ? (
              <Link href="/handyman/admin">
                View all property maintenance cases →
              </Link>
            ) : (
              <button
                disabled={busy}
                className={styles.secondary}
                onClick={() => void action({ action: "retry" })}
              >
                Retry recorded payment operations
              </button>
            )}
          </>
        ))}
    </section>
  );
}
