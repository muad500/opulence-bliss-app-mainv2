"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type State = { paused: boolean; generation: number; reason: string | null };

export default function RegularSeriesControl({
  seriesId,
}: {
  seriesId: string;
}) {
  const [state, setState] = useState<State | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/regular-series/${seriesId}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => (response.ok ? response.json() : null))
      .then(setState)
      .catch(() => undefined);
    return () => controller.abort();
  }, [seriesId]);
  if (!state?.paused) return null;
  async function resume() {
    if (!state || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/regular-series/${seriesId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "resume",
          confirm: true,
          generation: state.generation,
        }),
      });
      if (!response.ok)
        throw new Error(
          "Your visits could not be resumed. Refresh and try again.",
        );
      setState({ ...state, paused: false });
      router.refresh();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <aside
      aria-label="Regular visits paused"
      style={{
        margin: "16px 0",
        padding: 18,
        borderRadius: 14,
        background: "#fff5df",
        color: "#593e14",
        border: "1px solid #ecd9b0",
      }}
    >
      <strong>Your regular visits are paused</strong>
      <p>
        We could not find a cleaner for two visits in a row. Remaining automatic
        payments and retries are stopped.
      </p>
      {confirming ? (
        <>
          <p>
            Resume matching for the remaining visits? Cancelled visits stay
            cancelled. Later visits are charged only after a cleaner accepts, at
            48 hours before or immediately if closer.
          </p>
          <button disabled={busy} onClick={() => void resume()}>
            {busy ? "Resuming…" : "Confirm and resume visits"}
          </button>{" "}
          <button disabled={busy} onClick={() => setConfirming(false)}>
            Keep paused
          </button>
        </>
      ) : (
        <button onClick={() => setConfirming(true)}>
          Resume remaining visits
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </aside>
  );
}
