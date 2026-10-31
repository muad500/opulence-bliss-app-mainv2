"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type State = {
  paused: boolean;
  generation: number;
  reason: string | null;
  ended: boolean;
  processing: number;
  remaining: number;
};
type Preview = {
  action: "pause" | "end";
  fingerprint: string;
  refundPence: number;
  retainedPence: number;
  visits: {
    id: string;
    scheduledAt: string;
    cancel: boolean;
    refundPence: number;
    retainedPence: number;
  }[];
};
const money = (pence: number) => "£" + (pence / 100).toFixed(2);
export default function RegularSeriesControl({
  seriesId,
}: {
  seriesId: string;
}) {
  const [state, setState] = useState<State | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [resumeConfirmation, setResumeConfirmation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const endpoint = "/api/regular-series/" + seriesId;
  const refresh = useCallback(async () => {
    const response = await fetch(endpoint, { cache: "no-store" });
    if (response.ok) setState(await response.json());
  }, [endpoint]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(endpoint, { cache: "no-store", signal: controller.signal })
      .then(async (response) => (response.ok ? response.json() : null))
      .then(setState)
      .catch(() => undefined);
    return () => controller.abort();
  }, [endpoint]);
  useEffect(() => {
    if (!state?.processing) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh().catch(() => undefined);
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [refresh, state?.processing]);
  async function request(body: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error ?? "Please refresh and try again.");
      if (body.preview) setPreview(data);
      else {
        setPreview(null);
        setResumeConfirmation(false);
        await refresh();
        router.refresh();
      }
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (!state) return null;
  return (
    <section
      aria-label="Manage regular booking"
      className="rounded-2xl border p-5 my-4 space-y-3"
    >
      <h2 className="text-lg font-bold">
        Your regular booking
        {state.ended ? " has ended" : state.paused ? " is paused" : ""}
      </h2>
      {state.ended && Boolean(state.processing) && (
        <p role="status">
          Your series has ended. Visit refunds are still processing; you can
          leave this page safely.
        </p>
      )}
      {state.ended ? (
        <p>
          Cancelled visits stay cancelled. Work already started is unaffected.
          Make a new booking when you need another clean.
        </p>
      ) : (
        <>
          <p>
            Pause or end at any time. There is no fee for ending a series. Each
            confirmed visit keeps its own cancellation rules.
          </p>
          {state.paused && (
            <p>
              New offers, automatic charges and retries are stopped. Cancelled
              visits stay cancelled when you resume.
            </p>
          )}
          {Boolean(state.processing) && (
            <p role="status">
              Visit payment adjustments are processing. You can leave this page
              safely.
            </p>
          )}
          {preview ? (
            <div className="space-y-3" aria-live="polite">
              <h3 className="font-bold">Review before you {preview.action}</h3>
              <p>
                Accepted or paid future visits will be cancelled under each
                visit’s policy.{" "}
                {preview.action === "pause"
                  ? "Unassigned unpaid visits will be paused and can be resumed while their dates are still in the future."
                  : "All remaining future visits will be cancelled. Ending cannot be undone."}{" "}
                Work already started is unaffected.
              </p>
              <ul className="space-y-2">
                {preview.visits.map((visit) => (
                  <li key={visit.id}>
                    {new Date(visit.scheduledAt).toLocaleString("en-GB", {
                      timeZone: "Europe/London",
                    })}
                    :{" "}
                    {visit.cancel
                      ? "cancelled, refund " +
                        money(visit.refundPence) +
                        ", retained cancellation charge " +
                        money(visit.retainedPence)
                      : "paused, no charge"}
                  </li>
                ))}
              </ul>
              <p>
                Refund: {money(preview.refundPence)}. Retained cancellation
                charges: {money(preview.retainedPence)}. No new payment is
                taken.
              </p>
              <Button
                variant="outline"
                disabled={busy}
                className="h-auto min-h-11 whitespace-normal rounded-full bg-[#6d28d9] px-5 py-3 text-white hover:bg-[#5b21b6] hover:text-white"
                onClick={() =>
                  void request({
                    action: preview.action,
                    confirm: true,
                    fingerprint: preview.fingerprint,
                  })
                }
              >
                {busy ? "Updating…" : "Confirm and " + preview.action}
              </Button>{" "}
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setPreview(null)}
              >
                Keep my visits
              </Button>
            </div>
          ) : resumeConfirmation ? (
            <div className="space-y-3">
              <p>
                Resume matching for {state.remaining} remaining visits?
                Cancelled visits stay cancelled. Payment is only taken after a
                cleaner accepts, with the payment notice sent first.
              </p>
              <Button
                variant="outline"
                className="h-auto min-h-11 whitespace-normal rounded-full bg-[#6d28d9] px-5 py-3 text-white hover:bg-[#5b21b6] hover:text-white"
                disabled={busy}
                onClick={() =>
                  void request({
                    action: "resume",
                    confirm: true,
                    generation: state.generation,
                  })
                }
              >
                {busy ? "Resuming…" : "Confirm and resume visits"}
              </Button>{" "}
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setResumeConfirmation(false)}
              >
                Keep paused
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-3">
              {state.paused ? (
                <Button
                  variant="outline"
                  disabled={
                    busy || Boolean(state.processing) || !state.remaining
                  }
                  onClick={() => setResumeConfirmation(true)}
                >
                  Resume remaining visits
                </Button>
              ) : (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void request({ action: "pause", preview: true })
                  }
                >
                  Pause regular booking
                </Button>
              )}
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void request({ action: "end", preview: true })}
              >
                End regular booking
              </Button>
            </div>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
