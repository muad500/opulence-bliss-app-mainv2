"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import styles from "./SiteFooter.module.css";

/** Overall cleaning rating and link to the reviews page. */
export default function FooterReviews() {
  const [summary, setSummary] = useState<{ avg: number; count: number } | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const summaryResult = await supabase.rpc("public_review_summary", { p_service_type: "cleaning" });
      const row = Array.isArray(summaryResult.data) ? summaryResult.data[0] : summaryResult.data;
      const count = Number(row?.rating_count ?? 0);
      if (count > 0) setSummary({ avg: Number(row.rating_avg), count });
    })();
  }, []);

  if (!summary) return null;
  return (
    <div className={styles.reviewSection}>
      <p className={styles.reviews}>
        <span aria-hidden="true">★</span> {summary.avg.toFixed(1)} out of 5 from {summary.count} customer rating
        {summary.count === 1 ? "" : "s"} · <Link href="/reviews">Read all reviews</Link>
      </p>
    </div>
  );
}
