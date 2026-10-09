import Link from "next/link";
import { notFound } from "next/navigation";
import CleaningJobs from "@/components/WorkerCleaningJobs";
import { handymanEnabled } from "@/lib/handymanMarketplace";
import {
  professionalPortal,
  allHandymanEarnings,
} from "@/lib/professionalPortal";
import { professionalJobFilter } from "@/lib/professionalServices";
import styles from "./jobs.module.css";

export default async function ProfessionalJobs({
  searchParams,
}: {
  searchParams: Promise<{ service?: string }>;
}) {
  const { client, admin, provider } = await professionalPortal();
  const enabled = handymanEnabled();
  const filter = professionalJobFilter((await searchParams).service, enabled);
  if (!filter) notFound();
  const jobs =
    enabled && filter !== "cleaning"
      ? await allHandymanEarnings(admin, provider.id)
      : [];
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1>Jobs</h1>
        <p>Your offers, upcoming jobs and completed work share one calendar.</p>
        <nav className={styles.filters} aria-label="Filter jobs by service">
          {["all", "cleaning", ...(enabled ? ["handyman"] : [])].map(
            (service) => (
              <Link
                key={service}
                href={`/worker/jobs?service=${service}`}
                aria-current={filter === service ? "page" : undefined}
              >
                {service.charAt(0).toUpperCase() + service.slice(1)}
              </Link>
            ),
          )}
        </nav>
      </header>
      {filter !== "handyman" &&
        (provider.services.includes("cleaning") ? (
          <CleaningJobs />
        ) : (
          <p className={styles.empty}>
            Add cleaning from your profile to apply for this service.
          </p>
        ))}
      {enabled && filter !== "cleaning" && (
        <section className={styles.section}>
          <h2>Handyman jobs</h2>
          {provider.service_approvals.handyman !== "approved" && (
            <p>
              Handyman approval is{" "}
              {provider.service_approvals.handyman ?? "not requested"}. New
              bookings unlock after approval.{" "}
              <Link href="/worker/profile#services">
                View service application →
              </Link>
            </p>
          )}
          {jobs.length ? (
            <div className={styles.cards}>
              {jobs.map((job) => (
                <Link
                  className={styles.card}
                  key={job.id}
                  href={`/worker/jobs/handyman/${job.id}`}
                >
                  <span className={styles.badge}>
                    {job.status.replaceAll("_", " ")}
                  </span>
                  <h2>{job.task_name}</h2>
                  <p>
                    {new Date(job.scheduled_at).toLocaleString("en-GB", {
                      timeZone: "Europe/London",
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </p>
                  <strong>
                    £{(job.hourly_rate_pence / 100).toFixed(2)}/hr
                  </strong>
                </Link>
              ))}
            </div>
          ) : (
            <p className={styles.empty}>No handyman jobs yet.</p>
          )}
        </section>
      )}
    </main>
  );
}
