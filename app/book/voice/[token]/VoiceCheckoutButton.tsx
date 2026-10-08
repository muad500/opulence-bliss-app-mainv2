"use client";
import { useState } from "react";
import Link from "next/link";
import { EARLY_START_REQUEST_TEXT } from "@/lib/cancellationPeriod";

export default function VoiceCheckoutButton({ token, earlyStartRequired }: { token: string; earlyStartRequired: boolean }) {
  const [reviewed, setReviewed] = useState(false);
  const [earlyStart, setEarlyStart] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function pay() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/voice-booking/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, reviewConfirmed: reviewed, earlyStartRequested: earlyStart }) });
      const result = await response.json();
      if (!response.ok || !result.url) throw new Error(result.error ?? "Could not open secure payment.");
      const target = new URL(result.url, window.location.origin);
      if (target.origin !== window.location.origin && (target.protocol !== "https:" || target.hostname !== "checkout.stripe.com")) throw new Error("The payment link is invalid.");
      window.location.assign(target.href);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Please try again."); setBusy(false); }
  }
  return <section className="mt-6 space-y-4">
    <label className="flex gap-3 text-sm"><input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} /><span>I have checked these details and agree to the <Link className="underline" href="/legal/terms" target="_blank" rel="noreferrer">Terms</Link> and <Link className="underline" href="/legal/cancellation-refund" target="_blank" rel="noreferrer">Cancellation &amp; Refund Policy</Link>.</span></label>
    {earlyStartRequired && <label className="flex gap-3 text-sm"><input type="checkbox" checked={earlyStart} onChange={(e) => setEarlyStart(e.target.checked)} /><span>{EARLY_START_REQUEST_TEXT}</span></label>}
    {error && <p role="alert" className="text-red-700">{error}</p>}
    <button className="rounded-full bg-purple-700 px-6 py-3 font-bold text-white disabled:opacity-50" disabled={busy || !reviewed || (earlyStartRequired && !earlyStart)} onClick={() => void pay()}>{busy ? "Opening secure payment…" : "Continue to secure payment"}</button>
  </section>;
}
