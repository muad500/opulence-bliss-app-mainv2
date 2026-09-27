import Link from "next/link";
import {
  CANCELLATION_REFUND_URL,
  COMPANY,
  HANDYMAN_TERMS_URL,
  PRIVACY_URL,
  PROFESSIONAL_PARTNER_AGREEMENT_URL,
  REVIEW_POLICY_URL,
  TERMS_URL,
} from "@/lib/legal";
import styles from "./SiteFooter.module.css";

const columns: Array<{
  title: string;
  links: Array<[label: string, href: string]>;
}> = [
  {
    title: "Services",
    links: [
      ["Home cleaning", "/services/cleaning"],
      ["Book a service", "/book"],
    ],
  },
  {
    title: "Explore",
    links: [
      ["Meet our professionals", "/providers"],
      ["How it works", "/#how"],
      ["Blog", "/blog"],
      ["Public reviews", "/reviews"],
      ["Frequently asked questions", "/faq"],
    ],
  },
  {
    title: "For professionals",
    links: [
      ["Work with us", "/provider/join"],
      ["Sign in as a pro", "/provider/login"],
      ["Sign in", "/login"],
    ],
  },
];

export default function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.glow} aria-hidden="true" />
      <div className={styles.inner}>
        <section className={styles.lead} aria-labelledby="footer-heading">
          <p className={styles.brand} id="footer-heading">
            opulence<span>bliss</span>
          </p>
          <p className={styles.promise}>
            Trusted home cleaning, thoughtfully delivered across London.
          </p>
          <Link href="/book" className={styles.bookButton}>
            Book your visit <span aria-hidden="true">→</span>
          </Link>
          <p className={styles.coverage}>
            Central, North &amp; West London
          </p>
        </section>

        <nav className={styles.columns} aria-label="Footer navigation">
          {columns.map((column) => (
            <div className={styles.column} key={column.title}>
              <h2>{column.title}</h2>
              {column.links.map(([label, href]) => (
                <Link href={href} key={href}>
                  {label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
      </div>

      <div className={styles.bottom}>
        <div className={styles.company}>
          <p>© {new Date().getFullYear()} {COMPANY.name}. London, United Kingdom.</p>
          <p>
            Registered in {COMPANY.registeredIn}, company number {COMPANY.number}.
            {COMPANY.registeredOffice ? ` Registered office: ${COMPANY.registeredOffice}.` : ""}
          </p>
        </div>
        <div className={styles.legal}>
          {TERMS_URL && (
            <a href={TERMS_URL} target="_blank" rel="noopener noreferrer">
              Terms &amp; Conditions
            </a>
          )}
          {PRIVACY_URL && (
            <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer">
              Privacy Policy
            </a>
          )}
          <a
            href={CANCELLATION_REFUND_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            Cancellation &amp; Refund Policy
          </a>
          <a href={HANDYMAN_TERMS_URL} target="_blank" rel="noopener noreferrer">
            Handyman Terms
          </a>
          <a href={REVIEW_POLICY_URL} target="_blank" rel="noopener noreferrer">
            Review Policy
          </a>
          <a
            href={PROFESSIONAL_PARTNER_AGREEMENT_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            Professional Partner Agreement
          </a>
          <Link href="/faq">Help &amp; FAQ</Link>
        </div>
      </div>
    </footer>
  );
}
