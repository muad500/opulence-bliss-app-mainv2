"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  validCheckoutLegalDocuments,
  type CheckoutLegalDocument,
} from "@/lib/checkoutLegal";
import styles from "./BookingLegalConsent.module.css";
export type BookingLegalState = {
  accepted: boolean;
  documents: CheckoutLegalDocument[] | null;
};
export default function BookingLegalConsent({
  value,
  onChange,
  refreshKey,
}: {
  value: BookingLegalState;
  onChange: (value: BookingLegalState) => void;
  refreshKey: number;
}) {
  const [error, setError] = useState("");
  const signature = useRef("");
  const current = useRef(value);
  const notify = useRef(onChange);
  useEffect(() => {
    current.current = value;
    notify.current = onChange;
  }, [value, onChange]);
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/checkout-legal", {
        cache: "no-store",
        signal,
      });
      const data = await response.json();
      if (!response.ok || !validCheckoutLegalDocuments(data.documents))
        throw new Error("Unavailable");
      if (signal?.aborted) return;
      const next = JSON.stringify(
        [...data.documents].sort((a, b) => a.slug.localeCompare(b.slug)),
      );
      if (next !== signature.current) {
        signature.current = next;
        notify.current({ accepted: false, documents: data.documents });
      }
      setError("");
    } catch {
      if (signal?.aborted) return;
      signature.current = "";
      notify.current({ accepted: false, documents: null });
      setError(
        "Booking policies are being updated. Please retry before paying.",
      );
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    signature.current = "";
    void Promise.resolve().then(() => {
      if (controller.signal.aborted) return;
      notify.current({ accepted: false, documents: null });
      return load(controller.signal);
    });
    const focus = () => void load(controller.signal);
    window.addEventListener("focus", focus);
    return () => {
      controller.abort();
      window.removeEventListener("focus", focus);
    };
  }, [load, refreshKey]);
  const version = (slug: string) =>
    value.documents?.find((d) => d.slug === slug)?.version;
  const link = (slug: string, title: string) => (
    <a href={`/legal/${slug}`} target="_blank" rel="noopener noreferrer">
      {title}
    </a>
  );
  return (
    <section className={styles.box} aria-label="Booking policies">
      {value.documents ? (
        <label className={styles.label} htmlFor="booking-legal-acceptance">
          <input
            id="booking-legal-acceptance"
            type="checkbox"
            required
            checked={value.accepted}
            onChange={(e) => onChange({ ...value, accepted: e.target.checked })}
          />
          <span>
            I accept the {link("terms", "Terms & Conditions")} (Version{" "}
            {version("terms")}) and the{" "}
            {link("cancellation-refund", "Cancellation & Refund Policy")}{" "}
            (Version {version("cancellation-refund")}), and I have read the{" "}
            {link("privacy", "Privacy Policy")} (Version {version("privacy")}).
          </span>
        </label>
      ) : (
        <p role="status">{error || "Loading booking policies…"}</p>
      )}
      {error && (
        <button type="button" onClick={() => void load()}>
          Retry policies
        </button>
      )}
    </section>
  );
}
