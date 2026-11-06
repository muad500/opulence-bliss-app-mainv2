"use client";
import { useState } from "react";
import VerificationReview, {
  type VerificationRecord,
} from "./VerificationReview";
import {
  PROVIDER_DOCUMENT_LABELS,
  type ProviderDocumentType,
} from "@/lib/providerVerification";
export default function PrivateVerificationPanel({
  providerId,
  type,
}: {
  providerId: string;
  type: ProviderDocumentType;
}) {
  const [record, setRecord] = useState<VerificationRecord | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function open() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/admin/onboarding/${providerId}/verification`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type }),
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw Error(data.error ?? "Private record unavailable.");
      setRecord(data.record);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Please retry.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      style={{
        border: "1px solid var(--ob-border)",
        borderRadius: 12,
        padding: 16,
      }}
    >
      <h3>{PROVIDER_DOCUMENT_LABELS[type]}</h3>
      <button type="button" disabled={busy} onClick={() => void open()}>
        {busy
          ? "Checking named access…"
          : record
            ? "Refresh private record"
            : "Open private record"}
      </button>
      {record && <VerificationReview providerId={providerId} record={record} />}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
