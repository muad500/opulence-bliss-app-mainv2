"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import styles from "./AdminNav.module.css";
const primary = [
  ["/admin", "Overview"],
  ["/admin/bookings", "Bookings"],
  ["/admin/quotes", "Quotes"],
  ["/admin/customers", "Customers"],
  ["/admin/cleaners", "Professionals"],
  ["/admin/reviews/activity", "Reviews"],
];
const tools = [
  ["/admin/review", "Resolution desk"],
  ["/admin/deletion-requests", "Account requests"],
  ["/admin/incidents", "Problems & incidents"],
  ["/admin/reviews", "Website reviews"],
  ["/admin/faqs", "FAQs"],
  ["/admin/chat-flags", "Chat safety"],
  ["/admin/legal", "Legal content"],
  ["/admin/settings", "Settings"],
];
export default function AdminNav({ email }: { email: string }) {
  const path = usePathname();
  const active = (href: string) =>
    href === "/admin" || href === "/admin/reviews"
      ? path === href
      : path === href || path.startsWith(href + "/");
  return (
    <nav className={styles.nav} aria-label="Admin navigation">
      <div className={styles.brand}>
        <Link href="/admin">
          Opulence Bliss <span>Admin</span>
        </Link>
        <small title={email}>{email}</small>
      </div>
      <div className={styles.links}>
        {primary.map(([href, label]) => (
          <Link
            key={href}
            href={href}
            aria-current={active(href) ? "page" : undefined}
          >
            {label}
          </Link>
        ))}
      </div>
      <details className={styles.more}>
        <summary
          className={
            tools.some(([href]) => active(href)) ? styles.active : undefined
          }
        >
          More tools <span aria-hidden="true">⌄</span>
        </summary>
        <div className={styles.menu}>
          {tools.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              aria-current={active(href) ? "page" : undefined}
              onClick={(event) => {
                event.currentTarget.closest("details")?.removeAttribute("open");
              }}
            >
              {label}
            </Link>
          ))}
        </div>
      </details>
      <button
        className={styles.signout}
        type="button"
        onClick={async () => {
          await createClient().auth.signOut();
          window.location.href = "/staff/login";
        }}
      >
        Sign out
      </button>
    </nav>
  );
}
