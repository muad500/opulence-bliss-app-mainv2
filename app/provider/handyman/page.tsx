import type { Metadata } from "next";
import Link from "next/link";
import { handymanEnabled } from "@/lib/handymanMarketplace";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Join as a property maintenance professional | Opulence Bliss",
  description:
    "Apply to join Opulence Bliss as a self-employed property maintenance professional in London.",
};

export const dynamic = "force-dynamic";

export default function HandymanPartnerPage() {
  const onlineApplications = handymanEnabled();

  return (
    <main className={styles.page}>
      <Link className={styles.back} href="/provider">
        ← All professional jobs
      </Link>
      <section className={styles.card}>
        <p className={styles.eyebrow}>Work with Opulence Bliss</p>
        <h1>Join as a property maintenance professional</h1>
        <p className={styles.lede}>
          Offer repairs, furniture assembly, mounting, painting and decoration
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
            <p>
              Property maintenance applications are currently handled directly
              by our team.
            </p>
            <a
              className={styles.button}
              href="mailto:hello@opulencebliss.com?subject=Property%20maintenance%20professional%20application"
            >
              Contact the team to apply
            </a>
            <p className={styles.contact}>
              Email{" "}
              <a href="mailto:hello@opulencebliss.com">
                hello@opulencebliss.com
              </a>{" "}
              with your tasks, experience, areas and availability.
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
