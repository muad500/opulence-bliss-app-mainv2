"use client";

// SETUP: code "components/SiteHeader.tsx"
//
// Inline styles on purpose — nothing in globals.css can override them.

import CleaningMenu from "@/components/CleaningMenu";
import ComingSoonMenu from "@/components/ComingSoonMenu";
import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LogOut, Menu, UserRound, X } from "lucide-react";
import AccountModeSwitch from "./AccountModeSwitch";
import { PORTAL_REFRESH_REQUESTED } from "@/lib/portalUpdates";
import { canUseProfessionalTools } from "@/lib/professionalAccess";

const CORAL = "#6D28D9";
const GRAD = "linear-gradient(100deg,#F5C542,#C86FC9 55%,#7B2FF7)";
const INK = "#16202A";

type NavLink = { href: string; label: string; match: string[] };

// The same links for everyone, signed in or not. Anything role-specific
// lives inside the portal, reached via "My account".
const NAV: NavLink[] = [
  {
    href: "/services/cleaning",
    label: "Cleaning",
    match: ["/services/cleaning"],
  },
  {
    href: "/services/handyman",
    label: "Property maintenance",
    match: ["/services/handyman"],
  },
  { href: "/providers", label: "Our pros", match: ["/providers"] },
  { href: "/provider", label: "Jobs", match: ["/provider"] },
];

export default function SiteHeader({
  storageFree = false,
}: {
  storageFree?: boolean;
} = {}) {
  const path = usePathname() ?? "";
  const [role, setRole] = useState<string | null>(null);
  const [hasProfessionalAccount, setHasProfessionalAccount] = useState(false);
  const [professionalApproved, setProfessionalApproved] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [accountMode, setAccountMode] = useState<"client" | "professional">(
    "client",
  );

  useEffect(() => {
    setMobileOpen(false);
    setProfileOpen(false);
  }, [path]);

  useEffect(() => {
    if (!mobileOpen && !profileOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileOpen(false);
        setProfileOpen(false);
      }
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [mobileOpen, profileOpen]);

  useEffect(() => {
    if (!mobileOpen) return;
    const scrollY = window.scrollY;
    const body = document.body;
    const root = document.documentElement;
    const previous = {
      bodyOverflow: body.style.overflow,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyWidth: body.style.width,
      rootOverflow: root.style.overflow,
      rootOverscroll: root.style.overscrollBehavior,
    };

    root.style.overflow = "hidden";
    root.style.overscrollBehavior = "none";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    document.body.style.overflow = "hidden";

    return () => {
      body.style.overflow = previous.bodyOverflow;
      body.style.position = previous.bodyPosition;
      body.style.top = previous.bodyTop;
      body.style.width = previous.bodyWidth;
      root.style.overflow = previous.rootOverflow;
      root.style.overscrollBehavior = previous.rootOverscroll;
      window.scrollTo(0, scrollY);
    };
  }, [mobileOpen]);

  useEffect(() => {
    if (storageFree) return;
    const supabase = createClient();
    let alive = true;
    let version = 0;
    let authTimer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      const current = ++version;
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!alive || current !== version) return;
      if (!user) {
        setRole(null);
        setHasProfessionalAccount(false);
        setProfessionalApproved(false);
        setUnread(0);
      } else {
        const [{ data: p }, { data: provider }, { data: details }, { count }] =
          await Promise.all([
            supabase
              .from("profiles")
              .select("role")
              .eq("id", user.id)
              .maybeSingle(),
            supabase
              .from("providers")
              .select("id,vetting_status,is_suspended,service_approvals")
              .eq("profile_id", user.id)
              .maybeSingle(),
            supabase
              .from("account_profile_details")
              .select("last_account_mode")
              .eq("user_id", user.id)
              .maybeSingle(),
            supabase
              .from("notifications")
              .select("*", { count: "exact", head: true })
              .eq("user_id", user.id)
              .eq("read", false),
          ]);
        if (!alive || current !== version) return;
        setRole(p?.role ?? "customer");
        setHasProfessionalAccount(!!provider);
        setProfessionalApproved(canUseProfessionalTools(provider));
        setAccountMode(
          canUseProfessionalTools(provider) &&
            details?.last_account_mode === "professional"
            ? "professional"
            : "client",
        );
        setUnread(count ?? 0);
      }
    }
    load();
    // Do not wait on getUser inside Supabase's auth notification lock.
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      clearTimeout(authTimer);
      authTimer = setTimeout(() => {
        if (alive) void load();
      }, 0);
    });
    const refreshVisible = () => {
      if (document.visibilityState === "visible" && navigator.onLine)
        void load();
    };
    const timer = setInterval(refreshVisible, 30000);
    window.addEventListener(PORTAL_REFRESH_REQUESTED, refreshVisible);
    window.addEventListener("opulence-account-mode", load);
    return () => {
      alive = false;
      clearTimeout(authTimer);
      clearInterval(timer);
      sub.subscription.unsubscribe();
      window.removeEventListener("opulence-account-mode", load);
      window.removeEventListener(PORTAL_REFRESH_REQUESTED, refreshVisible);
    };
  }, [storageFree]);

  let active: string | null = null;
  let bestLen = -1;
  for (const l of NAV) {
    for (const m of l.match) {
      if (m && path.startsWith(m) && m.length > bestLen) {
        bestLen = m.length;
        active = l.href;
      }
    }
  }

  const accountHref =
    role === "admin"
      ? "/admin"
      : role
        ? accountMode === "professional"
          ? "/worker"
          : "/account"
        : "/login";

  // The provider and admin portals have their own chrome.
  if (
    path.startsWith("/worker") ||
    path.startsWith("/admin") ||
    path.startsWith("/account")
  )
    return null;

  return (
    <header data-website-header style={wrap}>
      {/* ---------- row 1 ---------- */}
      <div className="site-header-bar" style={bar}>
        <Link
          prefetch={storageFree ? false : undefined}
          href="/"
          className="site-logo"
          style={logo}
        >
          opulence<span style={{ color: CORAL }}>bliss</span>
        </Link>

        <div className="site-header-actions desktop-actions">
          <Link
            prefetch={storageFree ? false : undefined}
            href="/blog"
            style={blogBtn}
          >
            Blog
          </Link>
          {!role && (
            <Link
              prefetch={storageFree ? false : undefined}
              href="/provider"
              style={proBtn}
            >
              Sign in as a pro
            </Link>
          )}
          <Link
            prefetch={storageFree ? false : undefined}
            href={accountHref}
            style={{ ...ghostBtn, position: "relative" }}
          >
            {role ? "My account" : "Sign in"}
            {unread > 0 && (
              <span
                style={{
                  position: "absolute",
                  top: -6,
                  right: -6,
                  minWidth: 20,
                  height: 20,
                  padding: "0 6px",
                  borderRadius: 999,
                  background: GRAD,
                  color: "#fff",
                  fontSize: 11,
                  fontWeight: 900,
                  display: "grid",
                  placeItems: "center",
                  boxShadow: "0 0 0 2px #fff",
                }}
              >
                {unread}
              </span>
            )}
          </Link>
          {role && role !== "admin" && hasProfessionalAccount && (
            <AccountModeSwitch
              mode={accountMode}
              professionalApproved={professionalApproved}
              hasProfessionalAccount={hasProfessionalAccount}
            />
          )}
        </div>

        <div className="mobile-primary">
          <Link
            prefetch={storageFree ? false : undefined}
            href="/#services"
            className="mobile-quick-link"
          >
            Book a service
          </Link>
          <Link
            prefetch={storageFree ? false : undefined}
            href="/provider"
            className="mobile-quick-link"
          >
            Jobs
          </Link>
          <div className="mobile-profile-wrap">
            <button
              type="button"
              className="mobile-profile-button"
              aria-label={
                role ? "Open account menu" : "Open login and sign-up menu"
              }
              aria-expanded={profileOpen}
              aria-controls="mobile-profile-menu"
              onClick={() => {
                setProfileOpen((open) => !open);
                setMobileOpen(false);
              }}
            >
              <UserRound size={20} strokeWidth={2.25} />
              {unread > 0 && (
                <span className="mobile-unread-badge">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </button>

            {profileOpen && (
              <div id="mobile-profile-menu" className="mobile-profile-menu">
                {role ? (
                  <>
                    <p>Your account</p>
                    <Link
                      prefetch={storageFree ? false : undefined}
                      href={accountHref}
                    >
                      {role === "admin" ? "Admin dashboard" : "My account"}
                    </Link>
                    {role !== "admin" &&
                      (hasProfessionalAccount ? (
                        <AccountModeSwitch
                          mode={accountMode}
                          professionalApproved={professionalApproved}
                          hasProfessionalAccount={hasProfessionalAccount}
                        />
                      ) : (
                        <Link
                          prefetch={storageFree ? false : undefined}
                          href="/provider/join"
                        >
                          Apply as a professional
                        </Link>
                      ))}
                    <button
                      type="button"
                      className="mobile-signout"
                      onClick={async () => {
                        await createClient().auth.signOut();
                        setRole(null);
                        setUnread(0);
                        setProfileOpen(false);
                        window.location.href = "/";
                      }}
                    >
                      <LogOut size={17} />
                      Sign out
                    </button>
                  </>
                ) : (
                  <>
                    <p>Continue as</p>
                    <Link
                      prefetch={storageFree ? false : undefined}
                      href="/login"
                    >
                      Sign in
                    </Link>
                    <Link
                      prefetch={storageFree ? false : undefined}
                      href="/auth/sign-up"
                    >
                      Create Account
                    </Link>
                    <Link
                      prefetch={storageFree ? false : undefined}
                      href="/provider"
                    >
                      Sign in as a pro
                    </Link>
                    <Link
                      prefetch={storageFree ? false : undefined}
                      href="/provider"
                    >
                      Become a professional
                    </Link>
                  </>
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            className="mobile-menu-button"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            aria-controls="mobile-site-menu"
            onClick={() => {
              setMobileOpen((open) => !open);
              setProfileOpen(false);
            }}
          >
            <Menu size={21} />
          </button>
        </div>
      </div>

      {/* ---------- row 2 ---------- */}
      <nav className="desktop-navigation" style={navRow} aria-label="Main">
        <div className="site-header-nav-inner" style={navInner}>
          {NAV.map((l) => {
            if (l.href === "/services/cleaning")
              return <CleaningMenu key={l.href} storageFree={storageFree} />;
            const on = active === l.href;
            const hot = hover === l.href;
            const link = (
              <Link
                prefetch={storageFree ? false : undefined}
                key={l.href + l.label}
                href={l.href}
                onMouseEnter={() => setHover(l.href)}
                onMouseLeave={() => setHover(null)}
                style={{
                  ...navItem,
                  color: on || hot ? CORAL : INK,
                  borderBottom: "4px solid transparent",
                  borderImage: on ? `${GRAD} 1` : "none",
                  backgroundImage: on ? GRAD : "none",
                  backgroundSize: "100% 4px",
                  backgroundPosition: "bottom",
                  backgroundRepeat: "no-repeat",
                }}
              >
                {l.label}
              </Link>
            );
            if (l.href === "/services/handyman") {
              return (
                <Fragment key={l.href}>
                  {link}
                  <ComingSoonMenu storageFree={storageFree} />
                </Fragment>
              );
            }
            return link;
          })}
        </div>
      </nav>

      {mobileOpen && (
        <div className="mobile-drawer-layer">
          <button
            type="button"
            className="mobile-drawer-backdrop"
            aria-label="Close menu"
            onClick={() => setMobileOpen(false)}
          />
          <aside
            id="mobile-site-menu"
            className="mobile-drawer"
            aria-label="Site menu"
          >
            <div className="mobile-drawer-head">
              <strong>
                opulence<span>bliss</span>
              </strong>
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setMobileOpen(false)}
              >
                <X size={21} />
              </button>
            </div>

            <Link
              prefetch={storageFree ? false : undefined}
              href="/#services"
              className="mobile-drawer-cta"
            >
              Book a service
            </Link>

            <nav aria-label="Mobile main navigation" className="mobile-links">
              <Link
                prefetch={storageFree ? false : undefined}
                href="/services/cleaning"
              >
                Cleaning services
              </Link>
              <Link
                prefetch={storageFree ? false : undefined}
                href="/services/handyman"
              >
                Property maintenance quotations
              </Link>
              <Link
                prefetch={storageFree ? false : undefined}
                href="/coming-soon"
              >
                Coming soon
              </Link>
              <Link
                prefetch={storageFree ? false : undefined}
                href="/providers"
              >
                Our professionals
              </Link>
              <Link prefetch={storageFree ? false : undefined} href="/blog">
                Blog
              </Link>
              <Link prefetch={storageFree ? false : undefined} href="/faq">
                Frequently asked questions
              </Link>
              <Link prefetch={storageFree ? false : undefined} href="/reviews">
                Customer reviews
              </Link>
              <Link prefetch={storageFree ? false : undefined} href="/provider">
                Jobs &amp; become a pro
              </Link>
            </nav>

            <div className="mobile-account-actions">
              <Link
                prefetch={storageFree ? false : undefined}
                href={accountHref}
              >
                {role ? "Client account" : "Sign in"}
              </Link>
              {role && role !== "admin" && (
                <Link
                  prefetch={storageFree ? false : undefined}
                  href={
                    professionalApproved
                      ? "/worker"
                      : hasProfessionalAccount
                        ? "/worker/application"
                        : "/provider/join"
                  }
                >
                  {professionalApproved
                    ? "My jobs"
                    : hasProfessionalAccount
                      ? "My application"
                      : "Apply as a professional"}
                </Link>
              )}
              {!role && (
                <Link
                  prefetch={storageFree ? false : undefined}
                  href="/provider"
                >
                  Sign in as a pro
                </Link>
              )}
            </div>
          </aside>
        </div>
      )}

      <style jsx global>{`
        .site-header-actions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 10px;
        }

        .site-header-nav-inner {
          scrollbar-width: none;
          -ms-overflow-style: none;
        }

        .site-header-nav-inner::-webkit-scrollbar {
          display: none;
        }

        .mobile-primary,
        .mobile-drawer-layer {
          display: none;
        }

        @media (max-width: 700px) {
          .site-header-bar {
            min-height: 56px;
            gap: 5px !important;
            padding: 7px 12px !important;
          }

          .desktop-actions,
          .desktop-navigation {
            display: none !important;
          }

          .site-logo {
            min-width: 0;
            font-size: 18px !important;
            flex: 0 1 auto;
          }

          .mobile-primary {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 5px;
            min-width: 0;
          }

          .mobile-quick-link {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-height: 36px;
            padding: 6px 8px;
            border: 0;
            background: transparent;
            color: ${CORAL};
            font-size: 11.5px;
            font-weight: 900;
            text-decoration: none;
            white-space: nowrap;
          }

          .mobile-profile-wrap {
            position: relative;
          }

          .mobile-profile-button,
          .mobile-menu-button {
            display: grid;
            place-items: center;
            width: 38px;
            height: 38px;
            padding: 0;
            border: 0;
            background: transparent;
            color: ${INK};
            cursor: pointer;
          }

          .mobile-profile-button {
            position: relative;
          }

          .mobile-unread-badge {
            position: absolute;
            top: -6px;
            right: -6px;
            display: grid;
            place-items: center;
            min-width: 18px;
            height: 18px;
            padding: 0 4px;
            border: 2px solid #fff;
            border-radius: 999px;
            background: ${GRAD};
            color: #fff;
            font-size: 9px;
            font-weight: 900;
            line-height: 1;
          }

          .mobile-profile-menu {
            position: fixed;
            top: 60px;
            right: 12px;
            z-index: 95;
            display: grid;
            gap: 7px;
            width: min(270px, calc(100vw - 24px));
            padding: 12px;
            border: 1px solid #e7e0ee;
            border-radius: 16px;
            background: #fff;
            box-shadow: 0 18px 45px rgba(22, 32, 42, 0.18);
          }

          .mobile-profile-menu p {
            margin: 0 2px 3px;
            color: #737986;
            font-size: 11px;
            font-weight: 900;
            letter-spacing: 0.08em;
            text-transform: uppercase;
          }

          .mobile-profile-menu a,
          .mobile-signout {
            display: flex;
            align-items: center;
            min-height: 42px;
            padding: 9px 11px;
            border: 1px solid #ece7f2;
            border-radius: 11px;
            background: #faf8fd;
            color: ${INK};
            font-family: inherit;
            font-size: 13.5px;
            font-weight: 850;
            text-align: left;
            text-decoration: none;
          }

          .mobile-signout {
            gap: 8px;
            width: 100%;
            cursor: pointer;
          }

          .mobile-drawer-layer {
            position: fixed;
            inset: 0;
            z-index: 100;
            display: block;
          }

          .mobile-drawer-backdrop {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            border: 0;
            background: rgba(22, 32, 42, 0.42);
            backdrop-filter: blur(2px);
          }

          .mobile-drawer {
            position: absolute;
            top: 0;
            right: 0;
            bottom: 0;
            display: flex;
            flex-direction: column;
            gap: 18px;
            width: min(86vw, 340px);
            padding: 18px 16px max(22px, env(safe-area-inset-bottom));
            overflow-y: auto;
            border-left: 1px solid #e6dff0;
            background: #fff;
            box-shadow: -18px 0 45px rgba(22, 32, 42, 0.18);
            animation: drawer-in 180ms ease-out;
          }

          .mobile-drawer-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
          }

          .mobile-drawer-head strong {
            color: ${INK};
            font-size: 23px;
            font-weight: 950;
            letter-spacing: -0.04em;
          }

          .mobile-drawer-head strong span {
            color: ${CORAL};
          }

          .mobile-drawer-head button {
            display: grid;
            place-items: center;
            width: 40px;
            height: 40px;
            padding: 0;
            border: 1px solid #e7e0ee;
            border-radius: 12px;
            background: #fff;
            color: ${INK};
          }

          .mobile-drawer-cta {
            display: grid;
            place-items: center;
            min-height: 48px;
            border-radius: 13px;
            background: ${GRAD};
            box-shadow: 0 8px 22px rgba(109, 40, 217, 0.22);
            color: #fff;
            font-size: 15px;
            font-weight: 950;
            text-decoration: none;
          }

          .mobile-links {
            display: grid;
            gap: 7px;
          }

          .mobile-links a,
          .mobile-links button {
            display: flex;
            align-items: center;
            min-width: 0;
            min-height: 46px;
            padding: 10px 11px !important;
            border: 0 !important;
            border-bottom: 1px solid #eee9f3 !important;
            border-radius: 0 !important;
            background: transparent !important;
            color: ${INK} !important;
            font-family: inherit !important;
            font-size: 14.5px !important;
            font-weight: 850 !important;
            text-decoration: none;
          }

          .mobile-account-actions {
            display: grid;
            gap: 8px;
            margin-top: auto;
            padding-top: 12px;
            border-top: 1px solid #eee8f5;
          }

          .mobile-account-actions a {
            display: grid;
            place-items: center;
            min-height: 44px;
            padding: 9px 12px;
            border: 0;
            color: ${CORAL};
            font-size: 13.5px;
            font-weight: 900;
            text-align: center;
            text-decoration: none;
          }

          @keyframes drawer-in {
            from {
              transform: translateX(100%);
            }
            to {
              transform: translateX(0);
            }
          }
        }

        @media (max-width: 370px) {
          .site-header-bar {
            padding-inline: 9px !important;
          }

          .mobile-quick-link {
            padding-inline: 6px;
            font-size: 10.5px;
          }

          .mobile-profile-button,
          .mobile-menu-button {
            width: 36px;
            height: 36px;
          }

          .site-logo {
            font-size: 14.5px !important;
            letter-spacing: -0.045em !important;
          }
        }

        @media (min-width: 701px) {
          .site-logo {
            font-size: clamp(24px, 3vw, 30px) !important;
          }
        }
      `}</style>
    </header>
  );
}

/* ---------- styles ---------- */

const wrap: React.CSSProperties = {
  background: "#fff",
  position: "sticky",
  top: 0,
  zIndex: 40,
  fontFamily: "'Nunito', system-ui, sans-serif",
  boxShadow: "0 1px 0 rgba(22,32,42,0.06)",
};

const bar: React.CSSProperties = {
  maxWidth: 1180,
  margin: "0 auto",
  padding: "11px 26px 9px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 16,
};

const logo: React.CSSProperties = {
  fontFamily: "'Nunito', system-ui, sans-serif",
  fontSize: "clamp(24px, 3vw, 30px)",
  fontWeight: 900,
  lineHeight: 1,
  letterSpacing: "-0.035em",
  color: INK,
  textDecoration: "none",
};

const ghostBtn: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 800,
  color: INK,
  textDecoration: "none",
  padding: "8px 4px",
  whiteSpace: "nowrap",
};

const proBtn: React.CSSProperties = {
  ...ghostBtn,
  color: CORAL,
};

const blogBtn: React.CSSProperties = {
  ...ghostBtn,
};

const navRow: React.CSSProperties = {
  background: "#F8F3FF",
  borderTop: "1px solid #E8DCFA",
  borderBottom: "1px solid #E8DCFA",
};

const navInner: React.CSSProperties = {
  maxWidth: 1180,
  margin: "0 auto",
  padding: "0 26px",
  display: "flex",
  alignItems: "center",
  gap: 26,
  overflowX: "auto",
  overflowY: "hidden",
};

const navItem: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  fontSize: 15.5,
  fontWeight: 800,
  lineHeight: 1.2,
  textDecoration: "none",
  padding: "9px 0 7px",
  borderBottom: "4px solid transparent",
  marginBottom: -1,
  whiteSpace: "nowrap",
};
