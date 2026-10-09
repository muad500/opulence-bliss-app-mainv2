import Link from "next/link";
import { professionalPortal } from "@/lib/professionalPortal";
import { handymanEnabled } from "@/lib/handymanMarketplace";
import styles from "./jobs/jobs.module.css";

export default async function WorkerToday() {
  const { client, admin, provider } = await professionalPortal();
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [cleaningResult, handymanResult] = await Promise.all([
    client
      .from("bookings")
      .select("id,scheduled_at,status,address,packages(name)")
      .eq("provider_id", provider.id)
      .in("status", ["scheduled", "in_progress", "needs_review"])
      .order("scheduled_at"),
    handymanEnabled()
      ? admin
          .from("handyman_jobs")
          .select("id,task_name,scheduled_at,status,address")
          .eq("provider_id", provider.id)
          .in("status", [
            "scheduled",
            "in_progress",
            "awaiting_customer",
            "awaiting_authorization",
            "payment_pending",
          ])
          .order("scheduled_at")
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (cleaningResult.error || handymanResult.error)
    throw new Error("Your calendar could not be loaded.");
  const calendar = [
    ...(cleaningResult.data ?? []).map((job) => ({
      ...job,
      service: "Cleaning",
      title: "Cleaning visit",
      href: "/worker/job/" + job.id,
    })),
    ...(handymanResult.data ?? []).map((job) => ({
      ...job,
      service: "Handyman",
      title: job.task_name,
      href: "/worker/jobs/handyman/" + job.id,
    })),
  ].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  const dayOf = (date: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/London",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(date));
  const current = calendar.filter(
    (job) => dayOf(job.scheduled_at) === today || job.status === "in_progress",
  );
  const upcoming = calendar
    .filter(
      (job) => dayOf(job.scheduled_at) > today && job.status !== "in_progress",
    )
    .slice(0, 6);
  function cards(jobs: typeof calendar) {
    return (
      <div className={styles.cards}>
        {jobs.map((job) => (
          <Link key={job.id} href={job.href} className={styles.card}>
            <span className={styles.badge}>
              {job.service} · {job.status.replaceAll("_", " ")}
            </span>
            <h2>{job.title}</h2>
            <p>
              {new Date(job.scheduled_at).toLocaleString("en-GB", {
                timeZone: "Europe/London",
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </p>
            <p>{job.address}</p>
          </Link>
        ))}
      </div>
    );
  }
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1>Today</h1>
        <p>
          Your work at a glance, with one calendar across your approved
          services.
        </p>
        <Link href="/worker/jobs">View jobs and offers →</Link>
      </header>
      <section className={styles.section}>
        <h2>Today’s work</h2>
        {current.length ? (
          cards(current)
        ) : (
          <p className={styles.empty}>
            No scheduled jobs today. Check Jobs for new offers.
          </p>
        )}
      </section>
      <section className={styles.section}>
        <h2>Coming up</h2>
        {upcoming.length ? (
          cards(upcoming)
        ) : (
          <p className={styles.empty}>Your next jobs will appear here.</p>
        )}
      </section>
    </main>
  );
}
