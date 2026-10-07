"use client";

/* eslint-disable @next/next/no-html-link-for-pages */

// SETUP: code "app/page.tsx"
//
// Landing page — two-level nav, hero, coloured service bands.

import { useEffect, useRef, useState } from "react";
import { Hammer, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import SiteFooter from "@/components/SiteFooter";

type HomeQuote =
  | { id: string; rating: number; comment: string | null; source: "booking"; professional: string }
  | { id: string; rating: number; comment: string; source: "testimonial"; customerName: string; location: string | null };

export default function Home() {
  const firstScreen = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const intro = firstScreen.current;
    if (!intro) return;
    const measureNavigation = () => {
      const offset = Math.max(0, intro.getBoundingClientRect().top + window.scrollY);
      intro.style.setProperty("--home-navigation-height", `${offset}px`);
    };
    measureNavigation();
    const observer = new ResizeObserver(measureNavigation);
    // Account for both navigation rows and any environment banner above the page.
    let ancestor: HTMLElement | null = intro;
    while (ancestor && ancestor !== document.body) {
      let sibling = ancestor.previousElementSibling;
      while (sibling) {
        observer.observe(sibling);
        sibling = sibling.previousElementSibling;
      }
      ancestor = ancestor.parentElement;
    }
    window.addEventListener("resize", measureNavigation);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measureNavigation);
    };
  }, []);
  const [quotes, setQuotes] = useState<HomeQuote[] | null>(null);
  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: managed } = await supabase
        .from("marketing_reviews")
        .select("id, rating, comment, customer_name, location")
        .eq("service_type", "cleaning")
        .eq("is_demo", false)
        .eq("homepage_featured", true)
        .order("sort_order", { ascending: true })
        .order("reviewed_at", { ascending: false });
      if (managed?.length) {
        setQuotes(managed.map((review) => ({
          id: review.id,
          rating: review.rating,
          comment: review.comment,
          source: "testimonial" as const,
          customerName: review.customer_name,
          location: review.location,
        })));
        return;
      }
      const { data: featured } = await supabase.rpc("homepage_review_highlights_feed");
      const selected = (featured ?? []) as {
        id: string;
        rating: number;
        comment: string | null;
        recipient_name: string;
      }[];
      const { data } = selected.length === 0
        ? await supabase.rpc("public_reviews_feed", { p_limit: 100 })
        : { data: selected.map((row) => ({ ...row, recipient_type: "professional" })) };
      const rows = (data ?? []) as {
        id: string;
        rating: number;
        comment: string | null;
        recipient_name: string;
        recipient_type: string;
      }[];
      setQuotes(
        rows
          .filter((row) => row.recipient_type === "professional")
          .slice(0, 6)
          .map((row) => ({
            id: row.id,
            rating: row.rating,
            comment: row.comment?.trim() || null,
            source: "booking" as const,
            professional: row.recipient_name,
          })),
      );
    })();
  }, []);
  const [postcode, setPostcode] = useState("");

  const bookLink = postcode
    ? `/book?pc=${encodeURIComponent(postcode)}`
    : "/book";

  return (
    <div className="site">
      <div className="first-screen" ref={firstScreen}>
      {/* ---------- HERO ---------- */}
      <header className="hero">
        <div className="hero-inner">
          <h1>
            Your home,
            <br />taken care of
          </h1>
          <p className="lede">
            Vetted cleaners and trusted handymen across London. Book a clean or
            request a tailored quote for work around your home.
          </p>

          <div className="composer">
            <input
              placeholder="Enter your postcode"
              value={postcode}
              onChange={(e) => setPostcode(e.target.value)}
              aria-label="Postcode"
            />
            <a className="btn" href={bookLink}>
              Book my cleaning
            </a>
          </div>
          <p className="micro">Simple pay per visit booking down there</p>
          <a className="hero-quote" href="/services/handyman">
            Need something repaired or installed? Request a handyman quote →
          </a>
        </div>
      </header>

      {/* ---------- SERVICE BANDS ---------- */}
      <section className="bands" id="services">
        <a className="band clean" href="/services/cleaning">
          <div>
            <h2>Cleaning</h2>
            <p>and ironing, at home</p>
            <span className="from">Book a cleaning visit</span>
          </div>
          <span className="service-icon" aria-hidden="true"><Sparkles strokeWidth={1.4} /></span>
        </a>

        <a className="band handyman" href="/services/handyman">
          <div>
            <h2>Handyman</h2>
            <p>repairs, assembly and home maintenance</p>
            <span className="from">Request a tailored quote</span>
          </div>
          <span className="service-icon" aria-hidden="true"><Hammer strokeWidth={1.4} /></span>
        </a>
      </section>

      </div>

      {/* ---------- TRUST ---------- */}
      <section className="strip">
        {[
          ["Vetted cleaners", "Every approved cleaner is vetted before taking bookings"],
          ["Clear before you commit", "See the cleaning price or approve a handyman quote"],
          ["Your regular pro", "Ask for them again next time"],
          ["Book in 2 hours", "Same-day booking available"],
        ].map(([t, s]) => (
          <div key={t}>
            <strong>{t}</strong>
            <span>{s}</span>
          </div>
        ))}
      </section>

      {/* ---------- HOW IT WORKS ---------- */}
      <section id="how" className="band-alt">
        <div className="inner">
          <p className="eyebrow center">How it works</p>
          <h2 className="center big">Four steps, then it just happens</h2>
          <ol className="steps">
            {[
              ["Choose a service", "Book cleaning or request handyman help."],
              ["Tell us what you need", "Add your address and job details."],
              ["Pick a suitable time", "Choose a cleaning time, then confirm your booking or approve a handyman quote."],
              ["Your pro arrives", "They check in and take care of the work."],
            ].map(([t, s], i) => (
              <li key={t}>
                <span className="num">{i + 1}</span>
                <div>
                  <strong>{t}</strong>
                  <p>{s}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ---------- REVIEWS ---------- */}
      {/* Real customer reviews only: admin-featured cards take priority. */}
      {quotes && quotes.length > 0 && (
        <section className="quotes-wrap">
          <div className="inner">
            <p className="eyebrow center">From our customers</p>
            <h2 className="center big">Happy Customer Moments</h2>
            <div className="quotes">
              {quotes.map((quote) => (
                <blockquote key={quote.id}>
                  <strong className="quote-name">
                    {quote.source === "testimonial" ? quote.customerName : "Customer"}
                  </strong>
                  <span className="quote-stars" aria-label={`${quote.rating} out of 5`}>
                    {"\u2605".repeat(quote.rating)}
                    {"\u2606".repeat(5 - quote.rating)}
                  </span>
                  <p>{quote.comment || "Rating shared without a written comment."}</p>
                  {quote.source === "testimonial" && quote.location && <footer>{quote.location}</footer>}
                </blockquote>
              ))}
            </div>
            <p className="center all-reviews">
              <a href="/reviews">Read all reviews</a>
            </p>
          </div>
        </section>
      )}

      {/* ---------- CTA ---------- */}
      <section className="cta-band">
        <h2>Ready to hand it over?</h2>
        <p>Choose a cleaning time that suits you; we&apos;ll find your cleaner.</p>
        <a className="btn light" href="/book">
          Book a service
        </a>
      </section>

      <SiteFooter />

      <style jsx>{`
        .site {
          --cream: var(--ob-surface);
          --green: var(--ob-text);
          --green-mid: var(--ob-purple);
          --green-pale: var(--ob-purple-soft);
          --apricot: #f5c542;
          --apricot-deep: var(--ob-purple);
          --ink: var(--ob-text);
          --muted: var(--ob-muted);
          --line: var(--ob-border);
          background: transparent;
          color: var(--ink);
          font-family: var(--font-nunito), "Nunito", system-ui, sans-serif;
          overflow-x: hidden;
        }
        h1,
        h2,
        h3 {
          font-family: inherit;
          font-weight: 900;
          color: var(--green);
        }
        .center {
          text-align: center;
        }
        .eyebrow {
          text-transform: uppercase;
          letter-spacing: 0.14em;
          font-size: 12px;
          font-weight: 600;
          color: var(--apricot-deep);
          margin: 0 0 8px;
        }
        .inner {
          max-width: 1080px;
          margin: 0 auto;
        }

        /* TOP BAR */
        .topbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 18px 28px;
          background: #fff;
          border-bottom: 1px solid var(--line);
        }
        .logo {
          font-family: "Nunito", system-ui, sans-serif;
          font-size: 24px;
          font-weight: 600;
          color: var(--green);
          text-decoration: none;
          letter-spacing: -0.01em;
        }
        .top-right {
          display: flex;
          align-items: center;
          gap: 22px;
        }
        .jobs {
          color: var(--ink);
          font-size: 15px;
          font-weight: 600;
          text-decoration: underline;
          text-underline-offset: 3px;
        }
        .icon {
          color: var(--green);
          font-size: 20px;
          text-decoration: none;
        }

        /* SERVICE NAV */
        .servicenav {
          display: flex;
          gap: 30px;
          padding: 0 28px;
          background: #fff;
          border-bottom: 1px solid var(--line);
          overflow-x: auto;
        }
        .servicenav a {
          color: var(--ink);
          text-decoration: none;
          font-size: 16px;
          font-weight: 600;
          padding: 15px 0;
          border-bottom: 3px solid transparent;
          white-space: nowrap;
        }
        .servicenav a:hover {
          color: var(--apricot-deep);
          border-bottom-color: var(--apricot);
        }

        /* HERO */
        .first-screen {
          height: calc(100svh - var(--home-navigation-height, 100px));
          min-height: min-content;
          display: grid;
          grid-template-rows: minmax(min-content, 13fr) minmax(min-content, 7fr);
        }
        .hero {
          display: flex;
          align-items: center;
          position: relative;
          isolation: isolate;
          overflow: hidden;
          background: linear-gradient(90deg, rgba(19, 16, 22, 0.86) 0%, rgba(26, 19, 27, 0.72) 37%, rgba(24, 16, 22, 0.16) 78%), url("/hero-home.webp") center / cover no-repeat;
          padding: clamp(24px, 4svh, 44px) 28px;
        }
        .hero-inner {
          width: 100%;
          max-width: 1080px;
          margin: 0 auto;
          text-align: left;
        }
        h1 {
          color: #fff;
          font-size: clamp(38px, 5vw, 64px);
          line-height: 1.02;
          letter-spacing: -0.015em;
          max-width: 760px;
          margin: 0 0 18px;
        }
        .lede {
          color: rgba(255, 255, 255, 0.9);
          font-size: 18px;
          line-height: 1.6;
          max-width: 44ch;
          margin: 0 0 20px;
        }
        .composer {
          display: flex;
          gap: 10px;
          background: rgba(255, 255, 255, 0.94);
          border: 1px solid rgba(255, 255, 255, 0.56);
          border-radius: 999px;
          padding: 7px 7px 7px 22px;
          max-width: 500px;
          margin-inline: 0;
          text-align: left;
          box-shadow: 0 18px 48px rgba(45, 19, 73, 0.22);
          backdrop-filter: blur(12px);
        }
        .composer input {
          flex: 1;
          border: none;
          outline: none;
          font: inherit;
          font-size: 16px;
          background: transparent;
          color: var(--ink);
          text-transform: uppercase;
          min-width: 0;
        }
        .btn {
          background: linear-gradient(100deg,#F5C542,#C86FC9 55%,#7B2FF7);
          color: #fff;
          text-decoration: none;
          border-radius: 999px;
          padding: 13px 26px;
          font-weight: 900;
          font-size: 15.5px;
          white-space: nowrap;
          display: inline-block;
          box-shadow: 0 7px 18px rgba(72, 28, 142, 0.2);
          transition: transform 0.18s ease, filter 0.18s ease;
        }
        .btn:hover {
          filter: brightness(1.06);
          transform: translateY(-1px);
        }
        .btn.light {
          background: var(--cream);
          color: var(--green);
        }
        .micro {
          color: rgba(255, 255, 255, 0.8);
          font-size: 13.5px;
          margin: 14px 0 0;
        }
        .hero-quote {
          display: inline-block;
          margin-top: 16px;
          color: #fff;
          font-size: 14px;
          font-weight: 900;
          text-underline-offset: 4px;
        }

        /* SERVICE BANDS */
        .bands {
          width: 100%;
          box-sizing: border-box;
          max-width: 1080px;
          margin: 0 auto;
          padding: 24px 28px 18px;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 16px;
        }
        .band {
          box-sizing: border-box;
          position: relative;
          isolation: isolate;
          overflow: hidden;
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          min-height: 142px;
          padding: 22px 28px;
          border: 1px solid var(--line);
          border-radius: 22px;
          text-decoration: none;
          transition: transform 0.18s ease, box-shadow 0.18s ease;
          box-shadow: 0 9px 26px var(--ob-shadow-soft);
        }
        .band > div {
          position: relative;
          z-index: 1;
        }
        .band:hover {
          transform: translateY(-3px);
          box-shadow: 0 18px 46px var(--ob-shadow);
        }
        .band h2 {
          font-size: clamp(30px, 4.4vw, 46px);
          line-height: 1.15;
          margin: 0 0 4px;
          color: #fff;
        }
        .band p {
          margin: 0 0 10px;
          font-size: 16px;
          color: rgba(255, 255, 255, 0.9);
        }
        .from {
          display: inline-block;
          background: rgba(255, 255, 255, 0.82);
          border: 1px solid rgba(255, 255, 255, 0.48);
          color: var(--green);
          font-size: 13.5px;
          font-weight: 700;
          padding: 6px 14px;
          border-radius: 999px;
        }
        .service-icon {
          position: absolute;
          right: -14px;
          bottom: -14px;
          z-index: 0;
          width: 132px;
          height: 132px;
          color: rgba(255, 255, 255, 0.22);
          pointer-events: none;
        }
        .service-icon :global(svg) {
          width: 100%;
          height: 100%;
        }
        .band.clean {
          background: linear-gradient(to top, rgba(12, 10, 24, 0.72), rgba(12, 10, 24, 0.34) 46%, rgba(12, 10, 24, 0.08)), linear-gradient(145deg, #7b2ff7 0%, #a33ea6 55%, #f5c542 140%);
        }
        .band.handyman {
          background: linear-gradient(to top, rgba(12, 10, 24, 0.72), rgba(12, 10, 24, 0.34) 46%, rgba(12, 10, 24, 0.08)), linear-gradient(145deg, #f5c542 0%, #c86fc9 62%, #7b2ff7 120%);
        }

        /* TRUST STRIP */
        .strip {
          border-top: 1px solid var(--line);
          border-bottom: 1px solid var(--line);
          background: var(--ob-surface);
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          max-width: 1080px;
          margin: 44px auto 0;
          border: 1px solid var(--line);
          border-radius: 20px;
          overflow: hidden;
          box-shadow: 0 10px 30px var(--ob-shadow-soft);
        }
        .strip > div {
          padding: 26px 24px;
          border-right: 1px solid var(--line);
        }
        .strip > div:last-child {
          border-right: none;
        }
        .strip strong {
          display: block;
          color: var(--green);
          font-size: 15px;
          margin-bottom: 4px;
        }
        .strip span {
          font-size: 13.5px;
          color: var(--muted);
        }

        /* BANDS / SECTIONS */
        .band-alt {
          background: color-mix(in srgb, var(--ob-surface-soft) 74%, transparent);
          padding: 78px 28px;
          margin-top: 0;
        }
        .quotes-wrap {
          padding: 78px 28px;
        }
        .big {
          font-size: clamp(30px, 4.4vw, 44px);
          margin: 0 0 12px;
          line-height: 1.1;
        }
        .steps {
          list-style: none;
          padding: 0;
          margin: 44px 0 0;
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 22px;
        }
        .steps li {
          display: grid;
          gap: 12px;
        }
        .num {
          display: grid;
          place-items: center;
          width: 38px;
          height: 38px;
          border-radius: 50%;
          background: linear-gradient(135deg, #c86fc9, #6d28d9);
          color: #fff;
          font-family: inherit;
          font-size: 17px;
        }
        .steps strong {
          color: var(--green);
          font-size: 16.5px;
        }
        .steps p {
          color: var(--muted);
          font-size: 14.5px;
          margin: 6px 0 0;
          line-height: 1.55;
        }
        .quotes {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 22px;
          margin-top: 42px;
        }
        blockquote {
          background: var(--ob-surface-raised);
          border: 1px solid var(--line);
          border-radius: 18px;
          padding: 28px 26px;
          margin: 0;
          box-shadow: 0 10px 30px var(--ob-shadow-soft);
        }
        blockquote p {
          font-family: inherit;
          font-size: 17.5px;
          line-height: 1.5;
          color: var(--ink);
          margin: 0 0 16px;
        }
        .quote-name {
          display: block;
          margin-bottom: 8px;
          color: var(--ink);
          font-size: 18px;
        }
        .quote-stars {
          display: block;
          margin-bottom: 8px;
          color: #f5c542;
          letter-spacing: 2px;
        }
        .all-reviews {
          margin-top: 22px;
        }
        .all-reviews a {
          color: #6d28d9;
          font-weight: 800;
        }
        blockquote footer {
          font-size: 13.5px;
          color: var(--muted);
        }

        /* CTA */
        .cta-band {
          background: linear-gradient(135deg, #18202d, #302040);
          color: #fff;
          text-align: center;
          padding: 76px 28px;
        }
        .cta-band h2 {
          color: #fff;
          font-size: clamp(30px, 4.4vw, 44px);
          margin: 0 0 10px;
        }
        .cta-band p {
          color: #cfdcd2;
          margin: 0 0 26px;
        }

        /* RESPONSIVE */
        @media (max-width: 900px) {
          .strip,
          .steps,
          .quotes {
            grid-template-columns: 1fr 1fr;
          }
          .strip > div:nth-child(2) {
            border-right: none;
          }
          .strip {
            margin-left: 20px;
            margin-right: 20px;
          }
        }
        @media (max-width: 620px) {
          .topbar,
          .servicenav {
            padding-left: 16px;
            padding-right: 16px;
          }
          .servicenav {
            gap: 20px;
          }
          .hero {
            padding: 22px 16px;
            background-position: 62% center;
          }
          h1 {
            font-size: clamp(30px, 8vw, 40px);
            margin-bottom: 12px;
          }
          .lede {
            font-size: 14px;
            line-height: 1.45;
            margin-bottom: 16px;
          }
          .micro {
            font-size: 12px;
            margin-top: 10px;
          }
          .hero-quote {
            font-size: 12px;
            margin-top: 10px;
          }
          .bands {
            padding: 18px 16px 8px;
            gap: 10px;
          }
          .band {
            min-height: 136px;
            padding: 14px 12px;
            position: relative;
            align-items: flex-end;
          }
          .band h2 {
            font-size: clamp(20px, 5.4vw, 28px);
          }
          .band p {
            font-size: 12px;
            line-height: 1.4;
            min-height: 34px;
          }
          .band .from {
            font-size: 11px;
            padding: 5px 8px;
          }
          .service-icon {
            width: 108px;
            height: 108px;
          }
          .strip,
          .steps,
          .quotes {
            grid-template-columns: 1fr;
          }
          .strip > div {
            border-right: none;
            border-bottom: 1px solid var(--line);
          }
          .composer {
            flex-direction: column;
            border-radius: 18px;
            padding: 10px;
          }
          .composer input {
            min-height: 26px;
          }
          .composer .btn {
            width: 100%;
            box-sizing: border-box;
            text-align: center;
          }
          .strip {
            margin-left: 16px;
            margin-right: 16px;
          }
        }
        @media (max-height: 800px) and (min-width: 621px) {
          .hero { padding-top: 20px; padding-bottom: 20px; }
          h1 { font-size: 48px; margin-bottom: 12px; }
          .lede { font-size: 16px; line-height: 1.45; margin-bottom: 16px; }
        }
        @media (max-width: 620px) and (max-height: 600px) {
          .first-screen { grid-template-rows: minmax(min-content, 1fr) auto; }
          .hero { padding: 12px 16px; }
          h1 { font-size: 28px; margin-bottom: 8px; }
          .lede { font-size: 13px; margin-bottom: 8px; }
          .micro, .hero-quote { margin-top: 6px; }
          .composer { flex-direction: row; border-radius: 999px; gap: 6px; padding: 4px 4px 4px 12px; }
          .composer .btn { width: auto; font-size: 12px; padding: 13px 12px; }
          .band { min-height: 132px; padding-block: 12px; }
        }
      `}</style>
    </div>
  );
}
