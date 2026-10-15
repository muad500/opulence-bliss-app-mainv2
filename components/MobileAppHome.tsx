"use client";
import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  Hammer,
  ArrowRight,
  CalendarDays,
  ShieldCheck,
  MessageSquare,
} from "lucide-react";
import { appScreen, type AppAudience } from "@/lib/mobileExperience";
import LoadingState from "./LoadingState";
import styles from "./MobileAppHome.module.css";
export default function MobileAppHome({
  audience,
  screen,
  name,
  signedIn,
  nextVisit,
}: {
  audience: AppAudience;
  screen: string | null;
  name: string;
  signedIn: boolean;
  nextVisit: { id: string; scheduledAt: string; status: string } | null;
}) {
  const router = useRouter();
  const destination = appScreen(audience, screen);
  useEffect(() => {
    if (destination) router.replace(destination);
    else if (audience === "worker" && signedIn) router.replace("/worker");
  }, [destination, audience, signedIn, router]);
  if (destination || (audience === "worker" && signedIn))
    return (
      <LoadingState
        title={
          audience === "worker"
            ? "Opening your workday"
            : "Opening your account"
        }
        compact
      />
    );
  if (audience === "worker")
    return (
      <main className={styles.home}>
        <p className={styles.eyebrow}>OPULENCE BLISS PRO</p>
        <h1>
          Your workday,
          <br />
          in one place.
        </h1>
        <p className={styles.intro}>
          Offers, your schedule, messages and earnings. Everything you need
          before and after each job.
        </p>
        <Link className={styles.primary} href="/provider/login">
          Sign in <ArrowRight size={19} />
        </Link>
        <Link className={styles.secondary} href="/provider/join">
          Apply to join
        </Link>
        <div className={styles.features}>
          <div>
            <CalendarDays />
            <strong>One calendar</strong>
            <span>Keep track of every visit</span>
          </div>
          <div>
            <MessageSquare />
            <strong>Job messages</strong>
            <span>Talk to customers securely</span>
          </div>
          <div>
            <ShieldCheck />
            <strong>Checks first</strong>
            <span>Job tools open after approval</span>
          </div>
        </div>
      </main>
    );
  return (
    <main className={styles.home}>
      <p className={styles.eyebrow}>
        {signedIn
          ? `HELLO${name ? `, ${name.toUpperCase()}` : ""}`
          : "WELCOME TO OPULENCE BLISS"}
      </p>
      <h1>
        A little more time
        <br />
        for you.
      </h1>
      <p className={styles.intro}>
        Book a clean. Keep up with your visits. Leave the rest to us.
      </p>
      {nextVisit && (
        <Link href={`/account/visit/${nextVisit.id}`} className={styles.visit}>
          <CalendarDays size={24} />
          <div>
            <small>
              {nextVisit.status === "in_progress"
                ? "Your clean is happening now"
                : "Your next visit"}
            </small>
            <strong>
              {new Date(nextVisit.scheduledAt).toLocaleString("en-GB", {
                timeZone: "Europe/London",
                weekday: "short",
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </strong>
            <span>View details and messages</span>
          </div>
          <ArrowRight size={19} />
        </Link>
      )}
      <Link className={styles.primary} href="/book">
        Book a service <ArrowRight size={19} />
      </Link>
      <h2>How can we help?</h2>
      <div className={styles.services}>
        <Link href="/services/cleaning">
          <Sparkles size={30} />
          <strong>Cleaning</strong>
          <span>One-off or regular visits</span>
          <ArrowRight size={18} />
        </Link>
        <Link href="/services/handyman">
          <Hammer size={30} />
          <strong>Repairs & assembly</strong>
          <span>Request a tailored quote</span>
          <ArrowRight size={18} />
        </Link>
      </div>
      {!signedIn && (
        <div className={styles.account}>
          <strong>Keep everything together</strong>
          <p>Sign in to see your bookings, messages and saved details.</p>
          <Link href="/login">Sign in</Link>
          <Link href="/auth/sign-up">Create account</Link>
        </div>
      )}
      <p className={styles.assurance}>
        <ShieldCheck size={17} />
        Vetted professionals. Secure payments.
      </p>
    </main>
  );
}
