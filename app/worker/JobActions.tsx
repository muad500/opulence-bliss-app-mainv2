"use client";

// Job actions — changes with the job's stage.
// Save at: app/worker/JobActions.tsx

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  acceptJob,
  declineJob,
  checkInJob,
  verifyCheckInOtp,
  checkOutJob,
  rateClient,
} from "./actions";
import JobExceptions from "./JobExceptions";
import ReviewVisibilityChoice from "@/components/ReviewVisibilityChoice";
import type { ReviewVisibility } from "@/lib/reviewVisibility";
import { requestPortalRefresh } from "@/lib/portalUpdates";

const UPDATE_ERROR =
  "Could not confirm the update. Refresh the job status before trying again.";

const green: React.CSSProperties = {
  background: "#16202A",
  color: "#FFFFFF",
  border: "none",
  borderRadius: 999,
  padding: "10px 22px",
  fontWeight: 600,
  fontSize: 14,
  cursor: "pointer",
};

const ghost: React.CSSProperties = {
  background: "transparent",
  color: "#B0384F",
  border: "1.5px solid #F3CBD4",
  borderRadius: 999,
  padding: "10px 22px",
  fontWeight: 600,
  fontSize: 14,
  cursor: "pointer",
};

const apricot: React.CSSProperties = {
  ...green,
  background: "#6D28D9",
  color: "#fff",
};

export default function JobActions({
  id,
  status,
  scheduledAt,
  existingRating,
  hasSubmittedRating = false,
  showExceptions = true,
  compact = false,
  preferredScheduledAt,
  optionalScheduledAt = [],
}: {
  id: string;
  status: string;
  scheduledAt: string;
  existingRating?: { rating: number; comment: string | null } | null;
  hasSubmittedRating?: boolean;
  showExceptions?: boolean;
  compact?: boolean;
  preferredScheduledAt?: string | null;
  optionalScheduledAt?: string[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const actionRunning = useRef(false);
  const [actionLabel, setActionLabel] = useState("");
  const perform = (label: string, action: () => Promise<void>) => {
    if (actionRunning.current) return;
    actionRunning.current = true;
    setActionLabel(label);
    setNote(null);
    start(async () => {
      try {
        await action();
        requestPortalRefresh();
        router.refresh();
      } catch {
        setNote(UPDATE_ERROR);
      } finally {
        actionRunning.current = false;
        setActionLabel("");
      }
    });
  };
  const preferredTime = preferredScheduledAt ?? scheduledAt;
  const availableTimes = [
    preferredTime,
    ...optionalScheduledAt.filter((value) => value !== preferredTime),
  ];
  const [selectedSlot, setSelectedSlot] = useState(preferredTime);
  const dim = (s: React.CSSProperties) => ({
    ...s,
    opacity: pending ? 0.6 : 1,
    cursor: pending ? ("wait" as const) : s.cursor,
  });

  if (status === "offered") {
    return (
      <div style={{ marginTop: compact ? 0 : 16 }}>
        {availableTimes.length > 1 && (
          <fieldset
            style={{
              display: "grid",
              gap: 7,
              margin: "0 0 12px",
              padding: 0,
              border: 0,
              minWidth: 0,
            }}
          >
            <legend
              style={{
                marginBottom: 7,
                color: "#4B3B5B",
                fontSize: 12,
                fontWeight: 900,
              }}
            >
              Choose the time you can accept
            </legend>
            {availableTimes.map((time, index) => (
              <label
                key={time}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 10px",
                  border: `1px solid ${selectedSlot === time ? "#6D28D9" : "#E3D9EC"}`,
                  borderRadius: 10,
                  background: selectedSlot === time ? "#F5EFFF" : "#FFFFFF",
                  color: "#24172F",
                  fontSize: 12.5,
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                <input
                  type="radio"
                  name={`booking-time-${id}`}
                  value={time}
                  checked={selectedSlot === time}
                  onChange={() => setSelectedSlot(time)}
                />
                <span>
                  {new Date(time).toLocaleString("en-GB", {
                    timeZone: "Europe/London",
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: true,
                  })}
                  {index === 0 ? " · Preferred" : " · Optional"}
                </span>
              </label>
            ))}
          </fieldset>
        )}
        <div
          style={{
            display: "flex",
            justifyContent: compact ? "flex-end" : undefined,
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <button
            onClick={() =>
              perform("Declining…", async () => {
                await declineJob(id);
              })
            }
            disabled={pending}
            style={dim(ghost)}
          >
            {pending && actionLabel === "Declining…" ? actionLabel : "Decline"}
          </button>
          <button
            onClick={() =>
              perform("Accepting…", async () => {
                const r = await acceptJob(id, selectedSlot);
                if (r?.taken) {
                  setNote("Someone else took this job first.");
                } else if (r?.error) {
                  setNote(r.error);
                }
              })
            }
            disabled={pending}
            style={dim(compact ? apricot : green)}
          >
            {pending && actionLabel === "Accepting…"
              ? actionLabel
              : compact
                ? "Accept booking"
                : "Accept"}
          </button>
        </div>
        {note && (
          <p
            style={{
              margin: "10px 0 0",
              padding: "10px 12px",
              borderRadius: 10,
              fontSize: 13.5,
              background: "#FFE6EA",
              color: "#B0384F",
            }}
          >
            {note}
          </p>
        )}
      </div>
    );
  }

  if (status === "scheduled") {
    return (
      <div style={{ marginTop: compact ? 0 : 16 }}>
        <CheckInControl id={id} compact={compact} />
        {showExceptions && (
          <JobExceptions
            bookingId={id}
            status={status}
            scheduledAt={scheduledAt}
          />
        )}
      </div>
    );
  }

  if (status === "in_progress") {
    return (
      <div style={{ marginTop: compact ? 0 : 16 }}>
        <button
          onClick={() =>
            perform("Finishing…", async () => {
              await checkOutJob(id);
              setNote(
                "Visit updated. Check the latest payment and payout status on this job.",
              );
              router.replace(`/worker/job/${id}`);
              router.refresh();
            })
          }
          disabled={pending}
          style={dim(apricot)}
        >
          {pending ? "Finishing…" : "Finish & check out"}
        </button>
        {!compact && (
          <p style={{ color: "#7A828C", fontSize: 13, margin: "10px 0 0" }}>
            Checking out completes the job and charges the customer — your share
            is released automatically.
          </p>
        )}
        {note && (
          <p
            style={{
              margin: "10px 0 0",
              padding: "10px 12px",
              borderRadius: 10,
              fontSize: 13.5,
              background: "#F4ECFE",
              color: "#16202A",
            }}
          >
            {note}
          </p>
        )}
        {showExceptions && (
          <JobExceptions
            bookingId={id}
            status={status}
            scheduledAt={scheduledAt}
          />
        )}
      </div>
    );
  }

  if (status === "completed") {
    return (
      <div style={{ marginTop: compact ? 0 : 14 }}>
        <p
          style={{
            margin: "0 0 10px",
            color: "#16202A",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          ✓ Completed — payment taken and your share sent.
        </p>
        <RateClientBox
          id={id}
          existing={existingRating ?? null}
          submittedPrivately={hasSubmittedRating && !existingRating}
        />
      </div>
    );
  }

  return null;
}

export function CheckInControl({
  id,
  compact = false,
  animated = false,
  label = "I've arrived — check in",
  panelTargetId,
}: {
  id: string;
  compact?: boolean;
  animated?: boolean;
  label?: string;
  panelTargetId?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [locating, setLocating] = useState(false);
  const running = useRef(false);
  const busy = pending || locating;
  const [note, setNote] = useState<string | null>(null);
  const [otpStep, setOtpStep] = useState(false);
  const [otp, setOtp] = useState("");
  const [panelTarget, setPanelTarget] = useState<HTMLElement | null>(null);
  const [blocked, setBlocked] = useState<{
    lat: number | null;
    lng: number | null;
  } | null>(null);

  useEffect(() => {
    setPanelTarget(
      panelTargetId ? document.getElementById(panelTargetId) : null,
    );
  }, [panelTargetId]);

  const run = (lat?: number | null, lng?: number | null, force = false) => {
    setLocating(false);
    start(async () => {
      try {
        const result = await checkInJob(id, lat, lng, force);
        setNote(result?.reason ?? null);
        setOtpStep(
          Boolean(result && "otpRequired" in result && result.otpRequired),
        );
        setBlocked(
          result?.blocked && "canForce" in result && result.canForce
            ? { lat: lat ?? null, lng: lng ?? null }
            : null,
        );
        requestPortalRefresh();
        router.refresh();
      } catch {
        setNote(UPDATE_ERROR);
      } finally {
        running.current = false;
      }
    });
  };

  const locate = (force = false) => {
    if (running.current) return;
    running.current = true;
    setLocating(true);
    setNote(null);
    if (!navigator.geolocation) {
      run(null, null, force);
      return;
    }
    try {
      navigator.geolocation.getCurrentPosition(
        (position) =>
          run(position.coords.latitude, position.coords.longitude, force),
        () => run(null, null, force),
        { enableHighAccuracy: true, timeout: 8000 },
      );
    } catch {
      run(null, null, force);
    }
  };

  const good =
    note?.startsWith("Location confirmed") ||
    note?.startsWith("Development location bypass") ||
    note?.startsWith("Code confirmed");

  const showFeedback = otpStep || Boolean(note) || Boolean(blocked) || !compact;
  const feedback = showFeedback ? (
    <div className="worker-checkin-feedback">
      {otpStep && (
        <div
          style={{
            marginTop: compact ? 0 : 10,
            padding: compact ? "10px 12px" : "14px",
            border: "1.5px solid var(--ob-border)",
            borderRadius: 14,
            background: "var(--ob-surface)",
          }}
        >
          <strong
            style={{
              display: "block",
              color: "var(--ob-text)",
              fontSize: 14,
              marginBottom: 7,
            }}
          >
            Enter the client&apos;s 6-digit code
          </strong>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              aria-label="Client check-in code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={otp}
              onChange={(event) =>
                setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))
              }
              placeholder="000000"
              style={{
                flex: "1 1 120px",
                minWidth: 0,
                border: "1.5px solid var(--ob-border)",
                borderRadius: 10,
                padding: "10px 12px",
                background: "var(--ob-surface)",
                color: "var(--ob-text)",
                font: "inherit",
                fontSize: 18,
                fontWeight: 900,
                letterSpacing: "0.18em",
                textAlign: "center",
              }}
            />
            <button
              type="button"
              className="worker-checkin-button"
              disabled={busy || otp.length !== 6}
              onClick={() => {
                if (running.current) return;
                running.current = true;
                start(async () => {
                  try {
                    const result = await verifyCheckInOtp(id, otp);
                    setNote(result.reason);
                    if (result.ok) {
                      setOtpStep(false);
                      requestPortalRefresh();
                      router.refresh();
                    }
                  } catch {
                    setNote(UPDATE_ERROR);
                  } finally {
                    running.current = false;
                  }
                });
              }}
            >
              {busy ? "Confirming code…" : "Confirm code"}
            </button>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setOtpStep(false);
              setOtp("");
              setNote(null);
            }}
            style={{
              marginTop: 8,
              padding: 0,
              border: 0,
              background: "none",
              color: "var(--ob-muted)",
              font: "inherit",
              fontSize: 12.5,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Check location again
          </button>
        </div>
      )}
      {!compact && (
        <p
          style={{ color: "var(--ob-muted)", fontSize: 13, margin: "10px 0 0" }}
        >
          You need to be at the customer&apos;s address to check in.
        </p>
      )}
      {note && (
        <p
          style={{
            margin: "8px 0 0",
            padding: "9px 11px",
            borderRadius: 9,
            fontSize: 12.5,
            background: good ? "var(--ob-purple-soft)" : "var(--ob-blush)",
            color: good ? "var(--ob-text)" : "var(--ob-danger-text)",
          }}
        >
          {note}
        </p>
      )}
      {blocked && (
        <button
          type="button"
          onClick={() => {
            if (running.current) return;
            running.current = true;
            run(blocked.lat, blocked.lng, true);
          }}
          disabled={busy}
          style={{
            ...ghost,
            marginTop: 8,
            fontSize: 12,
            padding: "7px 13px",
          }}
        >
          Continue anyway — development only
        </button>
      )}
    </div>
  ) : null;

  return (
    <div className="worker-checkin-control">
      {!otpStep && (
        <button
          type="button"
          className={
            animated
              ? "worker-checkin-button animated"
              : "worker-checkin-button"
          }
          onClick={() => locate()}
          disabled={busy}
          aria-busy={busy}
        >
          {locating
            ? "Finding your location…"
            : pending
              ? "Checking in…"
              : label}
        </button>
      )}
      {panelTarget ? createPortal(feedback, panelTarget) : feedback}
    </div>
  );
}

// Provider rates the client.
function RateClientBox({
  id,
  existing,
  submittedPrivately,
}: {
  id: string;
  existing: { rating: number; comment: string | null } | null;
  submittedPrivately: boolean;
}) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [visibility, setVisibility] = useState<ReviewVisibility>("public");
  const [done, setDone] = useState<string | null>(null);

  if (submittedPrivately) {
    return (
      <p style={{ margin: "8px 0 0", color: "#6D28D9", fontSize: 13.5 }}>
        Your private review was sent to this client.
      </p>
    );
  }

  if (existing) {
    return (
      <div style={{ marginTop: 8 }}>
        <strong style={{ color: "#6D28D9", fontSize: 16 }}>
          {"★".repeat(existing.rating)}
          <span style={{ color: "#DDD6E8" }}>
            {"★".repeat(5 - existing.rating)}
          </span>
        </strong>
        <p style={{ margin: "3px 0 0", color: "#7A828C", fontSize: 13.5 }}>
          {existing.comment
            ? `“${existing.comment}”`
            : "Your rating was submitted."}
        </p>
      </div>
    );
  }

  if (done) {
    return (
      <p style={{ margin: 0, fontSize: 13.5, color: "#7A828C" }}>{done}</p>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          font: "inherit",
          fontSize: 13.5,
          color: "#6D28D9",
          textDecoration: "underline",
          cursor: "pointer",
        }}
      >
        Rate this client
      </button>
    );
  }

  return (
    <div>
      <p style={{ margin: "0 0 8px", fontSize: 13.5, color: "#7A828C" }}>
        How was this client? Choose whether everyone or only the client can see
        your review.
      </p>
      <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            onClick={() => {
              setStars(n);
              setVisibility("public");
            }}
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 22,
              lineHeight: 1,
              padding: 0,
              color: n <= stars ? "#6D28D9" : "#E5E7EA",
            }}
          >
            ★
          </button>
        ))}
      </div>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={2}
        placeholder="Access, clarity, anything worth noting (optional)"
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: "10px 12px",
          border: "1.5px solid #E5E7EA",
          borderRadius: 10,
          font: "inherit",
          fontSize: 13.5,
          marginBottom: 10,
          resize: "vertical",
        }}
      />
      <ReviewVisibilityChoice
        rating={stars}
        value={visibility}
        onChange={setVisibility}
        idPrefix={`client-review-${id}`}
        reviewer="provider"
      />
      <button
        disabled={pending || stars === 0}
        onClick={() =>
          start(async () => {
            const r = await rateClient(id, stars, comment, visibility);
            setDone(
              r?.error
                ? "You've already rated this client."
                : `Thanks — you rated this client ${stars} stars.`,
            );
          })
        }
        style={{
          background: "#16202A",
          color: "#FFFFFF",
          border: "none",
          borderRadius: 999,
          padding: "9px 20px",
          font: "inherit",
          fontSize: 13.5,
          fontWeight: 600,
          cursor: pending || stars === 0 ? "not-allowed" : "pointer",
          opacity: pending || stars === 0 ? 0.6 : 1,
        }}
      >
        {pending ? "Sending…" : "Submit"}
      </button>
    </div>
  );
}
