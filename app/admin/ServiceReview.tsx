"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  getProviderApprovalRequirements,
  getProfessionalApprovalReviewState,
  reviewProfessionalService,
} from "./actions";
import {
  visibleProfessionalServices,
  type ProfessionalService,
  type ServiceApprovals,
} from "@/lib/professionalServices";

export default function ServiceReview({
  id,
  approvals,
  handymanEnabled,
  revision = "",
}: {
  id: string;
  approvals: ServiceApprovals;
  handymanEnabled: boolean;
  revision?: string;
}) {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {visibleProfessionalServices(Object.keys(approvals), handymanEnabled).map(
        (service) => (
          <ServiceDecision
            key={service === "handyman" ? "Property maintenance" : "Cleaning"}
            id={id}
            service={service as ProfessionalService}
            status={approvals[service as ProfessionalService]!}
            revision={revision}
          />
        ),
      )}
    </div>
  );
}

function ServiceDecision({
  id,
  service,
  status,
  revision,
}: {
  id: string;
  service: ProfessionalService;
  status: string;
  revision: string;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [missing, setMissing] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [review, setReview] = useState<Awaited<
    ReturnType<typeof getProfessionalApprovalReviewState>
  > | null>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (status !== "pending") return;
    let active = true;
    void Promise.all([
      getProviderApprovalRequirements(id, service),
      getProfessionalApprovalReviewState(id, service),
    ]).then(
      ([items, state]) => {
        if (active) {
          setMissing(items);
          setReview(state);
        }
      },
      () => {
        if (active) setError("Approval requirements could not be loaded.");
      },
    );
    return () => {
      active = false;
    };
  }, [id, service, status, revision, refresh]);

  function decide(next: "approved" | "rejected" | "suspended" | "pending") {
    setError("");
    start(async () => {
      try {
        await reviewProfessionalService(id, service, next, reason);
        setReason("");
        setReview(null);
        setRefresh((value) => value + 1);
        router.refresh();
      } catch (failure) {
        setError(
          failure instanceof Error
            ? failure.message
            : "The decision could not be saved.",
        );
      }
    });
  }
  const style = {
    border: "1px solid var(--ob-border, #ded8e8)",
    borderRadius: 12,
    padding: 12,
  };
  const button = {
    border: "1px solid #ddd4ea",
    borderRadius: 8,
    padding: "7px 12px",
    background: "white",
    fontWeight: 700,
    cursor: "pointer",
  };
  return (
    <section style={style} aria-label={`${service} approval`}>
      <strong style={{ textTransform: "capitalize" }}>
        {service}: {status}
      </strong>
      {status === "pending" && (
        <p style={{ fontSize: 12 }}>
          {missing === null
            ? "Checking requirements…"
            : missing.length
              ? `Verify ${missing.join(", ")}.`
              : "All approval requirements are complete."}
        </p>
      )}
      {status === "pending" && review && (
        <p role="status" style={{ fontSize: 13 }}>
          {review.message}
        </p>
      )}
      {(status === "pending" || status === "approved") && (
        <label
          style={{ display: "grid", gap: 5, margin: "8px 0", fontSize: 12 }}
        >
          Decision reason
          <input
            aria-label={`${service} decision reason`}
            value={reason}
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
            style={{ width: "100%", boxSizing: "border-box", padding: 8 }}
          />
        </label>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
        {status === "pending" && (
          <>
            <button
              style={button}
              disabled={
                busy ||
                missing === null ||
                missing.length > 0 ||
                !review?.canReview ||
                reason.trim().length < 10
              }
              onClick={() => decide("approved")}
            >
              {review?.phase === "second"
                ? "Second sign-off and activate"
                : "Record first review"}
            </button>
            <button
              style={button}
              disabled={busy || !reason.trim()}
              onClick={() => decide("rejected")}
            >
              Reject
            </button>
          </>
        )}
        {status === "approved" && (
          <button
            style={button}
            disabled={busy || !reason.trim()}
            onClick={() => decide("suspended")}
          >
            Suspend service
          </button>
        )}
        {(status === "suspended" || status === "rejected") && (
          <button
            style={button}
            disabled={busy}
            onClick={() => decide("pending")}
          >
            Reopen for review
          </button>
        )}
      </div>
      {error && (
        <p role="alert" style={{ color: "#a52e47", fontSize: 12 }}>
          {error}
        </p>
      )}
    </section>
  );
}
