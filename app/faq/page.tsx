import type { Metadata } from "next";
import Link from "next/link";
import SiteFooter from "@/components/SiteFooter";
import { createClient } from "@/lib/supabase/server";
import {
  FAQ_CATEGORIES,
  FAQ_CATEGORY_LABELS,
  type FaqRow,
} from "@/lib/faqs";
import styles from "../marketingPages.module.css";

export const metadata: Metadata = {
  title: "Frequently asked questions | Opulence Bliss",
  description:
    "Answers about cleaning, handyman services, booking, pricing and appointments at Opulence Bliss.",
};

export default async function FaqPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("faqs")
    .select("id, category, question, answer, published, sort_order, created_at")
    .eq("published", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  const faqs = (data ?? []) as FaqRow[];

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroInner}>
          <p className={styles.eyebrow}>Help centre</p>
          <h1>Questions, answered clearly</h1>
          <p className={styles.heroIntro}>
            Cleaning, Handyman, booking and service information in one place.
          </p>
        </div>
      </header>

      <section
        className={`${styles.content} ${styles.faqContent}`}
        aria-label="Frequently asked questions"
      >
        {FAQ_CATEGORIES.map((category) => {
          const items = faqs.filter((faq) => faq.category === category);
          if (items.length === 0) return null;
          return (
            <section className={styles.faqGroup} key={category}>
              <h2>{FAQ_CATEGORY_LABELS[category]}</h2>
              {items.map((faq) => (
                <details className={styles.faqItem} key={faq.id}>
                  <summary>{faq.question}</summary>
                  <div className={styles.faqAnswer}>
                    <p style={{ whiteSpace: "pre-line" }}>{faq.answer}</p>
                  </div>
                </details>
              ))}
            </section>
          );
        })}

        {faqs.length === 0 && (
          <section className={styles.faqGroup}>
            <h2>Help is on the way</h2>
            <p>Our frequently asked questions are being updated.</p>
          </section>
        )}

        <section className={styles.cta}>
          <div>
            <h2>Need help with your home?</h2>
            <p>Contact us today for a cleaning or handyman quote. Send your postcode, the service you need, your preferred date and any useful photos or details. We&apos;ll get back to you with availability and pricing.</p>
          </div>
          <div className={styles.ctaActions}>
            <Link className={styles.primaryButton} href="/book">Book cleaning</Link>
            <Link className={styles.secondaryButton} href="/services/handyman">
              Request a Handyman quote
            </Link>
          </div>
        </section>
      </section>
      <SiteFooter />
    </main>
  );
}
