"use client";

import { useRef, useState } from "react";
import DbsReviewButtons from "./DbsReviewButtons";
import styles from "./DbsRecordPanel.module.css";

type RecordDetails = {
  certificateNumber: string;
  issueDate: string;
  originalName: string;
  status: "pending" | "verified" | "failed";
  uploadedAt: string | null;
  deletedAt: string | null;
  reviewNote: string | null;
  hasCertificate: boolean;
};

function when(value: string) {
  return new Date(value).toLocaleString("en-GB", { timeZone: "Europe/London" });
}

/** Evidence stays closed until a person asks to see it. No effects, timers,
 * prefetch or router refresh reads it. Open state survives a router refresh. */
export default function DbsRecordPanel({
  id,
  canView,
}: {
  id: string;
  canView: boolean;
}) {
  const [opened, setOpened] = useState(false);
  const [record, setRecord] = useState<RecordDetails | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);

  async function open() {
    if (!canView || inFlight.current || opened) return;
    inFlight.current = true;
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/dbs/${id}/record`, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || "Could not open DBS record.");
      setRecord(body.record);
      setOpened(true);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not open DBS record.",
      );
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  function close() {
    setOpened(false);
    setRecord(null);
    setError("");
  }

  if (!canView)
    return (
      <p className={styles.notice}>
        DBS evidence is restricted to named onboarding staff. Manage access in
        Settings.
      </p>
    );

  return (
    <div className={styles.panel}>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.button}
          disabled={pending}
          aria-expanded={opened}
          aria-controls={`dbs-${id}`}
          onClick={opened ? close : () => void open()}
        >
          {pending
            ? "Opening…"
            : opened
              ? "Close DBS record"
              : "Open DBS record"}
        </button>
        <small>
          Opening this private record is logged. Background refreshes are not.
        </small>
      </div>
      {error ? (
        <p role="alert" className={styles.notice}>
          {error}
        </p>
      ) : null}
      {opened ? (
        <div id={`dbs-${id}`} className={styles.panel}>
          {record ? (
            <>
              <strong className={styles.outcome}>
                DBS status: {record.status}
              </strong>
              <dl className={styles.fields}>
                <div>
                  <dt>Certificate number</dt>
                  <dd>{record.certificateNumber}</dd>
                </div>
                <div>
                  <dt>Issue date</dt>
                  <dd>{record.issueDate}</dd>
                </div>
                <div>
                  <dt>File</dt>
                  <dd>
                    {record.deletedAt
                      ? "Deleted after verification"
                      : record.originalName}
                  </dd>
                </div>
                <div>
                  <dt>Uploaded</dt>
                  <dd>
                    {record.uploadedAt
                      ? when(record.uploadedAt)
                      : "Upload incomplete"}
                  </dd>
                </div>
              </dl>
              {record.reviewNote ? (
                <p className={styles.notice}>
                  <strong>Review note:</strong> {record.reviewNote}
                </p>
              ) : null}
              <div className={styles.actions}>
                {record.hasCertificate ? (
                  <a
                    className={styles.button}
                    href={`/api/admin/dbs/${id}/certificate`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open DBS certificate ↗
                  </a>
                ) : (
                  <p className={styles.notice}>
                    {record.deletedAt
                      ? `Certificate copy deleted after verification on ${when(record.deletedAt)}. The number, issue date and outcome are kept.`
                      : "Certificate upload has not been completed."}
                  </p>
                )}
                {record.uploadedAt ? (
                  <DbsReviewButtons
                    id={id}
                    status={record.status}
                    onReviewed={close}
                  />
                ) : null}
              </div>
            </>
          ) : (
            <p className={styles.notice}>
              No DBS details exist for this professional. Approval remains
              unavailable.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
