import type { Metadata } from "next";
import Link from "next/link";
import { handymanEnabled } from "@/lib/handymanMarketplace";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Join as a handyman | Opulence Bliss",
  description: "Apply to join Opulence Bliss as a self-employed handyman in London.",
};

export const dynamic = "force-dynamic";

export default function HandymanPartnerPage() {
  const onlineApplications = handymanEnabled();

  return (
    <main className={styles.page}>
      <Link className={styles.back} href="/provider">← All professional jobs</Link>
      <section className={styles.card}>
        <p className={styles.eyebrow}>Work with Opulence Bliss</p>
        <h1>Join as a handyman</h1>
        <p className={styles.lede}>
          Offer repairs, furniture assembly, mounting and minor decorating
          across London as a self-employed professional.
        </p>
        <h2>Tell us about your work</h2>
        <ul>
          <li>The tasks you offer and your experience</li>
          <li>The London areas you cover</li>
          <li>Your working hours and availability</li>
        </ul>
        <p>
          Our team reviews your application and explains the identity,
          right-to-work, DBS and public liability insurance checks before you
          can take jobs.
        </p>
        {onlineApplications ? (
          <Link className={styles.button} href="/handyman/apply">
            Start your professional application
          </Link>
        ) : (
          <>
            <p>Handyman applications are currently handled directly by our team.</p>
            <a className={styles.button} href="mailto:opulencebliss@gmail.com?subject=Handyman%20professional%20application">
              Contact the team to apply
            </a>
            <p className={styles.contact}>
              Email <a href="mailto:opulencebliss@gmail.com">opulencebliss@gmail.com</a> with
              your tasks, experience, areas and availability.
            </p>
          </>
        )}
        <p className={styles.signIn}>
          Already a professional? <Link href="/provider/login">Sign in</Link>
        </p>
      </section>
    </main>
  );
}
