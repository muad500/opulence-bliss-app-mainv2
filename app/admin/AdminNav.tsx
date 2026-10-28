"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
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
  ["/admin/data-retention", "Data retention"],
  ["/admin/incidents", "Problems & incidents"],
  ["/admin/worker-operations", "Professional operations"],
  ["/admin/partner-interest", "Partner interest"],
  ["/admin/reviews", "Website reviews"],
  ["/admin/faqs", "FAQs"],
  ["/admin/chat-flags", "Chat safety"],
  ["/admin/legal", "Legal content"],
  ["/admin/settings", "Settings"],
];
export default function AdminNav({ email }: { email: string }) {
  const path = usePathname();
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    menu.current?.removeAttribute("open");
  }, [path]);
  async function signOut() {
    await createClient().auth.signOut();
    window.location.href = "/staff/login";
  }
  const active = (href: string) =>
    href === "/admin" || href === "/admin/reviews"
      ? path === href
      : path === href || path.startsWith(href + "/");
  return (
    <nav className={styles.nav} aria-label="Admin navigation">
      <div className={styles.brand}>
        <Link href="/admin">Admin page</Link>
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
      <details
        className={styles.more}
        ref={menu}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            menu.current?.removeAttribute("open");
            menu.current?.querySelector("summary")?.focus();
          }
        }}
      >
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
          <button
            type="button"
            className={styles.mobileSignout}
            onClick={signOut}
          >
            Sign out
          </button>
        </div>
      </details>
      <button className={styles.signout} type="button" onClick={signOut}>
        Sign out
      </button>
    </nav>
  );
}
