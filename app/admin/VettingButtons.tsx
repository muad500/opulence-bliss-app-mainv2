"use client";

// Approve / reject a provider. Save at: app/admin/VettingButtons.tsx

import { useEffect, useState, useTransition } from "react";
import { approveProvider, getProviderApprovalRequirements, rejectProvider } from "./actions";

export default function VettingButtons({
  id,
  dbsVerified,
  verificationRevision,
}: {
  id: string;
  dbsVerified: boolean;
  verificationRevision?: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[] | null>(null);

  useEffect(() => {
    let live = true;
    void getProviderApprovalRequirements(id).then(
      (items) => { if (live) { setMissing(items); setError(null); } },
      (reason) => { if (live) { setMissing(null); setError(reason instanceof Error ? reason.message : "Could not check approval requirements."); } },
    );
    return () => { live = false; };
  }, [id, dbsVerified, verificationRevision]);

  const canApprove = missing !== null && missing.length === 0;

  const base: React.CSSProperties = {
    borderRadius: 999,
    padding: "9px 18px",
    fontFamily: "'Hanken Grotesk', system-ui, sans-serif",
    fontSize: 13.5,
    fontWeight: 600,
    cursor: pending ? "wait" : "pointer",
    opacity: pending ? 0.6 : 1,
  };

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          disabled={pending || !canApprove}
          title={canApprove ? "Approve professional" : "Complete identity and DBS checks before approval"}
          onClick={() => {
            setError(null);
            start(async () => {
              try {
                await approveProvider(id);
              } catch (reason) {
                setError(reason instanceof Error ? reason.message : "Approval failed.");
              }
            });
          }}
          style={{
            ...base,
            background: canApprove ? "#2f4a3a" : "#d9dde2",
            color: canApprove ? "#fbf7f0" : "#7a828c",
            border: "none",
            cursor: pending ? "wait" : canApprove ? "pointer" : "not-allowed",
            opacity: pending ? 0.6 : canApprove ? 1 : 0.85,
          }}
        >
          {pending ? "…" : "Approve"}
        </button>
        <button
          disabled={pending}
          onClick={() => {
            if (!window.confirm("Reject this provider?")) return;
            setError(null);
            start(async () => {
              try {
                await rejectProvider(id);
              } catch (reason) {
                setError(reason instanceof Error ? reason.message : "Rejection failed.");
              }
            });
          }}
          style={{
            ...base,
            background: "transparent",
            color: "#8a4b26",
            border: "1.5px solid #e6c4b0",
          }}
        >
          Reject
        </button>
      </div>
      {missing === null && !error ? <small style={{ color: "#8a5a00", fontWeight: 800 }}>Checking approval requirements…</small> : null}
      {missing?.length ? (
        <small style={{ color: "#8a5a00", fontWeight: 800 }}>
          Verify {missing.join(", ")} before approval.
        </small>
      ) : null}
      {error ? (
        <small style={{ color: "#a52e47", fontWeight: 800 }}>{error}</small>
      ) : null}
    </div>
  );
}
