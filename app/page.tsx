"use client";

/* eslint-disable @next/next/no-html-link-for-pages */

// SETUP: code "app/page.tsx"
//
// Landing page — two-level nav, hero, coloured service bands.

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Hammer, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import SiteFooter from "@/components/SiteFooter";

type HomeQuote =
  | {
      id: string;
      rating: number;
      comment: string | null;
      source: "booking";
      professional: string;
    }
  | {
      id: string;
      rating: number;
      comment: string;
      source: "testimonial";
      customerName: string;
      location: string | null;
    };

export default function Home() {
  const firstScreen = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const intro = firstScreen.current;
    if (!intro) return;
    const measureNavigation = () => {
      const offset = Math.max(
        0,
        intro.getBoundingClientRect().top + window.scrollY,
      );
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
        setQuotes(
          managed.map((review) => ({
            id: review.id,
            rating: review.rating,
            comment: review.comment,
            source: "testimonial" as const,
            customerName: review.customer_name,
            location: review.location,
          })),
        );
        return;
      }
      const { data: featured } = await supabase.rpc(
        "homepage_review_highlights_feed",
      );
      const selected = (featured ?? []) as {
        id: string;
        rating: number;
        comment: string | null;
        recipient_name: string;
      }[];
      const { data } =
        selected.length === 0
          ? await supabase.rpc("public_reviews_feed", { p_limit: 100 })
          : {
              data: selected.map((row) => ({
                ...row,
                recipient_type: "professional",
              })),
            };
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
              <span className="hero-purple">Peace within</span>
              <br />
              <span className="hero-gold">your walls</span>
            </h1>
            <p className="lede">
              Vetted cleaners and trusted property maintenance professionals
              across London. Book the help your home needs.
            </p>

            <div className="composer">
              <input
                placeholder="Enter your postcode"
                value={postcode}
                onChange={(e) => setPostcode(e.target.value)}
                aria-label="Postcode"
              />
              <a className="btn" href={bookLink}>
                Book a service
              </a>
            </div>
            <a className="btn mobile-book" href="#services">
              Book a service
            </a>
            <p className="micro">Simple pay-per-visit booking</p>
            <a className="hero-quote" href="/services/handyman">
              Need something repaired or installed? Request a property
              maintenance quote →
            </a>
          </div>
        </header>

        {/* ---------- SERVICE BANDS ---------- */}
        <section
          className="bands"
          id="services"
          aria-labelledby="services-title"
        >
          <h2 className="services-title" id="services-title">
            Our Services
          </h2>
          <div className="service-cards">
            <a
              className="band clean"
              href="/services/cleaning#cleaning-services"
            >
              <div>
                <h3>Cleaning</h3>
                <p>and ironing, at home</p>
              </div>
              <span className="service-icon" aria-hidden="true">
                <Sparkles strokeWidth={1.4} />
              </span>
            </a>

            <a className="band maintenance" href="/services/handyman">
              <div>
                <h3>Property maintenance</h3>
                <p>repairs, assembly and home maintenance</p>
              </div>
              <span className="service-icon" aria-hidden="true">
                <Hammer strokeWidth={1.4} />
              </span>
            </a>
          </div>
        </section>
      </div>

      {/* ---------- TRUST ---------- */}
      <section className="strip">
        {[
          [
            "Vetted cleaners",
            "Every approved cleaner is vetted before taking bookings",
          ],
          [
            "Clear before you commit",
            "See the cleaning price or approve a property maintenance quote",
          ],
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
              [
                "Choose a service",
                "Book cleaning or request property maintenance help.",
              ],
              ["Tell us what you need", "Add your address and job details."],
              [
                "Pick a suitable time",
                "Choose a cleaning time, then confirm your booking or approve a property maintenance quote.",
              ],
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
                    {quote.source === "testimonial"
                      ? quote.customerName
                      : "Customer"}
                  </strong>
                  <span
                    className="quote-stars"
                    aria-label={`${quote.rating} out of 5`}
                  >
                    {"\u2605".repeat(quote.rating)}
                    {"\u2606".repeat(5 - quote.rating)}
                  </span>
                  <p>
                    {quote.comment ||
                      "Rating shared without a written comment."}
                  </p>
                  {quote.source === "testimonial" && quote.location && (
                    <footer>{quote.location}</footer>
                  )}
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
        <p>
          Choose a cleaning time that suits you; we&apos;ll find your cleaner.
        </p>
        <a className="btn light" href="/book">
          Book a service
        </a>
      </section>

      <section className="earn-section" aria-labelledby="earn-title">
        <div className="earn-inner">
          <div className="earn-copy">
            <p className="eyebrow">Your skills. New possibilities.</p>
            <h2 id="earn-title">Earn with Us</h2>
            <p className="earn-description">
              Turn the work you love into your next opportunity. Join our
              community of professionals and help make London homes feel their
              best.
            </p>
            <div className="earn-benefits">
              <span>Choose your availability</span>
              <span>Put your skills to work</span>
            </div>
            <p className="earn-sign-in">
              Already part of the team? <a href="/provider/login">Sign in</a>
            </p>
          </div>
          <div className="earn-art">
            <Image
              src="/earn-with-us-people-cartoon-v2.webp"
              alt="Three cartoon professionals smiling together, with a man recording himself and pound banknotes and gold coins floating beside his phone."
              width={1536}
              height={1024}
              sizes="(max-width: 700px) 100vw, (max-width: 1100px) 55vw, 620px"
            />
          </div>
        </div>
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
          min-height: 0;
          display: grid;
          grid-template-rows: minmax(0, 3fr) minmax(0, 2fr);
        }
        .hero {
          display: flex;
          align-items: center;
          position: relative;
          isolation: isolate;
          overflow: hidden;
          background:
            linear-gradient(
              90deg,
              rgba(19, 16, 22, 0.58) 0%,
              rgba(26, 19, 27, 0.76) 50%,
              rgba(24, 16, 22, 0.58) 100%
            ),
            url("/hero-peace-within.webp") center 38% / cover no-repeat;
          padding: clamp(18px, 3svh, 36px) 28px;
        }
        .hero-inner {
          width: 100%;
          max-width: 1080px;
          margin: 0 auto;
          text-align: center;
        }
        h1 {
          color: #fff;
          font-size: clamp(38px, 5vw, 64px);
          line-height: 1.02;
          letter-spacing: -0.015em;
          max-width: 760px;
          margin: 0 auto 18px;
          text-shadow: 0 2px 16px rgba(19, 16, 22, 0.55);
        }
        .hero-purple {
          color: #ad6dde;
        }
        .hero-gold {
          color: #f5c542;
        }
        .lede {
          color: rgba(255, 255, 255, 0.9);
          font-size: 18px;
          line-height: 1.6;
          max-width: 44ch;
          margin: 0 auto 20px;
        }
        .composer {
          display: flex;
          gap: 10px;
          background: rgba(255, 255, 255, 0.94);
          border: 1px solid rgba(255, 255, 255, 0.56);
          border-radius: 999px;
          padding: 7px 7px 7px 22px;
          max-width: 500px;
          margin-inline: auto;
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
          background: linear-gradient(100deg, #f5c542, #c86fc9 55%, #7b2ff7);
          color: #fff;
          text-decoration: none;
          border-radius: 999px;
          padding: 13px 26px;
          font-weight: 900;
          font-size: 15.5px;
          white-space: nowrap;
          display: inline-block;
          box-shadow: 0 7px 18px rgba(72, 28, 142, 0.2);
          transition:
            transform 0.18s ease,
            filter 0.18s ease;
        }
        .btn:hover {
          filter: brightness(1.06);
          transform: translateY(-1px);
        }
        .mobile-book {
          display: none;
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
          scroll-margin-top: 80px;
          width: 100%;
          box-sizing: border-box;
          max-width: 1080px;
          margin: 0 auto;
          padding: clamp(12px, 2.5svh, 24px) 28px;
          display: grid;
          grid-template-rows: auto minmax(0, 1fr);
          gap: 12px;
          min-height: 0;
        }
        .services-title {
          margin: 0;
          text-align: center;
          font-size: clamp(22px, 2.5vw, 30px);
          line-height: 1.1;
          letter-spacing: -0.02em;
        }
        .service-cards {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          align-items: stretch;
          gap: 16px;
          min-height: 0;
        }
        .band {
          box-sizing: border-box;
          position: relative;
          isolation: isolate;
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
          text-align: center;
          min-height: 0;
          padding: 22px 28px;
          border: 1px solid var(--line);
          border-radius: 22px;
          text-decoration: none;
          transition:
            transform 0.18s ease,
            box-shadow 0.18s ease;
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
        .band h3 {
          font-size: clamp(26px, 3.2vw, 42px);
          line-height: 1.15;
          margin: 0 0 4px;
          color: #fff;
        }
        .band p {
          margin: 0;
          font-size: 16px;
          color: rgba(255, 255, 255, 0.9);
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
          background:
            linear-gradient(
              to top,
              rgba(12, 10, 24, 0.72),
              rgba(12, 10, 24, 0.34) 46%,
              rgba(12, 10, 24, 0.08)
            ),
            linear-gradient(145deg, #7b2ff7 0%, #a33ea6 55%, #f5c542 140%);
        }
        .band.maintenance {
          background:
            linear-gradient(
              to top,
              rgba(12, 10, 24, 0.72),
              rgba(12, 10, 24, 0.34) 46%,
              rgba(12, 10, 24, 0.38)
            ),
            linear-gradient(145deg, #f5c542 0%, #c86fc9 62%, #7b2ff7 120%);
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
          background: color-mix(
            in srgb,
            var(--ob-surface-soft) 74%,
            transparent
          );
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

        /* EARN WITH US */
        .earn-section {
          background: linear-gradient(120deg, #fffaf0, #f3e4c8 66%, #eddbb6);
          color: #30223b;
          padding: clamp(36px, 6vw, 76px) 28px 0;
          overflow: hidden;
        }
        .earn-inner {
          max-width: 1160px;
          margin: 0 auto;
          display: grid;
          grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.15fr);
          align-items: center;
          gap: 20px;
        }
        .earn-copy {
          padding-bottom: clamp(36px, 6vw, 76px);
          position: relative;
          z-index: 1;
        }
        .earn-copy .eyebrow {
          color: #78469a;
          font-weight: 800;
        }
        .earn-copy h2 {
          color: #442452;
          font-size: clamp(34px, 4vw, 50px);
          line-height: 1.1;
          letter-spacing: -0.025em;
          margin: 0 0 18px;
        }
        .earn-description {
          max-width: 43ch;
          color: #5f4e50;
          font-size: 17px;
          line-height: 1.65;
          margin: 0 0 22px;
        }
        .earn-benefits {
          display: flex;
          flex-wrap: wrap;
          gap: 10px 18px;
          margin-bottom: 0;
          color: #634576;
          font-size: 13px;
          font-weight: 800;
        }
        .earn-benefits span::before {
          content: "✓";
          margin-right: 7px;
        }
        .earn-sign-in {
          margin: 18px 0 0;
          color: #5f4e50;
          font-size: 13px;
        }
        .earn-sign-in a {
          color: #684088;
          font-weight: 800;
          text-underline-offset: 3px;
        }
        .earn-art {
          align-self: end;
          min-width: 0;
        }
        .earn-art :global(img) {
          display: block;
          width: 100%;
          height: auto;
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
        @media (max-width: 700px) {
          .topbar,
          .servicenav {
            padding-left: 16px;
            padding-right: 16px;
          }
          .servicenav {
            gap: 20px;
          }
          .hero {
            padding: 18px 16px;
            background-position: 90% center;
            background-image:
              linear-gradient(
                90deg,
                rgba(19, 16, 22, 0.62),
                rgba(24, 16, 22, 0.68)
              ),
              url("/hero-peace-within.webp");
          }
          .hero h1 {
            font-size: clamp(36px, 10vw, 48px) !important;
            line-height: 1.05 !important;
            margin-bottom: 12px;
          }
          .lede {
            font-size: 14px;
            line-height: 1.45;
            margin-bottom: 16px;
          }
          .micro,
          .hero-quote {
            display: none;
          }
          .bands {
            padding: 14px 16px;
            gap: 10px;
          }
          .services-title {
            font-size: 22px;
          }
          .service-cards {
            gap: 10px;
          }
          .band {
            width: 100%;
            padding: 14px 12px;
            position: relative;
            align-items: center;
          }
          .band h3 {
            font-size: clamp(20px, 5.4vw, 28px);
          }
          .band p {
            font-size: 12px;
            line-height: 1.4;
            margin-bottom: 0;
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
            display: none;
          }
          .mobile-book {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-height: 48px;
            padding: 12px 26px;
          }
          .strip {
            margin-left: 16px;
            margin-right: 16px;
          }
          .earn-section {
            padding: 40px 20px 0;
          }
          .earn-inner {
            grid-template-columns: minmax(0, 1fr);
            gap: 24px;
            text-align: center;
          }
          .earn-copy {
            padding-bottom: 0;
          }
          .earn-description {
            margin-inline: auto;
            font-size: 15px;
          }
          .earn-benefits {
            justify-content: center;
            gap: 10px 14px;
          }
          .earn-art {
            width: 100%;
            max-width: 480px;
            margin: 0 auto;
          }
        }
        @media (max-height: 800px) and (min-width: 701px) {
          .hero {
            padding-top: 20px;
            padding-bottom: 20px;
          }
          h1 {
            font-size: 48px;
            margin-bottom: 12px;
          }
          .lede {
            font-size: 16px;
            line-height: 1.45;
            margin-bottom: 16px;
          }
          .micro,
          .hero-quote {
            display: none;
          }
          .band {
            padding: 18px 22px;
          }
          .band h3 {
            font-size: clamp(26px, 3.2vw, 36px);
          }
        }
        @media (max-width: 700px) and (max-height: 600px) {
          .hero {
            padding: 12px 16px;
          }
          .hero h1 {
            font-size: clamp(32px, 9.5vw, 40px) !important;
            margin-bottom: 8px;
          }
          .lede {
            font-size: 13px;
            margin-bottom: 8px;
          }
          .band {
            padding: 10px;
          }
          .bands {
            padding-block: 10px;
            gap: 8px;
          }
          .services-title {
            font-size: 20px;
          }
          .band h3 {
            font-size: 19px;
          }
          .band p {
            font-size: 11px;
            line-height: 1.3;
          }
        }
        /* Let very short/zoomed windows scroll rather than cut off controls. */
        @media (max-height: 480px) {
          .first-screen {
            height: auto;
            grid-template-rows: auto auto;
          }
          .band {
            min-height: 140px;
          }
        }
      `}</style>
    </div>
  );
}
