"use client";

// Review moderation. Save at: app/admin/ReviewList.tsx

import Link from "next/link";
import { useTransition } from "react";
import { deleteReview } from "./actions";
import type { AdminReview } from "@/lib/adminReviews";

export default function ReviewList({
  reviews,
  compact = false,
}: {
  reviews: AdminReview[];
  compact?: boolean;
}) {
  const [pending, start] = useTransition();

  if (reviews.length === 0) {
    return (
      <p style={{ color: "var(--ob-muted)", padding: "16px 0" }}>
        No reviews yet.
      </p>
    );
  }

  return (
    <>
      {reviews.map((r) => (
        <div
          key={r.id}
          id={`review-${r.id}`}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 14,
            padding: "14px 0",
            borderBottom: "1px solid var(--ob-border)",
            flexWrap: "wrap",
          }}
        >
          {r.reviewerProfileHref ? (
            <Link href={r.reviewerProfileHref} style={reviewLink}>
              <ReviewSummary review={r} compact={compact} />
            </Link>
          ) : (
            <div style={{ flex: 1, minWidth: 200 }}>
              <ReviewSummary review={r} compact={compact} />
            </div>
          )}
          {!compact && r.recipientProfileHref && (
            <Link href={r.recipientProfileHref} style={recipientLink}>
              Reviewed profile →
            </Link>
          )}
          <button
            disabled={pending}
            onClick={() => {
              if (!window.confirm("Delete this review?")) return;
              start(() => deleteReview(r.id));
            }}
            style={{
              background: "transparent",
              color: "var(--ob-danger-text)",
              border: "1.5px solid var(--ob-border-strong)",
              borderRadius: 999,
              padding: compact ? "6px 12px" : "8px 16px",
              fontFamily: "'Hanken Grotesk', system-ui, sans-serif",
              fontSize: 12,
              fontWeight: 600,
              cursor: pending ? "wait" : "pointer",
              opacity: pending ? 0.6 : 1,
            }}
          >
            Delete
          </button>
        </div>
      ))}
    </>
  );
}

function ReviewSummary({
  review: r,
  compact,
}: {
  review: AdminReview;
  compact: boolean;
}) {
  return (
    <div style={{ flex: 1, minWidth: 200 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          flexWrap: "wrap",
        }}
      >
        <span style={categoryBadge}>App · {r.category}</span>
        <span style={{ color: "var(--ob-rating-text)", letterSpacing: 1 }}>
          {"★".repeat(r.rating)}
          {"☆".repeat(5 - r.rating)}
        </span>
        <span
          style={{
            borderRadius: 999,
            padding: "3px 8px",
            background:
              r.visibility === "public"
                ? "var(--ob-mint)"
                : "var(--ob-purple-soft)",
            color:
              r.visibility === "public"
                ? "var(--ob-success-text)"
                : "var(--ob-purple)",
            fontSize: 10.5,
            fontWeight: 800,
          }}
        >
          {r.visibility === "public" ? "Public" : "Private"}
        </span>
      </div>
      <p style={{ margin: "6px 0 0", color: "var(--ob-text)", fontSize: 13.5 }}>
        <strong>{r.reviewerName}</strong> reviewed {r.recipientName}
      </p>
      {r.comment && (
        <p
          style={{
            margin: "4px 0 0",
            color: "var(--ob-muted)",
            overflowWrap: "anywhere",
            fontSize: 13,
            overflow: "hidden",
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: compact ? 1 : undefined,
          }}
        >
          “{r.comment}”
        </p>
      )}
      <span
        style={{
          display: "block",
          marginTop: 4,
          color: "var(--ob-muted)",
          fontSize: 11.5,
        }}
      >
        {new Date(r.created_at).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })}{" "}
        · Booking #{r.bookingReference} · View reviewer profile →
      </span>
    </div>
  );
}

const reviewLink: React.CSSProperties = {
  flex: 1,
  minWidth: 220,
  color: "inherit",
  textDecoration: "none",
  borderRadius: 10,
  padding: "5px 7px",
  margin: "-5px -7px",
};

const recipientLink: React.CSSProperties = {
  color: "var(--ob-purple)",
  fontSize: 11.5,
  fontWeight: 900,
  textDecoration: "none",
  whiteSpace: "nowrap",
};

const categoryBadge: React.CSSProperties = {
  borderRadius: 999,
  padding: "3px 8px",
  background: "var(--ob-butter)",
  color: "var(--ob-warning-text)",
  fontSize: 10.5,
  fontWeight: 900,
};
