"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { londonDate, londonParts } from "@/lib/appointmentWindow";
type Pending = { id: string; proposed_at: string; canRespond: boolean };
export default function AgreedCleaningTimeChange({
  bookingId,
}: {
  bookingId: string;
}) {
  const [pending, setPending] = useState<Pending | null>(null),
    [value, setValue] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const router = useRouter();
  const endpoint = `/api/cleaning-time-changes/${bookingId}`;
  useEffect(() => {
    const controller = new AbortController();
    void fetch(endpoint, { cache: "no-store", signal: controller.signal })
      .then(async (r) => (r.ok ? r.json() : null))
      .then((data) => setPending(data?.request ?? null))
      .catch(() => undefined);
    return () => controller.abort();
  }, [endpoint]);
  async function send(body: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, confirm: true }),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error ?? "Please try again");
      const fresh = await fetch(endpoint, { cache: "no-store" });
      if (fresh.ok) setPending((await fresh.json()).request);
      setMessage(
        body.action === "propose"
          ? "Request sent. The visit stays at its original time until the other person agrees."
          : body.accept
            ? "New time agreed. Your visit has moved free of charge."
            : "Time change declined. The original time stays in place.",
      );
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Please try again");
    } finally {
      setBusy(false);
    }
  }
  function propose() {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
    if (!match) {
      setMessage("Choose a date and time.");
      return;
    }
    const parts = match.slice(1).map(Number),
      date = londonDate(parts[0], parts[1], parts[2], parts[3], parts[4]),
      actual = londonParts(date);
    if (
      actual.year !== parts[0] ||
      actual.month !== parts[1] ||
      actual.day !== parts[2] ||
      actual.hour !== parts[3] ||
      actual.minute !== parts[4]
    ) {
      setMessage("Choose a valid London date and time.");
      return;
    }
    void send({ action: "propose", slot: date.toISOString() });
  }
  return (
    <section
      aria-label="Agree a new cleaning time"
      style={{
        padding: 18,
        margin: "16px 0",
        border: "1px solid var(--ob-line, #ddd)",
        borderRadius: 16,
      }}
    >
      <h2>Agree a new time</h2>
      <p>
        A time agreed with your assigned cleaner is free of charge at any time.
        The other person must accept it. Your original visit stays in place
        until then.
      </p>
      {pending ? (
        <div>
          <p>
            Proposed:{" "}
            {new Date(pending.proposed_at).toLocaleString("en-GB", {
              timeZone: "Europe/London",
              dateStyle: "long",
              timeStyle: "short",
            })}{" "}
            (London time)
          </p>
          {pending.canRespond ? (
            <>
              <button
                disabled={busy}
                onClick={() =>
                  void send({
                    action: "respond",
                    changeId: pending.id,
                    accept: true,
                  })
                }
              >
                Agree and move visit free of charge
              </button>{" "}
              <button
                disabled={busy}
                onClick={() =>
                  void send({
                    action: "respond",
                    changeId: pending.id,
                    accept: false,
                  })
                }
              >
                Decline
              </button>
            </>
          ) : (
            <p>Waiting for the other person to agree.</p>
          )}
        </div>
      ) : null}
      <label htmlFor={`new-time-${bookingId}`}>
        Propose a new date and time (London time)
      </label>{" "}
      <input
        id={`new-time-${bookingId}`}
        type="datetime-local"
        step={1800}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        style={{ maxWidth: "100%", padding: 10 }}
      />{" "}
      <button disabled={busy || !value} onClick={propose}>
        {busy ? "Saving…" : "Send time-change request"}
      </button>
      <p>
        If you change the booking alone with less than 48 hours’ notice, the
        original cancellation band applies.
      </p>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
