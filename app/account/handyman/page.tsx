import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { privatePortalClient } from "@/lib/professionalPortal";
import { createClient } from "@/lib/supabase/server";
import { handymanEnabled } from "@/lib/handymanMarketplace";
import styles from "@/app/worker/jobs/jobs.module.css";

export default async function CustomerHandymanBookings() {
  if (!handymanEnabled()) notFound();
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) redirect("/login?next=/account/handyman");
  const { data: jobs, error } = await privatePortalClient()
    .from("handyman_jobs")
    .select("id,task_name,status,scheduled_at")
    .eq("customer_id", user.id)
    .order("scheduled_at", { ascending: false });
  if (error) throw new Error("Your bookings could not be loaded.");
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1>Handyman bookings</h1>
        <Link href="/handyman">Book a handyman →</Link>
      </header>
      <div className={styles.cards}>
        {jobs?.map((job) => (
          <Link
            className={styles.card}
            key={job.id}
            href={`/account/handyman/${job.id}`}
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
          </Link>
        ))}
      </div>
      {!jobs?.length && (
        <p className={styles.empty}>No handyman bookings yet.</p>
      )}
    </main>
  );
}
