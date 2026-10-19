"use client";
import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { handymanTaskLabel } from "@/lib/handymanMarketplace";
import { handymanMoney as money, handymanPence } from "@/lib/handymanQuotes";
import type { HandymanQuote, HandymanQuoteJob } from "@/lib/handymanQuotes";
import styles from "@/app/handyman/marketplace.module.css";
type Detail = {
  job: HandymanQuoteJob;
  role: "customer" | "professional";
  quotes: HandymanQuote[];
  files: { id: string; original_name: string; url: string | null }[];
  visits: {
    quote_id: string;
    scheduled_at: string;
    address: string;
    status: string;
  }[];
  operations: {
    id: string;
    kind: string;
    status: string;
    amount_pence: number;
    last_error: string | null;
  }[];
  termsVersion: string | null;
  cancellationPreview?: string;
  review: { rating: number; comment: string | null; is_public: boolean } | null;
};
const when = (v: string) =>
  new Date(v).toLocaleString("en-GB", {
    timeZone: "Europe/London",
    dateStyle: "medium",
    timeStyle: "short",
  });
export default function HandymanJobDetail({
  id,
  portal,
}: {
  id: string;
  portal: "customer" | "professional";
}) {
  const [detail, setDetail] = useState<Detail | null>(null),
    [error, setError] = useState("");
  const [busy, setBusy] = useState(false),
    [address, setAddress] = useState("");
  const [terms, setTerms] = useState(false),
    [siteVisit, setSiteVisit] = useState(false);
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    const r = await fetch("/api/handyman/jobs/" + id, { cache: "no-store" }),
      d = await r.json();
    if (!r.ok) throw new Error(d.error);
    setDetail(d);
  }, [id]);
  useEffect(() => {
    let active = true;
    const reload = () => {
      if (active)
        void load().catch((e) => {
          if (active) setError(e.message);
        });
    };
    reload();
    const timer = setInterval(() => {
      if (!document.hidden) reload();
    }, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [load]);
  async function action(name: string, fields: Record<string, unknown> = {}) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch("/api/handyman/jobs/" + id, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: name, ...fields }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      if (d.url) {
        window.location.assign(d.url);
        return;
      }
      await load();
      setNotice("Saved. The latest status is shown below.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
      await load().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  async function sendQuote(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget),
      revision = detail?.job.status === "in_progress";
    try {
      await action(revision ? "revision" : siteVisit ? "site_visit" : "quote", {
        requestKey: crypto.randomUUID(),
        totalPence:
          siteVisit && !revision ? 0 : handymanPence(String(form.get("total"))),
        scope: form.get("scope"),
        durationMinutes: Number(form.get("duration")),
        earliestAt: revision
          ? detail!.job.scheduled_at
          : new Date(String(form.get("date"))).toISOString(),
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : "Check your quote.");
    }
  }
  const j = detail?.job,
    customer = detail?.role === "customer";
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
        {portal === "customer" && <Link href="/handyman">Post a job</Link>}
      </nav>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!j && !error && <p role="status">Loading job…</p>}
      {j && detail && (
        <>
          <section className={styles.card}>
            <span className={styles.status}>
              {j.status.replaceAll("_", " ")}
            </span>
            <h1>{handymanTaskLabel(j.task_name)}</h1>
            <p>{j.description}</p>
            <p>
              {j.postcode}
              {j.address ? ` · ${j.address}` : ""}
            </p>
            <p className={styles.muted}>
              Preferred dates: {j.preferred_dates.join(", ")}
            </p>
            {j.scheduled_at && (
              <p>Agreed appointment: {when(j.scheduled_at)} (London time)</p>
            )}
            {j.selected_quote_id && (
              <>
                <h2>Agreed fixed total: {money(j.total_pence)}</h2>
                <p>Includes materials. No hourly billing or added VAT.</p>
                {!customer && j.bill && (
                  <p>
                    Your payout: <strong>{money(j.bill.provider)}</strong> after{" "}
                    {(j.commission_bps ?? 2000) / 100}% platform commission.
                  </p>
                )}
                {customer && (
                  <p>
                    Paid: {money(j.paid_pence)} · Refunded:{" "}
                    {money(j.refunded_pence)}
                  </p>
                )}
              </>
            )}
            {j.status === "posted" && (
              <p>
                Compare the complete scope, materials, estimated on-site time
                and earliest available date before choosing.
              </p>
            )}
            <div className={styles.actions}>
              {customer && j.status === "draft" && (
                <button
                  disabled={busy}
                  className={styles.button}
                  onClick={() => void action("publish")}
                >
                  Publish saved job
                </button>
              )}
              {customer &&
                ["checkout_pending", "revision_pending"].includes(j.status) && (
                  <button
                    disabled={busy}
                    className={styles.button}
                    onClick={() => void action("pay")}
                  >
                    Continue approved payment
                  </button>
                )}
              {customer &&
                [
                  "checkout_pending",
                  "revision_pending",
                  "cancel_pending",
                ].includes(j.status) && (
                  <button
                    disabled={busy}
                    className={styles.secondary}
                    onClick={() => void action("sync")}
                  >
                    I paid — check payment status
                  </button>
                )}
              {!customer && j.status === "scheduled" && (
                <button
                  disabled={busy}
                  className={styles.button}
                  onClick={() => void action("start")}
                >
                  Start agreed work
                </button>
              )}
              {!customer && j.status === "in_progress" && (
                <button
                  disabled={busy}
                  className={styles.button}
                  onClick={() => void action("finish")}
                >
                  Work completed — ask customer to confirm
                </button>
              )}
              {customer && j.status === "awaiting_customer" && (
                <button
                  disabled={busy}
                  className={styles.button}
                  onClick={() => void action("confirm")}
                >
                  Confirm completion
                </button>
              )}
              {[
                "draft",
                "posted",
                "checkout_pending",
                "scheduled",
                "cancel_pending",
              ].includes(j.status) && (
                <button
                  disabled={busy}
                  className={styles.secondary}
                  onClick={() => {
                    if (
                      window.confirm(
                        detail.cancellationPreview ??
                          "Cancel this job? The agreed cancellation refund bands apply to paid bookings.",
                      )
                    )
                      void action("cancel");
                  }}
                >
                  Cancel job
                </button>
              )}
              {!customer && j.status === "posted" && (
                <button
                  disabled={busy}
                  className={styles.secondary}
                  onClick={() => void action("decline")}
                >
                  Decline invitation
                </button>
              )}
            </div>
            {j.status === "awaiting_customer" && j.confirm_after && (
              <p className={styles.muted}>
                Confirm the work or raise a dispute before{" "}
                {when(j.confirm_after)}. Otherwise completion is confirmed
                automatically after 48 hours.
              </p>
            )}
            {j.status === "revision_pending" && (
              <p className={styles.muted}>
                Work is paused while the approved price difference is paid or
                refunded. The old scope remains in force until this settles.
              </p>
            )}
            {j.status === "disputed" && (
              <p role="status">
                This job is with the admin resolution desk. Further payouts are
                blocked until staff resolve it.
              </p>
            )}
            {detail.operations
              .filter((o) => o.status === "held")
              .map((o) => (
                <p key={o.id} className={styles.error}>
                  {o.last_error ?? "Payment needs admin review."}
                </p>
              ))}
          </section>
          {detail.files.length > 0 && (
            <section className={styles.card}>
              <h2>Job photos</h2>
              <div className={styles.photoGrid}>
                {detail.files.map((f) => (
                  <a
                    key={f.id}
                    href={f.url ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {f.url && (
                      <Image
                        unoptimized
                        src={f.url}
                        alt={f.original_name}
                        width={320}
                        height={160}
                      />
                    )}
                    <span>{f.original_name}</span>
                  </a>
                ))}
              </div>
            </section>
          )}
          {detail.visits.length > 0 && (
            <section className={styles.card}>
              <h2>Free site visits</h2>
              {detail.visits.map((v) => (
                <p key={v.quote_id}>
                  {when(v.scheduled_at)} · {v.address} · {v.status} · No charge
                </p>
              ))}
            </section>
          )}
          {customer && j.status === "posted" && (
            <section className={styles.card}>
              <h2>Before accepting a quote or visit</h2>
              <label className={styles.field}>
                Service address
                <input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  minLength={5}
                  maxLength={300}
                  autoComplete="street-address"
                />
              </label>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={terms}
                  onChange={(e) => setTerms(e.target.checked)}
                />
                I have read and accept the{" "}
                <Link href="/legal/handyman-terms" target="_blank">
                  Handyman Terms
                </Link>
                .
              </label>
            </section>
          )}
          <section className={styles.card}>
            <h2>
              {customer ? "Quotes and site visit proposals" : "Your quotes"}
            </h2>
            {!detail.quotes.length && (
              <p className={styles.muted}>
                No quotes yet. We notify approved professionals in ranked
                groups.
              </p>
            )}
            {detail.quotes.map((q) => (
              <article className={styles.quoteCard} key={q.id}>
                <header>
                  <strong>{q.display_name}</strong>
                  <span className={styles.status}>
                    {q.kind === "site_visit"
                      ? "Free site visit"
                      : q.kind === "revision"
                        ? "Revised fixed quote"
                        : "Fixed quote"}{" "}
                    · {q.status.replaceAll("_", " ")}
                  </span>
                </header>
                <h3>
                  {q.kind === "site_visit"
                    ? "Free — no commitment to paid work"
                    : money(q.total_pence) + " total, including materials"}
                </h3>
                <p className={styles.scope}>{q.scope}</p>
                <p className={styles.muted}>
                  Estimated on-site time: {q.duration_minutes} minutes ·
                  Earliest: {when(q.earliest_at)}
                </p>
                {customer &&
                  q.status === "sent" &&
                  ((j.status === "posted" && q.kind !== "revision") ||
                    (j.status === "in_progress" && q.kind === "revision")) && (
                    <button
                      className={styles.button}
                      disabled={
                        busy ||
                        (q.kind !== "revision" &&
                          (!terms ||
                            address.trim().length < 5 ||
                            !detail.termsVersion))
                      }
                      onClick={() => {
                        if (
                          !window.confirm(
                            q.kind === "site_visit"
                              ? "Agree this free site visit? No payment will be taken."
                              : q.kind === "revision"
                                ? `Approve revised total ${money(q.total_pence)}? Only the difference will be charged or refunded.`
                                : `Accept ${money(q.total_pence)} and pay in full? Other quotes will close.`,
                          )
                        )
                          return;
                        void action(
                          q.kind === "site_visit"
                            ? "accept_visit"
                            : q.kind === "revision"
                              ? "accept_revision"
                              : "accept",
                          {
                            quoteId: q.id,
                            address,
                            termsVersion: terms ? detail.termsVersion : null,
                          },
                        );
                      }}
                    >
                      {q.kind === "site_visit"
                        ? "Agree free visit"
                        : q.kind === "revision"
                          ? "Approve revised quote"
                          : "Accept quote & pay"}
                    </button>
                  )}
              </article>
            ))}
          </section>
          {!customer && ["posted", "in_progress"].includes(j.status) && (
            <form className={styles.card} onSubmit={sendQuote}>
              <h2>
                {j.status === "in_progress"
                  ? "Propose a scope change"
                  : "Send your proposal"}
              </h2>
              <p className={styles.muted}>
                Describe exactly what is included. All materials must be
                included in the fixed total. Time is for scheduling only.
              </p>
              {j.status === "posted" && (
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={siteVisit}
                    onChange={(e) => setSiteVisit(e.target.checked)}
                  />
                  Propose a free site visit first
                </label>
              )}
              <fieldset disabled={busy} className={styles.formFields}>
                <label className={styles.field}>
                  Included work and materials
                  <textarea
                    name="scope"
                    required
                    minLength={10}
                    maxLength={4000}
                  />
                </label>
                <div className={styles.grid}>
                  {(!siteVisit || j.status === "in_progress") && (
                    <label className={styles.field}>
                      Full fixed total (£), including materials
                      <input
                        name="total"
                        inputMode="decimal"
                        required
                        pattern="[0-9]+(\.[0-9]{1,2})?"
                        placeholder="e.g. 150.00"
                      />
                    </label>
                  )}
                  <label className={styles.field}>
                    Estimated on-site time
                    <select name="duration" defaultValue="60">
                      {Array.from({ length: 16 }, (_, n) => (n + 1) * 30).map(
                        (n) => (
                          <option value={n} key={n}>
                            {n} minutes
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                  {j.status === "posted" && (
                    <label className={styles.field}>
                      Earliest appointment
                      <input type="datetime-local" name="date" required />
                      <small>
                        Shown in your device timezone; the agreed booking
                        displays London time.
                      </small>
                    </label>
                  )}
                </div>
                <button className={styles.button}>
                  {j.status === "in_progress"
                    ? "Send revised quote for approval"
                    : siteVisit
                      ? "Propose free visit"
                      : "Send fixed quote"}
                </button>
              </fieldset>
            </form>
          )}
          {[
            "in_progress",
            "revision_pending",
            "awaiting_customer",
            "payment_pending",
            "completed",
          ].includes(j.status) && (
            <form
              className={styles.card}
              onSubmit={(e) => {
                e.preventDefault();
                void action("dispute", {
                  reason: new FormData(e.currentTarget).get("reason"),
                });
              }}
            >
              <h2>Need help with the work?</h2>
              <label className={styles.field}>
                Describe the issue
                <textarea
                  name="reason"
                  required
                  minLength={10}
                  maxLength={4000}
                />
              </label>
              <button className={styles.secondary} disabled={busy}>
                Send to admin resolution desk
              </button>
            </form>
          )}
          {customer && j.status === "completed" && (
            <form
              className={styles.card}
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void action("review", {
                  rating: Number(f.get("rating")),
                  comment: String(f.get("comment")),
                  isPublic: f.get("public") === "on",
                });
              }}
            >
              <h2>Review this job</h2>
              <label className={styles.field}>
                Rating
                <select name="rating" defaultValue={detail.review?.rating ?? 5}>
                  {[5, 4, 3, 2, 1].map((r) => (
                    <option key={r} value={r}>
                      {r} out of 5
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                Review
                <textarea
                  name="comment"
                  maxLength={2000}
                  defaultValue={detail.review?.comment ?? ""}
                />
              </label>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  name="public"
                  defaultChecked={detail.review?.is_public ?? false}
                />
                Display my review publicly
              </label>
              <button className={styles.button} disabled={busy}>
                Save review
              </button>
            </form>
          )}
        </>
      )}
    </main>
  );
}
