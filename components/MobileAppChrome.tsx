"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowLeft,
  House,
  CalendarDays,
  BriefcaseBusiness,
  MessageSquare,
  UserRound,
  CircleHelp,
  LogOut,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { appEntry, appTabs, type AppAudience } from "@/lib/mobileExperience";
import styles from "./MobileExperience.module.css";
const icons = {
  home: House,
  calendar: CalendarDays,
  briefcase: BriefcaseBusiness,
  message: MessageSquare,
  user: UserRound,
};
export default function MobileAppChrome({
  audience,
}: {
  audience: AppAudience;
}) {
  const path = usePathname() ?? "";
  const router = useRouter();
  const [keyboard, setKeyboard] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const [canWork, setCanWork] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => {
      void fetch("/api/mobile/context", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (alive) {
            setSignedIn(data?.signedIn === true);
            setCanWork(data?.canWork === true);
          }
        })
        .catch(() => {
          if (alive) {
            setSignedIn(false);
            setCanWork(false);
          }
        });
    };
    load();
    window.addEventListener("opulence:portal-updated", load);
    window.addEventListener("focus", load);
    return () => {
      alive = false;
      window.removeEventListener("opulence:portal-updated", load);
      window.removeEventListener("focus", load);
    };
  }, [audience, path]);
  const tabs = appTabs(audience);
  const current =
    (path.startsWith("/account/profile") || path.startsWith("/worker/profile")
      ? tabs.find((t) => t.label === "Account")
      : undefined) ??
    tabs.find(
      (t) =>
        path === t.href ||
        (t.href !== `/mobile/${audience}` && path.startsWith(t.href + "/")),
    ) ??
    (audience === "worker" && path === "/worker" ? tabs[0] : undefined);
  const onTabRoot =
    current &&
    (path === current.href || (audience === "worker" && path === "/worker"));
  const title = path.includes("login")
    ? "Sign in"
    : path.includes("sign-up")
      ? "Create account"
      : path === "/provider/join"
        ? "Apply to join"
        : path.includes("/book") && !path.startsWith("/account")
          ? "Book a clean"
          : path.includes("/availability")
            ? "Availability"
            : path.includes("/earnings")
              ? "Earnings"
              : path.includes("/application")
                ? "Your application"
                : (current?.label ??
                  (audience === "customer" ? "Your visit" : "Your job"));
  useEffect(() => {
    const viewport = window.visualViewport;
    let baselineHeight = viewport?.height ?? window.innerHeight;
    const update = () => {
      const focused = document.activeElement?.matches(
        "input, textarea, select",
      );
      const height = viewport?.height ?? window.innerHeight;
      if (!focused) baselineHeight = height;
      setKeyboard(Boolean(focused && baselineHeight - height > 150));
    };
    viewport?.addEventListener("resize", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      viewport?.removeEventListener("resize", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
    };
  }, []);
  useEffect(() => {
    const home = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor = (event.target as Element)?.closest("a");
      if (!anchor || anchor.target === "_blank") return;
      const url = new URL(anchor.href);
      if (url.origin === location.origin && url.pathname === "/") {
        event.preventDefault();
        router.push(appEntry(audience));
      }
    };
    document.addEventListener("click", home, true);
    return () => document.removeEventListener("click", home, true);
  }, [audience, router]);
  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutError("");
    try {
      const { error } = await createClient().auth.signOut();
      if (error) throw error;
      setSignedIn(false);
      setCanWork(false);
      router.replace(appEntry(audience));
      router.refresh();
      setSigningOut(false);
    } catch {
      setSigningOut(false);
      setSignOutError("We couldn't sign you out. Please try again.");
    }
  }
  return (
    <>
      <header className={styles.header}>
        <div>
          {onTabRoot ? (
            <Link href={appEntry(audience)} className={styles.brand}>
              opulence<span>bliss</span>
              {audience === "worker" && <small>PRO</small>}
            </Link>
          ) : (
            <button
              aria-label="Go back"
              onClick={() => router.back()}
              className={styles.iconButton}
            >
              <ArrowLeft size={21} />
            </button>
          )}
          <strong>{title}</strong>
        </div>
        <Link href="/faq" aria-label="Help" className={styles.iconButton}>
          <CircleHelp size={22} />
        </Link>
      </header>
      {signedIn &&
        (path.endsWith("/profile") ||
          (path.startsWith("/mobile/") && path.endsWith("/account"))) && (
          <div className={styles.tools}>
            {audience === "worker" && canWork && (
              <>
                <Link href="/worker/availability">Availability</Link>
                <Link href="/worker/earnings">Earnings</Link>
                <Link href="/worker/application">Application</Link>
              </>
            )}
            <button onClick={() => void signOut()} disabled={signingOut}>
              <LogOut size={16} />
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
            {signOutError && <p role="alert">{signOutError}</p>}
          </div>
        )}
      <nav
        aria-label={
          audience === "customer" ? "App navigation" : "Work app navigation"
        }
        className={`${styles.tabs} ${keyboard ? styles.keyboard : ""}`}
      >
        {tabs.map((tab) => {
          const Icon = icons[tab.icon as keyof typeof icons];
          const active =
            current?.href === tab.href ||
            (audience === "worker" &&
              tab.label === "Today" &&
              path === "/worker");
          if (audience === "worker" && tab.label === "Jobs" && !canWork)
            return (
              <button
                key={tab.href}
                disabled
                aria-label="Jobs, available after approval"
              >
                <Icon size={22} />
                <span>Jobs</span>
                <small>Locked</small>
              </button>
            );
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
            >
              <Icon size={22} />
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
