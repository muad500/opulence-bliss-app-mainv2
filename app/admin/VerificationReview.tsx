"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reviewProviderDocument } from "./verification-actions";

export type VerificationRecord = {
  type: string;
  label: string;
  status: string;
  uploadedAt: string | null;
  originalName: string | null;
  signedUrl: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  nextCheckAt: string | null;
  reference: string | null;
  reviewNote: string | null;
};

export default function VerificationReview({ providerId, record }: {
  providerId: string;
  record: VerificationRecord;
}) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function review(decision: "verified" | "rejected") {
    if (!form.current || !record.uploadedAt) return;
    const data = new FormData(form.current);
    if (decision === "rejected" && !String(data.get("note") ?? "").trim()) {
      setError("Enter a reason before rejecting this document.");
      return;
    }
    if (decision === "verified" && !window.confirm(`Confirm you inspected the ${record.label} document?`)) return;
    setError(null);
    startTransition(async () => {
      try {
        await reviewProviderDocument(providerId, record.type, record.uploadedAt!, decision, data);
        router.refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "The document review could not be saved.");
      }
    });
  }

  return <article style={card}>
    <div style={top}>
      <div><strong>{record.label}</strong><p style={muted}>{record.originalName ?? "No document uploaded"}</p></div>
      <span style={{ ...badge, background: record.status === "verified" ? "#dff5e8" : record.status === "pending" ? "#fff3d6" : record.status === "not submitted" ? "#f1f2f3" : "#ffe6ea" }}>{record.status}</span>
    </div>
    {record.uploadedAt ? <p style={muted}>Uploaded {new Date(record.uploadedAt).toLocaleString("en-GB")}</p> : null}
    {record.signedUrl ? <a href={record.signedUrl} target="_blank" rel="noopener noreferrer" style={link}>Open private document ↗</a> : record.uploadedAt ? <p style={warning}>The uploaded file is unavailable; ask the professional to replace it.</p> : null}
    {record.reviewNote ? <p style={muted}>Review note: {record.reviewNote}</p> : null}
    {record.status === "pending" && record.uploadedAt && record.signedUrl ? <form ref={form} style={fields} onSubmit={(event) => event.preventDefault()}>
      <label>Reference <input name="reference" defaultValue={record.reference ?? ""} maxLength={120} /></label>
      <label>Issue date <input name="issuedAt" type="date" defaultValue={record.issuedAt ?? ""} /></label>
      <label>Expiry date <input name="expiresAt" type="date" defaultValue={record.expiresAt ?? ""} required={record.type === "public_liability_insurance"} /></label>
      <label>Re-check date <input name="nextCheckAt" type="date" defaultValue={record.nextCheckAt ?? ""} /></label>
      <label style={{ gridColumn: "1 / -1" }}>Review note <textarea name="note" defaultValue={record.reviewNote ?? ""} maxLength={500} rows={2} placeholder="Required when a document is rejected" /></label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", gridColumn: "1 / -1" }}>
        <button type="button" disabled={pending} onClick={() => review("verified")} style={approve}>Verify after review</button>
        <button type="button" disabled={pending} onClick={() => review("rejected")} style={reject}>Needs replacement</button>
      </div>
    </form> : null}
    {error ? <p role="alert" style={warning}>{error}</p> : null}
  </article>;
}

const card: React.CSSProperties = { border: "1px solid #e9e5dd", borderRadius: 12, padding: 15, display: "grid", gap: 9 };
const top: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 };
const muted: React.CSSProperties = { margin: 0, fontSize: 12, color: "#655f55" };
const badge: React.CSSProperties = { borderRadius: 999, padding: "5px 9px", fontSize: 11, fontWeight: 800, textTransform: "capitalize" };
const link: React.CSSProperties = { fontSize: 12, fontWeight: 800, color: "#7a4c26" };
const warning: React.CSSProperties = { margin: 0, fontSize: 12, color: "#a3283e" };
const fields: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, marginTop: 5 };
const approve: React.CSSProperties = { padding: "9px 14px", border: "1px solid #9ed4b1", borderRadius: 999, color: "#137b4e", background: "white", fontWeight: 800, cursor: "pointer" };
const reject: React.CSSProperties = { padding: "9px 14px", border: "1px solid #efb5c1", borderRadius: 999, color: "#a52e47", background: "white", fontWeight: 800, cursor: "pointer" };
