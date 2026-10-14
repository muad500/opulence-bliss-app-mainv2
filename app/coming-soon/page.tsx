import type { Metadata } from "next";
import Link from "next/link";
import {
  Laptop,
  PackageOpen,
  PawPrint,
  Sofa,
  Sprout,
  type LucideIcon,
} from "lucide-react";
import { COMING_SOON } from "@/lib/comingSoon";
import ServicePoll from "@/components/ServicePoll";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Coming soon | Opulence Bliss",
  description:
    "The services we are building next, from moving support to garden, pet and technology help. Tell us which one you want first.",
};

const SERVICE_ICONS: Record<string, LucideIcon> = {
  moving_support: PackageOpen,
  garden: Sprout,
  pets: PawPrint,
  tech_help: Laptop,
  carpet_upholstery: Sofa,
};

export default function ComingSoonPage() {
  return (
    <main className={styles.wrap}>
      <header className={styles.head}>
        <p className={styles.eyebrow}>Coming soon</p>
        <h1>More than cleaning, soon</h1>
        <p className={styles.lede}>
          Cleaning and property maintenance services are live today. These are
          the services we are building next. Nothing here is bookable yet, so
          tell us which one you want first and we will start with that.
        </p>
        <div className={styles.liveLinks}>
          <Link href="/services/cleaning" className={styles.liveLink}>
            Book cleaning →
          </Link>
          <Link href="/services/handyman" className={styles.liveLink}>
            Request a property maintenance quote →
          </Link>
        </div>
      </header>

      <section className={styles.services} aria-labelledby="upcoming-services">
        <h2 id="upcoming-services">Our upcoming services</h2>
        <div className={styles.grid}>
          {COMING_SOON.map((service) => {
            const Icon = SERVICE_ICONS[service.key] ?? PackageOpen;
            return (
              <article
                key={service.key}
                id={service.slug}
                className={styles.card}
              >
                <div className={styles.cardTop}>
                  <span className={styles.icon} aria-hidden="true">
                    <Icon size={25} strokeWidth={1.8} />
                  </span>
                  <span className={styles.cardCopy}>
                    <strong>{service.title}</strong>
                    <span>{service.detail}</span>
                  </span>
                </div>

                {service.items.length > 0 && (
                  <ul className={styles.items}>
                    {service.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <section className={styles.pollSection} aria-label="Service poll">
        <ServicePoll variant="page" />
      </section>
    </main>
  );
}
