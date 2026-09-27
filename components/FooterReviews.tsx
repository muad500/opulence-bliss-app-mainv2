"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import styles from "./SiteFooter.module.css";

/** Overall customer rating across every cleaning review, without private text. */
export default function FooterReviews() {
  const [summary, setSummary] = useState<{ avg: number; count: number } | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await createClient().rpc("public_review_summary", { p_service_type: "cleaning" });
      const row = Array.isArray(data) ? data[0] : data;
      const count = Number(row?.rating_count ?? 0);
      if (count > 0) setSummary({ avg: Number(row.rating_avg), count });
    })();
  }, []);

  if (!summary) return null;
  return (
    <p className={styles.reviews}>
      <span aria-hidden="true">★</span> {summary.avg.toFixed(1)} out of 5 from {summary.count} customer rating
      {summary.count === 1 ? "" : "s"} · <Link href="/reviews">Read all reviews</Link>
    </p>
  );
}
