"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { HandymanJob } from "@/lib/handymanServer";
import styles from "@/app/handyman/marketplace.module.css";
import { handymanBill } from "@/lib/handymanMarketplace";
type FileRecord = {
  id: string;
  kind: "photo" | "receipt";
  original_name: string;
  amount_pence: number | null;
  decision: "pending" | "approved" | "rejected";
  url: string | null;
};
type Detail = {
  job: HandymanJob;
  files: FileRecord[];
  professionalName: string;
  role: "customer" | "professional";
  review: { rating: number; comment: string | null; is_public: boolean } | null;
};
const money = (n: number) => "£" + (n / 100).toFixed(2);
export default function HandymanJobDetail({
  id,
  portal,
}: {
  id: string;
  portal: "customer" | "professional";
}) {
  const [detail, setDetail] = useState<Detail | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [receipt, setReceipt] = useState<File | null>(null),
    [receiptAmount, setReceiptAmount] = useState(""),
    [rating, setRating] = useState(5),
    [comment, setComment] = useState(""),
    [publicReview, setPublicReview] = useState(false);
  const load = useCallback(async () => {
    const r = await fetch("/api/handyman/jobs/" + id),
      d = await r.json();
    if (!r.ok) throw Error(d.error);
    setDetail(d);
    if (d.review) {
      setRating(d.review.rating);
      setComment(d.review.comment ?? "");
      setPublicReview(d.review.is_public);
    }
  }, [id]);
  useEffect(() => {
    let active = true;
    async function initialise() {
      if (
        new URLSearchParams(window.location.search).get("checkout") ===
        "complete"
      ) {
        const current = await fetch("/api/handyman/jobs/" + id),
          d = await current.json();
        if (
          current.ok &&
          ["checkout_pending", "awaiting_authorization"].includes(d.job.status)
        ) {
          const sync = await fetch("/api/handyman/jobs/" + id, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "sync" }),
          });
          if (!sync.ok) {
            const error = await sync.json();
            throw Error(error.error);
          }
        }
      }
      if (active) await load();
    }
    void initialise().catch((e) => {
      if (active) setError(e.message);
    });
    return () => {
      active = false;
    };
  }, [id, load]);
  async function action(name: string, fields: Record<string, unknown> = {}) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/handyman/jobs/" + id, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: name, ...fields }),
        }),
        d = await r.json();
      if (!r.ok) {
        if (d.status === "awaiting_authorization") await load();
        throw Error(d.error);
      }
      if (d.url) {
        window.location.assign(d.url);
        return;
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  async function upload() {
    if (!receipt) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("kind", "receipt");
      form.set("file", receipt);
      form.set("amountPence", String(Math.round(Number(receiptAmount) * 100)));
      const r = await fetch("/api/handyman/jobs/" + id + "/files", {
          method: "POST",
          body: form,
        }),
        d = await r.json();
      if (!r.ok) throw Error(d.error);
      setReceipt(null);
      setReceiptAmount("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Receipt could not be added.");
    } finally {
      setBusy(false);
    }
  }
  const j = detail?.job,
    customer = detail?.role === "customer",
    materialTotal =
      detail?.files
        .filter((f) => f.kind === "receipt" && f.decision === "approved")
        .reduce((n, f) => n + (f.amount_pence ?? 0), 0) ?? 0;
  const bill =
    j?.bill ??
    (j?.worked_minutes !== null && j?.worked_minutes !== undefined
      ? handymanBill(
          j.hourly_rate_pence,
          j.worked_minutes,
          j.vat_bps,
          materialTotal,
        )
      : null);
  return (
    <main className={styles.page}>
      <nav className={styles.nav}>
        <Link
          href={
            portal === "professional"
              ? "/worker/jobs?service=handyman"
              : "/account/handyman"
          }
        >
          ← My jobs
        </Link>
        {portal === "customer" && <Link href="/handyman">Book a handyman</Link>}
        <Link
          href={
            portal === "professional" ? "/worker/profile" : "/account/profile"
          }
        >
          My profile
        </Link>
      </nav>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {!j && !error && <p>Loading job…</p>}
      {j && detail && (
        <>
          <section className={styles.card}>
            <span className={styles.status}>
              {j.status.replaceAll("_", " ")}
            </span>
            <h1>{j.task_name}</h1>
            <p>
              Professional: <strong>{detail.professionalName}</strong>
            </p>
            <p>
              {new Intl.DateTimeFormat("en-GB", {
                timeZone: "Europe/London",
                dateStyle: "full",
                timeStyle: "short",
              }).format(new Date(j.scheduled_at))}{" "}
              · London time
            </p>
            <p>
              {j.address}, {j.postcode}
            </p>
            <p className={styles.muted}>{j.description}</p>
            <p>
              {money(j.hourly_rate_pence)}/hr{j.vat_bps ? " + VAT" : ""} ·
              one-hour minimum
            </p>
            <strong>
              {j.status === "completed"
                ? "Paid: " + money(j.bill?.gross ?? 0)
                : "Card hold: " + money(j.held_pence)}
            </strong>
            <div className={styles.actions}>
              {customer &&
                ["checkout_pending", "awaiting_authorization"].includes(
                  j.status,
                ) && (
                  <>
                    <button
                      className={styles.button}
                      disabled={busy}
                      onClick={() => void action("authorise")}
                    >
                      {j.status === "awaiting_authorization"
                        ? "Authorise the approved bill"
                        : "Continue card authorisation"}
                    </button>
                    <button
                      className={styles.secondary}
                      disabled={busy}
                      onClick={() => void action("sync")}
                    >
                      I completed authorisation — refresh
                    </button>
                  </>
                )}
              {!customer && j.status === "scheduled" && (
                <button
                  className={styles.button}
                  disabled={busy}
                  onClick={() => void action("start")}
                >
                  Check in and start work
                </button>
              )}
              {!customer && j.status === "in_progress" && (
                <button
                  className={styles.button}
                  disabled={busy}
                  onClick={() => void action("finish")}
                >
                  Check out and send bill
                </button>
              )}
              {["checkout_pending", "scheduled", "cancel_pending"].includes(
                j.status,
              ) && (
                <button
                  className={styles.secondary}
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Cancel this unstarted job and release its card hold?",
                      )
                    )
                      void action("cancel");
                  }}
                >
                  Cancel and release hold
                </button>
              )}
              {customer && j.status === "payment_pending" && (
                <button
                  className={styles.button}
                  disabled={busy}
                  onClick={() => void action("claim_payment")}
                >
                  Retry approved payment
                </button>
              )}
            </div>
            <p className={styles.muted}>
              {j.status === "completed"
                ? "Your approved bill was paid. The professional receives the labour share, VAT and all approved materials."
                : j.status === "awaiting_customer"
                  ? "Review the worked time and receipts below. Payment is collected only after you approve the bill."
                  : "Your card is held. Unused authorised funds are released when the final bill is collected."}
            </p>
          </section>
          <section className={styles.card}>
            <h2>Job photos and materials receipts</h2>
            <div className={styles.files}>
              {detail.files.map((f) => (
                <div className={styles.file} key={f.id}>
                  {f.url ? (
                    <a href={f.url} target="_blank" rel="noreferrer">
                      {f.original_name}
                    </a>
                  ) : (
                    <span>{f.original_name}</span>
                  )}
                  {f.kind === "receipt" && (
                    <>
                      <strong>{money(f.amount_pence ?? 0)}</strong>
                      <span>{f.decision}</span>
                      {customer && j.status === "awaiting_customer" && (
                        <>
                          <button
                            className={styles.secondary}
                            disabled={busy}
                            onClick={() =>
                              void action("receipt", {
                                fileId: f.id,
                                approve: true,
                              })
                            }
                          >
                            Approve receipt
                          </button>
                          <button
                            className={styles.secondary}
                            disabled={busy}
                            onClick={() =>
                              void action("receipt", {
                                fileId: f.id,
                                approve: false,
                              })
                            }
                          >
                            Reject receipt
                          </button>
                        </>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
            {!detail.files.length && (
              <p className={styles.muted}>No files attached.</p>
            )}
            {!customer &&
              ["in_progress", "awaiting_customer"].includes(j.status) && (
                <>
                  <div className={styles.grid}>
                    <label className={styles.field}>
                      Receipt (PDF, JPEG or PNG)
                      <input
                        type="file"
                        accept="application/pdf,image/jpeg,image/png"
                        onChange={(e) =>
                          setReceipt(e.target.files?.[0] ?? null)
                        }
                      />
                    </label>
                    <label className={styles.field}>
                      Receipt amount (£)
                      <input
                        type="number"
                        min="0.01"
                        max="5000"
                        step="0.01"
                        value={receiptAmount}
                        onChange={(e) => setReceiptAmount(e.target.value)}
                      />
                    </label>
                  </div>
                  <div className={styles.actions}>
                    <button
                      className={styles.secondary}
                      disabled={busy || !receipt}
                      onClick={() => void upload()}
                    >
                      Add receipt for customer approval
                    </button>
                  </div>
                </>
              )}
          </section>
          {bill && (
            <section className={styles.card}>
              <h2>
                {j.status === "completed"
                  ? "Receipt and statement"
                  : "Review the final bill"}
              </h2>
              <p>
                Recorded work: {j.worked_minutes} minutes · billed time:{" "}
                {bill.billedMinutes} minutes
              </p>
              <div className={styles.bill}>
                <div>
                  <span>Labour excluding VAT</span>
                  <strong>{money(bill.labour)}</strong>
                </div>
                <div>
                  <span>Labour VAT</span>
                  <strong>{money(bill.vat)}</strong>
                </div>
                <div>
                  <span>Approved materials</span>
                  <strong>{money(bill.materials)}</strong>
                </div>
                <div>
                  <span>Total</span>
                  <strong>{money(bill.gross)}</strong>
                </div>
                {!customer && (
                  <>
                    <div>
                      <span>Platform share (20% of net labour)</span>
                      <strong>{money(bill.platform)}</strong>
                    </div>
                    <div>
                      <span>Your transfer</span>
                      <strong>{money(bill.provider)}</strong>
                    </div>
                  </>
                )}
              </div>
              {customer && j.status === "awaiting_customer" && (
                <>
                  <p className={styles.muted}>
                    Approve or reject every receipt before approving this bill.
                    If it exceeds the card hold, you will complete a new
                    authorisation first.
                  </p>
                  <button
                    className={styles.button}
                    disabled={
                      busy ||
                      detail.files.some(
                        (f) => f.kind === "receipt" && f.decision === "pending",
                      )
                    }
                    onClick={() => void action("approve_bill")}
                  >
                    Approve worked time and final bill
                  </button>
                </>
              )}
              {j.status === "completed" && (
                <button
                  className={styles.secondary}
                  onClick={() => window.print()}
                >
                  Print receipt / save PDF
                </button>
              )}
            </section>
          )}
          {j.status === "completed" && customer && (
            <section className={styles.card}>
              <h2>
                {detail.review
                  ? "Edit your review"
                  : "Review your professional"}
              </h2>
              <div className={styles.grid}>
                <label className={styles.field}>
                  Rating
                  <select
                    value={rating}
                    onChange={(e) => setRating(Number(e.target.value))}
                  >
                    {[5, 4, 3, 2, 1].map((n) => (
                      <option key={n} value={n}>
                        {n} stars
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  Your words
                  <textarea
                    value={comment}
                    maxLength={2000}
                    onChange={(e) => setComment(e.target.value)}
                  />
                </label>
              </div>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={publicReview}
                  onChange={(e) => setPublicReview(e.target.checked)}
                />
                Publish my review. Private reviews are visible to me and the
                professional; anonymous scores can still contribute to their
                rating.
              </label>
              <div className={styles.actions}>
                <button
                  className={styles.button}
                  disabled={busy}
                  onClick={() =>
                    void action("review", {
                      rating,
                      comment,
                      isPublic: publicReview,
                    })
                  }
                >
                  Save review
                </button>
              </div>
            </section>
          )}
          {j.status === "completed" && !customer && detail.review && (
            <section className={styles.card}>
              <h2>Customer feedback</h2>
              <strong>
                {detail.review.rating} ★ ·{" "}
                {detail.review.is_public ? "Public" : "Private"}
              </strong>
              <p>{detail.review.comment}</p>
            </section>
          )}
          <p className={styles.muted}>
            Need help?{" "}
            <a href="mailto:opulencebliss@gmail.com">Contact support</a>.
          </p>
        </>
      )}
    </main>
  );
}
