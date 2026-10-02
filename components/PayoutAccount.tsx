"use client";
import { useEffect, useState } from "react";

export default function PayoutAccount() {
  const [status, setStatus] = useState<{ connected: boolean; status: string; requirementsDue: number } | null>(null);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/account/payout-account", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setStatus(data);
    }).catch((cause) => { if (!controller.signal.aborted) setError(cause.message || "Stripe status could not be checked."); });
    return () => controller.abort();
  }, []);
  return <div style={{ display: "grid", gap: 10, marginBottom: 24 }}>
    <strong>{status?.status ?? (error ? "Status unavailable" : "Checking Stripe…")}</strong>
    {status && status.requirementsDue > 0 && <small>Stripe needs additional information. Open Stripe to see what is required.</small>}
    {status?.connected ? <button type="button" disabled={busy} onClick={async () => {
      setBusy(true); setError("");
      try {
        const response = await fetch("/api/account/payout-account", { method: "POST" });
        const data = await response.json(); if (!response.ok) throw new Error(data.error);
        window.location.assign(data.url);
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not open Stripe."); setBusy(false); }
    }}>{busy ? "Opening…" : "Manage bank details and Stripe setup"}</button> : status && <small>Contact support to connect your payout account.</small>}
    {error && <small role="alert">{error}</small>}
  </div>;
}
