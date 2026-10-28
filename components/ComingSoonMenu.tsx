"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { ArrowRight, ChevronDown } from "lucide-react";
import { COMING_SOON } from "@/lib/comingSoon";
import ServicePoll from "@/components/ServicePoll";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import styles from "./ComingSoonMenu.module.css";

/**
 * Desktop header dropdown. Opens on hover with a pointer and on click
 * otherwise, matching CleaningMenu. The mobile drawer does not use this: it
 * links to /coming-soon instead, since a nested dropdown inside a drawer is
 * awkward on touch.
 */
export default function ComingSoonMenu({
  storageFree = false,
}: {
  storageFree?: boolean;
} = {}) {
  const pathname = usePathname() ?? "";
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const active = pathname.startsWith("/coming-soon");

  function goToTop() {
    setOpen(false);
    // Next does not re-scroll when the target route is the current one, so
    // clicking from /coming-soon would otherwise leave the page where it was.
    if (pathname.startsWith("/coming-soon")) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

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
            prefetch={storageFree ? false : undefined}
            href="/coming-soon"
            aria-label="Services coming soon"
            onClick={goToTop}
          >
            Coming soon
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
        onKeyDown={(event) => event.stopPropagation()}
      >
        <div className={styles.listWrap}>
          <ul className={styles.list}>
            {COMING_SOON.map((service) => (
              <li key={service.key}>
                <Link
                  prefetch={storageFree ? false : undefined}
                  href="/coming-soon"
                  className={styles.listItem}
                  onClick={goToTop}
                >
                  <span className={styles.listText}>
                    <strong>{service.title}</strong>
                  </span>
                  <ArrowRight size={15} className={styles.listArrow} />
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div className={styles.pollWrap}>
          {!storageFree && <ServicePoll enabled={open} variant="compact" />}
        </div>

        <Link
          prefetch={storageFree ? false : undefined}
          href="/coming-soon"
          className={styles.allLink}
          onClick={goToTop}
        >
          See everything coming soon
          <ArrowRight size={15} />
        </Link>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
