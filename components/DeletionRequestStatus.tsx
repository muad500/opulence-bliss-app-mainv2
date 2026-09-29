"use client";

import { useEffect, useState } from "react";
import styles from "./DeletionRequestStatus.module.css";

type RequestStatus = "pending" | "in_review" | "completed" | "declined";
type DeletionRequest = {
  status: RequestStatus;
  requestedAt: string;
  resolvedAt: string | null;
  note: string | null;
};

export const DELETION_REQUEST_UPDATED_EVENT = "opulence:account-deletion-request-updated";

const COPY: Record<RequestStatus, { label: string; description: string }> = {
  pending: { label: "Pending", description: "We received your request and will review it." },
  in_review: { label: "In review", description: "We are checking your account, current bookings and records we must retain." },
  completed: { label: "Completed", description: "Our team has finished handling this request." },
  declined: { label: "Declined", description: "We could not complete this request. The reason is shown below." },
};

function date(value: string) {
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function DeletionRequestStatus() {
  const [request, setRequest] = useState<DeletionRequest | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let controller: AbortController | null = null;
    let live = true;

    async function load() {
      controller?.abort();
      const requestController = new AbortController();
      controller = requestController;
      try {
        const response = await fetch("/api/account/deletion-request", {
          credentials: "same-origin", cache: "no-store", signal: requestController.signal,
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "Could not load your request status.");
        if (!live) return;
        setRequest(body.request ?? null);
        setError("");
      } catch (cause) {
        if (!live || requestController.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Could not load your request status.");
      }
    }

    void load();
    const refresh = () => { void load(); };
    window.addEventListener(DELETION_REQUEST_UPDATED_EVENT, refresh);
    window.addEventListener("focus", refresh);
    return () => {
      live = false;
      controller?.abort();
      window.removeEventListener(DELETION_REQUEST_UPDATED_EVENT, refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  if (error) return <p className={styles.error} role="alert">{error}</p>;
  if (!request) return null;

  const copy = COPY[request.status];
  return (
    <div className={styles.card} aria-label="Account deletion request status">
      <div className={styles.heading}>
        <strong>Account deletion request</strong>
        <span className={`${styles.badge} ${styles[request.status]}`}>{copy.label}</span>
      </div>
      <p>{copy.description}</p>
      <small>Requested {date(request.requestedAt)}{request.resolvedAt ? ` · Updated ${date(request.resolvedAt)}` : ""}</small>
      {request.note && <p className={styles.note}><strong>Outcome:</strong> {request.note}</p>}
    </div>
  );
}
