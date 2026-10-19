"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { handymanTaskLabel } from "@/lib/handymanMarketplace";
import styles from "@/app/handyman/marketplace.module.css";
export default function HandymanQuoteInvitations() {
  const [jobs, setJobs] = useState<
    | {
        id: string;
        task_name: string;
        postcode: string;
        description: string;
        preferred_dates: string[];
      }[]
    | null
  >(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const r = await fetch("/api/handyman/offers", { cache: "no-store" }),
          d = await r.json();
        if (!r.ok) throw new Error(d.error);
        if (active) {
          setJobs(d.jobs);
          setError("");
        }
      } catch (e) {
        if (active)
          setError(
            e instanceof Error ? e.message : "Invitations could not be loaded.",
          );
      }
    }
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  return (
    <section>
      <h3>Requests you can quote</h3>
      {error && <p role="alert">{error}</p>}
      {!jobs && !error && <p role="status">Loading invitations…</p>}
      {jobs?.length === 0 && (
        <p>
          No new quote invitations. Approved categories and coverage in your
          profile control matching.
        </p>
      )}
      {jobs?.map((j) => (
        <article className={styles.quoteCard} key={j.id}>
          <h3>
            {handymanTaskLabel(j.task_name)} · {j.postcode}
          </h3>
          <p>{j.description}</p>
          <p className={styles.muted}>
            Preferred dates: {j.preferred_dates.join(", ")}
          </p>
          <Link className={styles.secondary} href={`/handyman/jobs/${j.id}`}>
            View job & send a fixed quote →
          </Link>
        </article>
      ))}
    </section>
  );
}
