"use client";

import { FormEvent, useState } from "react";
import {
  PROVIDER_DOCUMENT_LABELS,
  PROVIDER_DOCUMENT_TYPES,
  type ProviderDocumentType,
} from "@/lib/providerVerification";
import styles from "./profile.module.css";

export type Check = {
  type: string;
  status: "pending" | "verified" | "expired" | "rejected";
  reference: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  lastCheckedAt: string | null;
  nextCheckAt: string | null;
  uploadedAt: string | null;
  originalName: string | null;
  hasDocument: boolean;
  reviewNote: string | null;
};

function dateText(value: string | null) {
  if (!value) return "Not supplied";
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.valueOf())
    ? value
    : date.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
}

export default function VerificationDocuments({
  checks,
  services,
  onUploaded,
}: {
  checks: Check[];
  services: string[];
  onUploaded: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<
    Record<string, { error: boolean; text: string }>
  >({});
  const types = PROVIDER_DOCUMENT_TYPES.filter(
    (type) =>
      !["trade_certificate", "public_liability_insurance"].includes(type) ||
      services.includes("handyman"),
  );
  const dbs = checks.find((item) => item.type === "dbs");

  async function upload(
    event: FormEvent<HTMLFormElement>,
    type: ProviderDocumentType | "dbs",
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    data.set("type", type);
    setBusy(type);
    setFeedback((current) => ({
      ...current,
      [type]: { error: false, text: "Uploading…" },
    }));
    try {
      const response = await fetch("/api/account/verification-document", {
        method: "POST",
        body: data,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(result.error ?? "Document could not be uploaded.");
      await onUploaded();
      form.reset();
      setFeedback((current) => ({
        ...current,
        [type]: {
          error: false,
          text: "Document received. The review team will check it.",
        },
      }));
    } catch (cause) {
      setFeedback((current) => ({
        ...current,
        [type]: {
          error: true,
          text:
            cause instanceof Error
              ? cause.message
              : "Document could not be uploaded.",
        },
      }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={styles.verifyList}>
      {types.map((type) => {
        const check = checks.find((item) => item.type === type);
        return (
          <article
            className={styles.documentCard}
            key={`${type}:${check?.uploadedAt ?? ""}`}
          >
            <div className={styles.documentTop}>
              <div>
                <strong>{PROVIDER_DOCUMENT_LABELS[type]}</strong>
                <span>{check?.originalName ?? "No document on file"}</span>
              </div>
              <span
                className={`${styles.status} ${check ? styles[check.status] : styles.notSubmitted}`}
              >
                {check?.status ?? "Not submitted"}
              </span>
            </div>
            {check?.expiresAt && (
              <small>Expires {dateText(check.expiresAt)}</small>
            )}
            {check?.reference && <small>Share code: {check.reference}</small>}
            {type === "right_to_work" && check?.lastCheckedAt && (
              <small>
                GOV.UK check completed{" "}
                {dateText(check.lastCheckedAt.slice(0, 10))}
              </small>
            )}
            {check?.nextCheckAt && (
              <small>Re-check due {dateText(check.nextCheckAt)}</small>
            )}
            {check?.reviewNote && (
              <p className={styles.documentNote}>
                Review note: {check.reviewNote}
              </p>
            )}
            {check?.hasDocument && (
              <a
                className={styles.documentLink}
                href={`/api/account/verification-document?type=${type}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                View uploaded document ↗
              </a>
            )}
            <details className={styles.documentUpload}>
              <summary>
                {check?.hasDocument ? "Replace document" : "Upload document"}
              </summary>
              <form onSubmit={(event) => void upload(event, type)}>
                {type === "right_to_work" && (
                  <label>
                    Right-to-work share code (optional if providing visa
                    evidence)
                    <input
                      name="reference"
                      maxLength={9}
                      placeholder="9 characters"
                      autoComplete="off"
                    />
                  </label>
                )}
                <label>
                  PDF, JPEG or PNG, up to 4 MB
                  {type === "right_to_work"
                    ? " (optional with a share code)"
                    : ""}
                  <input
                    type="file"
                    name="file"
                    accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                    required={type !== "right_to_work"}
                  />
                </label>
                <div className={styles.documentDates}>
                  <label>
                    Issue date{" "}
                    <input
                      type="date"
                      name="issuedAt"
                      defaultValue={check?.issuedAt ?? ""}
                    />
                  </label>
                  <label>
                    Expiry date{" "}
                    {type === "public_liability_insurance"
                      ? "(required)"
                      : "(if applicable)"}
                    <input
                      type="date"
                      name="expiresAt"
                      defaultValue={check?.expiresAt ?? ""}
                      required={type === "public_liability_insurance"}
                    />
                  </label>
                </div>
                <button
                  className={styles.secondaryButton}
                  type="submit"
                  disabled={busy !== null}
                >
                  {busy === type ? "Uploading…" : "Submit for review"}
                </button>
              </form>
            </details>
            {feedback[type] && (
              <p
                role="status"
                className={
                  feedback[type].error
                    ? styles.errorNotice
                    : styles.successNotice
                }
              >
                {feedback[type].text}
              </p>
            )}
          </article>
        );
      })}
      <article className={styles.documentCard}>
        <div className={styles.documentTop}>
          <div>
            <strong>DBS check</strong>
            <span>
              {dbs?.status === "verified"
                ? "Certificate copy deleted after verification"
                : dbs?.uploadedAt
                  ? "Certificate submitted"
                  : "No certificate on file"}
            </span>
          </div>
          <span
            className={`${styles.status} ${dbs ? styles[dbs.status] : styles.notSubmitted}`}
          >
            {dbs?.status ?? "Not submitted"}
          </span>
        </div>
        {dbs?.reviewNote && (
          <p className={styles.documentNote}>Review note: {dbs.reviewNote}</p>
        )}
        {dbs?.reference && <small>Certificate number: {dbs.reference}</small>}
        {dbs?.issuedAt && <small>Issued {dateText(dbs.issuedAt)}</small>}
        {dbs?.nextCheckAt && (
          <small>Annual re-check due {dateText(dbs.nextCheckAt)}</small>
        )}
        <p className={styles.help}>
          DBS copies are removed after checking. We remind you before your
          annual re-check.
        </p>
        <details className={styles.documentUpload}>
          <summary>
            {dbs ? "Submit updated certificate" : "Upload DBS certificate"}
          </summary>
          <form onSubmit={(event) => void upload(event, "dbs")}>
            <label>
              Certificate number
              <input
                name="reference"
                inputMode="numeric"
                pattern="[0-9]{12}"
                maxLength={12}
                required
              />
            </label>
            <label>
              Issue date
              <input type="date" name="issuedAt" required />
            </label>
            <label>
              PDF, JPEG or PNG, up to 4 MB
              <input
                type="file"
                name="file"
                accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                required
              />
            </label>
            <button
              className={styles.secondaryButton}
              type="submit"
              disabled={busy !== null}
            >
              {busy === "dbs" ? "Uploading…" : "Submit for review"}
            </button>
          </form>
        </details>
        {feedback.dbs && (
          <p
            role="status"
            className={
              feedback.dbs.error ? styles.errorNotice : styles.successNotice
            }
          >
            {feedback.dbs.text}
          </p>
        )}
      </article>
    </div>
  );
}
