import type { Metadata } from "next";
import Link from "next/link";
import { Sparkles, UsersRound } from "lucide-react";
import SiteFooter from "@/components/SiteFooter";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "Earn with us | Opulence Bliss" };

export default function EarnWithUs() {
  return (
    <>
      <main className={styles.page}>
        <p className={styles.eyebrow}>Opulence Bliss</p>
        <h1>Earn with us</h1>
        <div className={styles.choices}>
          <section>
            <Sparkles aria-hidden="true" size={34} />
            <h2>Work with us as a cleaner</h2>
            <p>Apply to join our professional cleaning team.</p>
            <Link href="/provider/join" data-earn-with-us>
              Work with us as a cleaner <span aria-hidden="true">→</span>
            </Link>
          </section>
          <section>
            <UsersRound aria-hidden="true" size={34} />
            <h2>Become a Partner</h2>
            <p>Recommend Opulence Bliss to households and businesses.</p>
            <Link href="/partners" data-earn-with-us>
              Become a Partner <span aria-hidden="true">→</span>
            </Link>
          </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
