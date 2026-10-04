"use client";

import { useEffect, useState } from "react";
import {
  CLEANING_DURATIONS,
  bookingPricePence,
  durationLabel,
} from "@/lib/cleaningBooking";
import { londonDateKey, appointmentTimeLabel } from "@/lib/appointmentWindow";
import type { AssistantPackage } from "@/lib/assistantBooking";
import styles from "./AssistantBooking.module.css";

type Service = AssistantPackage & { hourly_rate_gbp: number };
type Draft = {
  url: string;
  service: string;
  total_gbp: number;
  visits: number;
  preferred_time: string;
  optional_times: string[];
  duration_minutes: number;
  note: string;
};
const money = (amount: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(
    amount,
  );
const when = (time: string) =>
  new Date(time).toLocaleString("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

export default function AssistantBooking({
  onPrepared,
  onClose,
}: {
  onPrepared: (draft: Draft) => void;
  onClose: () => void;
}) {
  const [services, setServices] = useState<Service[]>([]);
  const [serviceId, setServiceId] = useState("");
  const [postcode, setPostcode] = useState("");
  const [minutes, setMinutes] = useState(120);
  const [frequency, setFrequency] = useState("one_time");
  const [visits, setVisits] = useState(6);
  const [slots, setSlots] = useState<string[]>([]);
  const [date, setDate] = useState("");
  const [preferred, setPreferred] = useState("");
  const [optional, setOptional] = useState<string[]>([]);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selected = services.find((service) => service.id === serviceId);
  const regular = frequency !== "one_time";
  const dates = [...new Set(slots.map(londonDateKey))];
  const times = slots.filter((time) => londonDateKey(time) === date);

  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    fetch("/api/ai/booking", { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        setServices(data.services);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause.message ?? "Could not load cleaning services.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, []);

  async function loadTimes() {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    try {
      const query = new URLSearchParams({
        postcode,
        duration: String(minutes),
      });
      const response = await fetch(`/api/ai/booking?${query}`, {
        signal: AbortSignal.timeout(20_000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (!data.covered)
        throw new Error(
          "We do not currently cover that postcode. Please try another address.",
        );
      if (!data.slots?.length)
        throw new Error("No permitted times were found. Please try again.");
      setSlots(data.slots);
      setDate(londonDateKey(data.slots[0]));
      setPreferred("");
      setOptional([]);
      setStep(1);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not check times.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function prepare() {
    if (!preferred || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/ai/booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service_id: serviceId,
          postcode,
          duration_minutes: minutes,
          frequency,
          visits,
          slot: preferred,
          optional_slots: optional,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      onPrepared(data);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not prepare your booking.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className={styles.card}
      aria-label="Guided cleaning booking"
      aria-busy={busy}
    >
      <div className={styles.heading}>
        <div>
          <small>LET’S FIND YOUR CLEAN</small>
          <h2>{step ? "Choose your times" : "Tell us what you need"}</h2>
        </div>
        <button type="button" onClick={onClose} disabled={busy}>
          Back to chat
        </button>
      </div>
      <p className={styles.intro}>
        {step
          ? "All times are UK time. Pick your first choice, then add as many alternatives as you like."
          : "Choose a service and hours. You’ll confirm your address, home details and final price before checkout."}
      </p>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {step === 0 ? (
        <>
          <label className={styles.field}>
            Cleaning service
            <select
              value={serviceId}
              disabled={busy}
              onChange={(event) => {
                setServiceId(event.target.value);
                setFrequency(
                  services.find((item) => item.id === event.target.value)
                    ?.name === "Essential Clean"
                    ? "weekly"
                    : "one_time",
                );
              }}
            >
              <option value="">Choose a service</option>
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name} · {money(service.hourly_rate_gbp)}/hr
                </option>
              ))}
            </select>
          </label>
          {selected && (
            <p className={styles.description}>{selected.description}</p>
          )}
          <div className={styles.grid}>
            <label className={styles.field}>
              Full postcode
              <input
                value={postcode}
                onChange={(event) => setPostcode(event.target.value)}
                autoComplete="postal-code"
                placeholder="SW3 1AA"
                maxLength={10}
                disabled={busy}
              />
            </label>
            <label className={styles.field}>
              Cleaning hours
              <select
                value={minutes}
                onChange={(event) => setMinutes(Number(event.target.value))}
                disabled={busy}
              >
                {CLEANING_DURATIONS.map((time) => (
                  <option key={time} value={time}>
                    {durationLabel(time)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {selected?.name === "Essential Clean" && (
            <div className={styles.grid}>
              <label className={styles.field}>
                Regular frequency
                <select
                  value={frequency}
                  onChange={(event) => setFrequency(event.target.value)}
                  disabled={busy}
                >
                  <option value="weekly">Every week</option>
                  <option value="fortnightly">Every two weeks</option>
                  <option value="monthly">Every month</option>
                </select>
              </label>
              <label className={styles.field}>
                Number of visits
                <select
                  value={visits}
                  onChange={(event) => setVisits(Number(event.target.value))}
                  disabled={busy}
                >
                  {[6, 7, 8, 9, 10].map((count) => (
                    <option key={count}>{count}</option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {selected && (
            <p className={styles.total}>
              <strong>
                {money(
                  (bookingPricePence(selected, minutes) *
                    (regular ? visits : 1)) /
                    100,
                )}
              </strong>
              <span>
                {regular
                  ? `${visits} visits paid upfront · ${money(bookingPricePence(selected, minutes) / 100)} per visit`
                  : "For one visit, before any checkout discount"}
              </span>
            </p>
          )}
          <button
            className={styles.primary}
            type="button"
            onClick={() => void loadTimes()}
            disabled={busy || !selected || !postcode.trim()}
          >
            {busy ? "Checking…" : "Choose a time →"}
          </button>
          {!services.length && !busy && (
            <a href="/book">Use the booking form →</a>
          )}
        </>
      ) : (
        <>
          <label className={styles.field}>
            Appointment date
            <select
              value={date}
              onChange={(event) => setDate(event.target.value)}
              disabled={busy}
            >
              {dates.map((day) => (
                <option key={day} value={day}>
                  {new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    timeZone: "Europe/London",
                  })}
                </option>
              ))}
            </select>
          </label>
          <fieldset className={styles.times}>
            <legend>Preferred time — your first choice</legend>
            {times.map((time) => (
              <label
                key={time}
                className={preferred === time ? styles.selected : ""}
              >
                <input
                  type="radio"
                  name="assistant-preferred"
                  value={time}
                  checked={preferred === time}
                  disabled={busy}
                  onChange={() => {
                    setPreferred(time);
                    setOptional((current) =>
                      current.filter((value) => value !== time),
                    );
                  }}
                />
                {appointmentTimeLabel(time)}
              </label>
            ))}
          </fieldset>
          {preferred && (
            <p className={styles.firstChoice}>
              <strong>First choice:</strong> {when(preferred)}
            </p>
          )}
          {!regular && (
            <fieldset className={styles.times}>
              <legend>Optional times — any others you can do</legend>
              {times
                .filter((time) => time !== preferred)
                .map((time) => (
                  <label
                    key={time}
                    className={optional.includes(time) ? styles.selected : ""}
                  >
                    <input
                      type="checkbox"
                      checked={optional.includes(time)}
                      disabled={busy || !preferred}
                      onChange={(event) =>
                        setOptional((current) =>
                          event.target.checked
                            ? [...current, time]
                            : current.filter((value) => value !== time),
                        )
                      }
                    />
                    {appointmentTimeLabel(time)}
                  </label>
                ))}
            </fieldset>
          )}
          {optional.length > 0 && (
            <ul className={styles.alternatives}>
              {optional.map((time) => (
                <li key={time}>
                  {when(time)}{" "}
                  <button
                    type="button"
                    aria-label={`Remove optional time ${when(time)}`}
                    onClick={() =>
                      setOptional((current) =>
                        current.filter((value) => value !== time),
                      )
                    }
                    disabled={busy}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className={styles.intro}>
            Cleaner matching happens after booking. These times do not guarantee
            a cleaner has accepted.
          </p>
          <button
            className={styles.primary}
            type="button"
            onClick={() => void prepare()}
            disabled={busy || !preferred}
          >
            {busy ? "Checking your draft…" : "Review booking →"}
          </button>
          <button
            className={styles.back}
            type="button"
            disabled={busy}
            onClick={() => {
              setStep(0);
              setError("");
            }}
          >
            ← Change service or hours
          </button>
        </>
      )}
    </section>
  );
}
