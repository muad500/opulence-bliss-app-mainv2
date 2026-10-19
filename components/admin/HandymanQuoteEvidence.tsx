"use client";
import { useState } from "react";
import { handymanMoney } from "@/lib/handymanQuotes";
type Evidence = {
  job: {
    description: string;
    address: string;
    postcode: string;
    commission_bps: number;
    terms_version: string;
    status: string;
  };
  quotes: {
    id: string;
    provider_id: string;
    kind: string;
    total_pence: number;
    scope: string;
    status: string;
  }[];
  events: { actor_id: string | null; action: string; created_at: string }[];
  files: { name: string; url: string | null }[];
  operations: {
    id: string;
    kind: string;
    amount_pence: number;
    status: string;
    payment_intent: string | null;
    stripe_ref: string | null;
    last_error: string | null;
  }[];
};
export default function HandymanQuoteEvidence({ jobId }: { jobId: string }) {
  const [evidence, setEvidence] = useState<Evidence | null>(null),
    [error, setError] = useState("");
  return (
    <details
      onToggle={(e) => {
        if (!e.currentTarget.open || evidence) return;
        void fetch("/api/handyman/admin?job=" + encodeURIComponent(jobId), {
          cache: "no-store",
        })
          .then(async (r) => {
            const d = await r.json();
            if (!r.ok) throw new Error(d.error);
            setEvidence(d);
          })
          .catch((e) => setError(e.message));
      }}
    >
      <summary>Review scope, photos and payment history</summary>
      {error && <p role="alert">{error}</p>}
      {evidence && (
        <>
          <p>{evidence.job.description}</p>
          <p>
            {evidence.job.address}, {evidence.job.postcode} ·{" "}
            {evidence.job.status}
          </p>
          <p>
            Agreed commission: {evidence.job.commission_bps / 100}% · Terms:{" "}
            {evidence.job.terms_version}
          </p>
          {evidence.files.map((f, i) => (
            <p key={i}>
              {f.url ? (
                <a href={f.url} target="_blank" rel="noreferrer">
                  {f.name}
                </a>
              ) : (
                f.name
              )}
            </p>
          ))}
          <h4>Quote history</h4>
          {evidence.quotes.map((q) => (
            <div key={q.id}>
              <strong>
                {q.kind} · {handymanMoney(q.total_pence)} · {q.status}
              </strong>
              <p style={{ whiteSpace: "pre-wrap" }}>{q.scope}</p>
              <small>Professional {q.provider_id}</small>
            </div>
          ))}
          <h4>Payment ledger</h4>
          {evidence.operations.map((o) => (
            <p key={o.id}>
              {o.kind} · {handymanMoney(o.amount_pence)} · {o.status} ·{" "}
              {o.payment_intent ?? o.stripe_ref ?? "not settled"}
              {o.last_error ? " · " + o.last_error : ""}
            </p>
          ))}
          <h4>Action history</h4>
          {evidence.events.map((e, i) => (
            <p key={i}>
              {new Date(e.created_at).toLocaleString("en-GB", {
                timeZone: "Europe/London",
              })}{" "}
              · {e.action} · {e.actor_id ?? "system"}
            </p>
          ))}
        </>
      )}
    </details>
  );
}
