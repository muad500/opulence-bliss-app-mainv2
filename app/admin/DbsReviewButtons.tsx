"use client";

import { useState, useTransition } from "react";
import { setProviderDbsStatus } from "./actions";

type DbsStatus = "pending" | "verified" | "failed";

export default function DbsReviewButtons({
  id,
  status,
  onReviewed,
}: {
  id: string;
  status: DbsStatus;
  onReviewed?: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function verify() {
    if (!window.confirm("Confirm that you reviewed this DBS certificate?")) {
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await setProviderDbsStatus(id, "verified");
        onReviewed?.();
      } catch (reason) {
        setError(
          reason instanceof Error
            ? reason.message
            : "Could not verify the DBS certificate.",
        );
      }
    });
  }

  function fail() {
    const reason = window.prompt(
      "Why did this DBS certificate fail verification? This reason is saved and sent to the professional.",
    );
    if (!reason?.trim()) return;
    setError(null);
    startTransition(async () => {
      try {
        await setProviderDbsStatus(id, "failed", reason);
        onReviewed?.();
      } catch (failure) {
        setError(
          failure instanceof Error
            ? failure.message
            : "Could not update the DBS review.",
        );
      }
    });
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          disabled={pending || status === "verified"}
          onClick={verify}
          style={{
            ...button,
            borderColor: "#9ed4b1",
            background: status === "verified" ? "#dff5e8" : "#fff",
            color: "#137b4e",
            cursor: pending || status === "verified" ? "default" : "pointer",
            opacity: pending ? 0.6 : 1,
          }}
        >
          {pending
            ? "Saving…"
            : status === "verified"
              ? "Verified ✓"
              : "Verified"}
        </button>
        <button
          type="button"
          disabled={pending || status === "failed"}
          onClick={fail}
          style={{
            ...button,
            borderColor: "#efb5c1",
            background: status === "failed" ? "#ffe6ea" : "#fff",
            color: "#a52e47",
            cursor: pending || status === "failed" ? "default" : "pointer",
            opacity: pending ? 0.6 : 1,
          }}
        >
          {pending ? "Saving…" : status === "failed" ? "Failed ✓" : "Failed"}
        </button>
      </div>
      {error ? <p style={errorText}>{error}</p> : null}
    </div>
  );
}

const button: React.CSSProperties = {
  minWidth: 112,
  border: "1.5px solid",
  borderRadius: 999,
  padding: "9px 16px",
  fontFamily: "inherit",
  fontSize: 12.5,
  fontWeight: 900,
};

const errorText: React.CSSProperties = {
  margin: 0,
  color: "#a52e47",
  fontSize: 12,
  fontWeight: 800,
};
