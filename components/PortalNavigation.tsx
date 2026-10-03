"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeftRight, Bell, BriefcaseBusiness, CalendarDays, ChevronLeft,
  ChevronRight, CircleHelp, House, LogOut, Menu, Plus,
  UserRound, Wallet, X,
  type LucideIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import styles from "./PortalNavigation.module.css";
import AccountModeSwitch from './AccountModeSwitch';

type NavItem = {
  href: string;
  label: string;
  mobileLabel: string;
  icon: LucideIcon;
  exact?: boolean;
  bottom?: boolean;
  locked?: boolean;
};

type Props = {
  mode: "client" | "professional";
  name: string;
  email?: string;
  rating?: number | null;
  ratingCount?: number;
  registered?: boolean;
  approved?: boolean;
  hasCurrentJob?: boolean;
  hasProfessionalAccount?: boolean;
};

const supabase = createClient();

export default function PortalNavigation({
  mode, name, email, rating, ratingCount = 0, registered = false,
  approved = false, hasCurrentJob = false, hasProfessionalAccount = false,
}: Props) {
  const path = usePathname() ?? "";
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [unread, setUnread] = useState(0);
  const [signingOut, setSigningOut] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);

  const professional = mode === "professional";
  const items: NavItem[] = professional
    ? [
        ...(hasCurrentJob ? [{ href: "/worker/current", label: "Current job", mobileLabel: "Now", icon: BriefcaseBusiness, bottom: true }] : []),
        { href: "/worker", label: "Jobs & offers", mobileLabel: "Jobs", icon: House, exact: true, bottom: true },
        { href: "/worker/availability", label: "Availability", mobileLabel: "Hours", icon: CalendarDays, bottom: true, locked: !registered },
        { href: "/worker/earnings", label: "Earnings & payouts", mobileLabel: "Earnings", icon: Wallet, bottom: !hasCurrentJob, locked: !registered },
        { href: "/worker/profile", label: "My profile", mobileLabel: "Profile", icon: UserRound, bottom: !hasCurrentJob, locked: !registered },
        { href: "/worker/updates", label: "Updates", mobileLabel: "Updates", icon: Bell, locked: !registered },
      ]
    : [
        { href: "/account", label: "My bookings", mobileLabel: "Bookings", icon: CalendarDays, exact: true, bottom: true },
        { href: "/account/profile", label: "My profile", mobileLabel: "Profile", icon: UserRound, bottom: true },
        { href: "/account/updates", label: "Updates", mobileLabel: "Updates", icon: Bell, bottom: true },
      ];

  useEffect(() => {
    try { setCollapsed(localStorage.getItem(`opulence-${mode}-nav`) === "collapsed"); } catch { /* storage may be disabled */ }
  }, [mode]);

  useEffect(() => { setDrawerOpen(false); }, [path]);

  useEffect(() => {
    if (!drawerOpen) return;
    const body = document.body;
    const html = document.documentElement;
    const previousBodyOverflow = body.style.overflow;
    const previousHtmlOverflow = html.style.overflow;
    const previousOverscroll = html.style.overscrollBehavior;
    body.style.overflow = "hidden";
    html.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";
    closeRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setDrawerOpen(false);
        menuRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      body.style.overflow = previousBodyOverflow;
      html.style.overflow = previousHtmlOverflow;
      html.style.overscrollBehavior = previousOverscroll;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [drawerOpen]);

  useEffect(() => {
    let active = true;
    async function countUnread() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !active) return;
      const { count } = await supabase.from("notifications")
        .select("*", { count: "exact", head: true }).eq("user_id", user.id).eq("read", false);
      if (active) setUnread(count ?? 0);
    }
    void countUnread();
    const timer = window.setInterval(countUnread, 30000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const isActive = (item: NavItem) => item.exact ? path === item.href : path.startsWith(item.href);
  const first = (name || email || "O").trim().charAt(0).toUpperCase();
  const switchHref = professional ? "/account" : hasProfessionalAccount ? "/worker" : "/provider/join";
  const switchLabel = professional ? "Client account" : hasProfessionalAccount ? "Professional portal" : "Become a professional";
  const status = professional ? !registered ? "Not registered" : approved ? "Active" : "Awaiting approval" : "Client account";

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  function renderItems(inDrawer = false) {
    return items.map((item) => {
      const Icon = item.icon;
      const className = `${styles.navLink} ${isActive(item) ? styles.active : ""} ${item.locked ? styles.locked : ""}`;
      const contents = <><Icon size={19} strokeWidth={2} aria-hidden="true" /><span className={styles.navLabel}>{item.label}</span>{item.href.endsWith("/updates") && unread > 0 && <span className={styles.badge}>{unread > 99 ? "99+" : unread}</span>}</>;
      return item.locked ? <span className={className} key={item.href} title="Register as a professional to unlock">{contents}</span> :
        <Link key={item.href} href={item.href} className={className} aria-current={isActive(item) ? "page" : undefined} title={!inDrawer && collapsed ? item.label : undefined} onClick={() => setDrawerOpen(false)}>{contents}</Link>;
    });
  }

  function renderFooter() {
    return <div className={styles.footer}>
      {professional || hasProfessionalAccount ? <AccountModeSwitch mode={mode} /> : <Link href={switchHref} className={styles.switchLink} aria-label={switchLabel} onClick={() => setDrawerOpen(false)}><ArrowLeftRight size={18} aria-hidden="true" /><span>{switchLabel}</span></Link>}
      <Link href="/faq" className={styles.quietLink} aria-label="Help and FAQ" onClick={() => setDrawerOpen(false)}><CircleHelp size={18} aria-hidden="true" /><span>Help & FAQ</span></Link>
      <button type="button" className={styles.quietLink} aria-label={signingOut ? "Signing out" : "Sign out"} onClick={() => void signOut()} disabled={signingOut}><LogOut size={18} aria-hidden="true" /><span>{signingOut ? "Signing out…" : "Sign out"}</span></button>
    </div>;
  }

  return <>
    <aside className={`${styles.desktop} ${collapsed ? styles.collapsed : ""}`} aria-label={`${professional ? "Professional" : "Client"} portal navigation`}>
      <div className={styles.brandRow}>
        <Link href="/" className={styles.brand} aria-label="Opulence Bliss home">opulence<span>bliss</span></Link>
        <button type="button" className={styles.collapseButton} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={() => {
          const next = !collapsed;
          setCollapsed(next);
          try { localStorage.setItem(`opulence-${mode}-nav`, next ? "collapsed" : "expanded"); } catch { /* storage may be disabled */ }
        }}>{collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}</button>
      </div>
      <div className={styles.identity}><div className={styles.avatar}>{first}</div><div className={styles.identityText}><strong>{name || "Your account"}</strong><span>{email || (rating ? `${rating.toFixed(1)} ★ · ${ratingCount} reviews` : "Your professional space")}</span></div></div>
      <span className={`${styles.status} ${professional && !approved ? styles.waiting : ""}`}>{status}</span>
      <p className={styles.sectionName}>{professional ? "Professional workspace" : "My account"}</p>
      <nav className={styles.links} aria-label="Portal pages">{renderItems()}</nav>
      {!professional && <Link href="/book" className={styles.action} aria-label="Book a service"><Plus size={18} aria-hidden="true" /><span>Book a service</span></Link>}
      {professional && !registered && <Link href="/provider/join" className={styles.action} aria-label="Join as a professional"><Plus size={18} aria-hidden="true" /><span>Join as a professional</span></Link>}
      {renderFooter()}
    </aside>

    <div className={styles.mobileTop}>
      <Link href="/" className={styles.mobileBrand}>opulence<span>bliss</span></Link>
      <div className={styles.topActions}>
        <span className={styles.mobileContext}>{professional ? "Professional" : "Client"}</span>
        <button ref={menuRef} type="button" className={styles.menuButton} aria-label="Open account menu" aria-expanded={drawerOpen} aria-controls="portal-mobile-drawer" onClick={() => setDrawerOpen(true)}><Menu size={21} /></button>
      </div>
    </div>

    <nav className={styles.mobileTabs} aria-label="Quick portal navigation">
      {items.filter((item) => item.bottom && !item.locked).slice(0, 4).map((item) => {
        const Icon = item.icon;
        return <Link key={item.href} href={item.href} className={`${styles.mobileTab} ${isActive(item) ? styles.mobileActive : ""}`} aria-current={isActive(item) ? "page" : undefined}><Icon size={21} strokeWidth={2} aria-hidden="true" /><span>{item.mobileLabel}</span></Link>;
      })}
      <button type="button" className={`${styles.mobileTab} ${styles.moreTab}`} onClick={() => setDrawerOpen(true)} aria-label="More account pages"><Menu size={21} /><span>More</span></button>
    </nav>

    {drawerOpen && <div className={styles.drawerLayer}>
      <button type="button" className={styles.backdrop} aria-label="Close account menu" onClick={() => setDrawerOpen(false)} />
      <aside id="portal-mobile-drawer" role="dialog" aria-modal="true" aria-label="Account menu" className={styles.drawer}>
        <div className={styles.drawerHead}><div><span className={styles.drawerEyebrow}>{professional ? "Professional workspace" : "Client account"}</span><strong>{name || "Your account"}</strong></div><button ref={closeRef} type="button" className={styles.closeButton} aria-label="Close account menu" onClick={() => { setDrawerOpen(false); menuRef.current?.focus(); }}><X size={21} /></button></div>
        <div className={styles.drawerScroll}>
          <div className={styles.drawerIdentity}><div className={styles.avatar}>{first}</div><div><strong>{name || "Your account"}</strong><span>{email || status}</span></div></div>
          <nav className={styles.links} aria-label="All portal pages">{renderItems(true)}</nav>
          {!professional && <Link href="/book" className={styles.action} onClick={() => setDrawerOpen(false)}><Plus size={18} /><span>Book a service</span></Link>}
          {professional && !registered && <Link href="/provider/join" className={styles.action} onClick={() => setDrawerOpen(false)}><Plus size={18} /><span>Join as a professional</span></Link>}
          {renderFooter()}
        </div>
      </aside>
    </div>}
  </>;
}
