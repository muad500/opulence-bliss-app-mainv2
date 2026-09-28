import type { Metadata } from "next";
import Link from "next/link";
import {
  Hammer,
  Laptop,
  PackageOpen,
  PawPrint,
  Sofa,
  Sparkles,
  Sprout,
  type LucideIcon,
} from "lucide-react";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Become an Opulence Bliss partner",
  description:
    "Join our London network of self-employed home professionals. Cleaning and handyman services are live now, with more trades opening soon.",
};

type Trade = {
  key: string;
  /** Completes the sentence "Join as a …". */
  role: string;
  blurb: string;
  icon: LucideIcon;
  /** Brand tint used when no photograph is supplied. */
  tint: string;
  href?: string;
  /**
   * Drop a file in /public and put its path here to show a photograph
   * behind the text instead of the tint, e.g. "/trades/cleaner.jpg".
   */
  image?: string;
  /** A live customer service without an online professional application yet. */
  liveService?: boolean;
};

const TRADES: Trade[] = [
  {
    key: "cleaning",
    role: "Cleaner",
    blurb: "Regular, deep and end of tenancy work across London.",
    icon: Sparkles,
    tint: "linear-gradient(145deg, #7b2ff7 0%, #a33ea6 55%, #f5c542 140%)",
    href: "/provider/join",
  },
  {
    key: "maintenance",
    role: "Handyman",
    blurb: "Repairs, assembly, mounting and minor decorating.",
    icon: Hammer,
    tint: "linear-gradient(145deg, #f5c542 0%, #c86fc9 62%, #7b2ff7 120%)",
    href: "/services/handyman",
    liveService: true,
  },
  {
    key: "moving_support",
    role: "Home organiser",
    blurb: "Decluttering, organising and moving-day support.",
    icon: PackageOpen,
    tint: "linear-gradient(145deg, #5b6472, #7a828c)",
  },
  {
    key: "garden",
    role: "Gardener",
    blurb: "Mowing, trimming, weeding and seasonal tidying.",
    icon: Sprout,
    tint: "linear-gradient(145deg, #5b6472, #7a828c)",
  },
  {
    key: "pets",
    role: "Pet carer",
    blurb: "Walking, sitting, feeding and pet taxi runs.",
    icon: PawPrint,
    tint: "linear-gradient(145deg, #5b6472, #7a828c)",
  },
  {
    key: "tech_help",
    role: "Tech helper",
    blurb: "Wi-Fi, smart TVs, printers, cameras and devices.",
    icon: Laptop,
    tint: "linear-gradient(145deg, #5b6472, #7a828c)",
  },
  {
    key: "carpet_upholstery",
    role: "Carpet & upholstery cleaner",
    blurb: "Deep cleaning for carpets, rugs and soft furnishings.",
    icon: Sofa,
    tint: "linear-gradient(145deg, #5b6472, #7a828c)",
  },
];

export default function PartnerPage() {
  return (
    <main className={styles.wrap}>
      <header className={styles.head}>
        <h1>Become an Opulence Bliss partner</h1>
        <p className={styles.lede}>
          Work for yourself across London, choose your own hours and area, and
          let us bring you the customers. No joining fee.
        </p>
        <p className={styles.already}>
          Already a partner? <Link href="/provider/login">Sign in</Link>
        </p>
      </header>

      <ul className={styles.grid}>
        {TRADES.map(({ key, role, blurb, icon: Icon, tint, href, image, liveService }) => {
          const open = Boolean(href);

          const inner = (
            <>
              <span
                className={styles.art}
                style={
                  image
                    ? { backgroundImage: `url(${image})` }
                    : { backgroundImage: tint }
                }
                aria-hidden="true"
              >
                <Icon className={styles.icon} strokeWidth={1.4} />
              </span>
              <span className={styles.shade} aria-hidden="true" />
              <span className={styles.body}>
                {!open && <span className={styles.flag}>Coming soon</span>}
                <span className={styles.kicker}>
                  {liveService ? "Service available" : "Join as a"}
                </span>
                <span className={styles.role}>{role}</span>
                <span className={styles.blurb}>{blurb}</span>
              </span>
            </>
          );

          return (
            <li className={styles.cell} key={key}>
              {open ? (
                <Link
                  href={href as string}
                  className={`${styles.panel} ${styles.open}`}
                >
                  {inner}
                </Link>
              ) : (
                <div className={`${styles.panel} ${styles.shut}`}>{inner}</div>
              )}
            </li>
          );
        })}
      </ul>

      <p className={styles.foot}>
        Cleaning applications and Handyman services are live now. Professional
        Handyman onboarding is currently handled directly by our team. The
        remaining trades follow as we launch them, and the order depends partly
        on what customers vote for on our{" "}
        <Link href="/coming-soon">coming soon page</Link>.
      </p>
    </main>
  );
}
