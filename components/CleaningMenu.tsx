"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronDown } from "lucide-react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { CLEANING_SESSION_ORDER } from "@/lib/cleaningBooking";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import styles from "./CleaningMenu.module.css";

type CleaningPackage = {
  id: string;
  name: string;
  billing_type: string;
};

export default function CleaningMenu() {
  const pathname = usePathname() ?? "";
  const [packages, setPackages] = useState<CleaningPackage[]>([]);
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let active = true;
    void createClient()
      .from("packages")
      .select("id, name, billing_type")
      .eq("active", true)
      .eq("billing_type", "per_visit")
      .then(({ data, error }) => {
        if (!active) return;
        if (error) return;
        setPackages(
          (data ?? []).filter((pkg) =>
            CLEANING_SESSION_ORDER.includes(
              pkg.name as (typeof CLEANING_SESSION_ORDER)[number],
            ),
          ),
        );
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  function supportsHover() {
    return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  }

  function showOnHover() {
    if (!supportsHover()) return;
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  }

  function hideAfterHover() {
    if (!supportsHover()) return;
    closeTimer.current = setTimeout(() => setOpen(false), 180);
  }

  function keepOpen() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }

  const active = pathname.startsWith("/services/cleaning");
  // Only live bookable packages; office work is quoted instead.
  const serviceLinks = [
    ...CLEANING_SESSION_ORDER.flatMap((name) => {
      const pkg = packages.find((candidate) => candidate.name === name);
      return pkg
        ? [{ key: name, label: name, href: `/book?type=clean&service=${encodeURIComponent(pkg.id)}` }]
        : [];
    }),
    { key: "office-cleaning", label: "Office cleaning", href: "/services/cleaning#business-cleaning" },
    { key: "cleaning-contracts", label: "Cleaning contracts", href: "/services/cleaning#business-cleaning" },
  ];

  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <span
        className={styles.triggerWrap}
        onMouseEnter={showOnHover}
        onMouseLeave={hideAfterHover}
      >
        <DropdownMenuTrigger
          asChild
          className={`${styles.trigger} ${active ? styles.active : ""}`}
        >
          <Link
            href="/services/cleaning"
            aria-label="Cleaning services"
            onClick={() => setOpen(false)}
          >
            Cleaning
            <ChevronDown
              size={16}
              className={open ? styles.chevronOpen : styles.chevron}
            />
          </Link>
        </DropdownMenuTrigger>
      </span>

      <DropdownMenuContent
        align="start"
        sideOffset={8}
        collisionPadding={16}
        className={styles.menu}
        onMouseEnter={keepOpen}
        onMouseLeave={hideAfterHover}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <section className={styles.hero} aria-labelledby="cleaning-menu-title">
          <h2 id="cleaning-menu-title">Domestic cleaning near you</h2>
          <div className={styles.heroActions}>
            <DropdownMenuItem asChild className={styles.bookItem}>
              <Link href="/book?type=clean">Book my cleaning</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild className={styles.proItem}>
              <Link href="/provider/join">
                Become an Opulence cleaner <ArrowRight size={20} />
              </Link>
            </DropdownMenuItem>
          </div>
        </section>

        <section className={styles.details} aria-label="Cleaning services">
          <h3>Cleaning services</h3>
          <div className={styles.serviceGrid}>
            {serviceLinks.map((service) => (
              <DropdownMenuItem
                asChild
                key={service.key}
                className={styles.serviceItem}
              >
                <Link href={service.href}>{service.label}</Link>
              </DropdownMenuItem>
            ))}
          </div>

          <DropdownMenuItem asChild className={styles.allItem}>
            <Link href="/services/cleaning">Explore all cleaning services</Link>
          </DropdownMenuItem>
        </section>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
