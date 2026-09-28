"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import styles from "./SiteFooter.module.css";

type PublicReview = {
  id: string;
  rating: number;
  comment: string | null;
  recipient_name: string;
  recipient_type: string;
};

/** Overall cleaning rating plus genuine public customer feedback. */
export default function FooterReviews() {
  const [summary, setSummary] = useState<{ avg: number; count: number } | null>(null);
  const [previews, setPreviews] = useState<PublicReview[]>([]);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const [summaryResult, feedResult] = await Promise.all([
        supabase.rpc("public_review_summary", { p_service_type: "cleaning" }),
        supabase.rpc("public_reviews_feed", { p_limit: 100 }),
      ]);
      const row = Array.isArray(summaryResult.data) ? summaryResult.data[0] : summaryResult.data;
      const count = Number(row?.rating_count ?? 0);
      if (count > 0) setSummary({ avg: Number(row.rating_avg), count });
      setPreviews(
        ((feedResult.data ?? []) as PublicReview[])
          .filter((review) => review.recipient_type === "professional" && review.rating >= 4)
          .slice(0, 3),
      );
    })();
  }, []);

  if (!summary && previews.length === 0) return null;
  return (
    <div className={styles.reviewSection}>
      {summary && (
        <p className={styles.reviews}>
          <span aria-hidden="true">★</span> {summary.avg.toFixed(1)} out of 5 from {summary.count} customer rating
          {summary.count === 1 ? "" : "s"} · <Link href="/reviews">Read all reviews</Link>
        </p>
      )}
      {previews.length > 0 && (
        <div className={styles.reviewPreviews} aria-label="Recent customer reviews">
          {previews.map((review) => (
            <blockquote className={styles.reviewPreview} key={review.id}>
              <span aria-label={`${review.rating} out of 5 stars`}>
                {"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}
              </span>
              {review.comment?.trim() ? <p>{review.comment.trim()}</p> : <p>Rating shared without a written comment.</p>}
              <footer>About {review.recipient_name}</footer>
            </blockquote>
          ))}
        </div>
      )}
    </div>
  );
}
