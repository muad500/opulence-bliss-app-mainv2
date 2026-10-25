"use client";
import { useEffect, useState } from "react";
export default function SafeguardingLaunchSettings() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch("/api/admin/safeguarding-launch", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error();
        setEnabled(data.enabled);
      })
      .catch(() => setMessage("Could not load safeguarding switch."));
  }, []);
  async function toggle() {
    setBusy(true);
    try {
      const response = await fetch("/api/admin/safeguarding-launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !enabled }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setEnabled(data.enabled);
      setMessage(
        "Saved. This applies to new applications; earlier acceptances remain recorded.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      style={{
        marginTop: 24,
        padding: 20,
        border: "1px solid #e3ddef",
        borderRadius: 16,
      }}
    >
      <h2>Safeguarding registration consent</h2>
      <p>
        Off until launch of the Safeguarding Policy. Enabling requires a real
        published policy; no placeholder or missing-document link is shown to
        applicants.
      </p>
      <p>Status: {enabled === null ? "Loading" : enabled ? "On" : "Off"}</p>
      <button
        type="button"
        disabled={busy || enabled === null}
        onClick={toggle}
      >
        {enabled ? "Turn off" : "Turn on after policy publication"}
      </button>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
