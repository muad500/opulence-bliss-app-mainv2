"use client";

/* eslint-disable @next/next/no-html-link-for-pages */

// SETUP: code "app/page.tsx"
//
// Landing page — two-level nav, hero, coloured service bands.

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import SiteFooter from "@/components/SiteFooter";

type HomeQuote = { id: string; rating: number; comment: string | null; professional: string };

export default function Home() {
  const [quotes, setQuotes] = useState<HomeQuote[] | null>(null);
  useEffect(() => {
    (async () => {
      const supabase = createClient();
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
          .filter((row) => row.recipient_type === "professional" && row.rating >= 4)
          .slice(0, 6)
          .map((row) => ({
            id: row.id,
            rating: row.rating,
            comment: row.comment?.trim() || null,
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
          <span className="arrow">→</span>
        </a>

        <a className="band handyman" href="/services/handyman">
          <div>
            <h2>Handyman</h2>
            <p>repairs, assembly and home maintenance</p>
            <span className="from">Request a tailored quote</span>
          </div>
          <span className="arrow">→</span>
        </a>
      </section>

      {/* ---------- TRUST ---------- */}
      <section className="strip">
        {[
          ["Vetted cleaners", "Every approved cleaner is vetted before taking bookings"],
          ["Clear before you commit", "See the cleaning price or approve a handyman quote"],
          ["Your regular pro", "Ask for them again next time"],
          ["Same-day booking requests", "Choose a suitable time today; we'll look for your cleaner"],
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
      {/* Only genuine, positive public booking reviews are highlighted here.
          The footer links to the complete public feed and includes all ratings in its overall score. */}
      {quotes && quotes.length > 0 && (
        <section className="quotes-wrap">
          <div className="inner">
            <p className="eyebrow center">From our customers</p>
            <h2 className="center big">Happy Customer Moments</h2>
            <div className="quotes">
              {quotes.map((quote) => (
                <blockquote key={quote.id}>
                  <span className="quote-stars" aria-label={`${quote.rating} out of 5`}>
                    {"\u2605".repeat(quote.rating)}
                    {"\u2606".repeat(5 - quote.rating)}
                  </span>
                  <p>{quote.comment || "Rating shared without a written comment."}</p>
                  <footer>Verified customer · about {quote.professional}</footer>
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
        .hero {
          position: relative;
          isolation: isolate;
          overflow: hidden;
          background: linear-gradient(112deg, #d8a72d, #bd66ba 53%, #6d28d9);
          padding: 88px 28px 96px;
        }
        .hero::before,
        .hero::after {
          content: "";
          position: absolute;
          z-index: -1;
          border-radius: 999px;
          pointer-events: none;
        }
        .hero::before {
          width: 420px;
          height: 420px;
          top: -270px;
          right: 8%;
          background: rgba(255, 255, 255, 0.2);
          filter: blur(3px);
        }
        .hero::after {
          width: 300px;
          height: 300px;
          left: -120px;
          bottom: -220px;
          background: rgba(71, 22, 143, 0.24);
        }
        .hero-inner {
          max-width: 1080px;
          margin: 0 auto;
          text-align: left;
        }
        h1 {
          color: #fff;
          font-size: clamp(38px, 6.5vw, 74px);
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
          margin: 0 0 30px;
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
          max-width: 1080px;
          margin: 0 auto;
          padding: 44px 28px 10px;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 16px;
        }
        .band {
          display: flex;
          align-items: center;
          justify-content: space-between;
          min-height: 168px;
          padding: 30px 34px;
          border: 1px solid var(--line);
          border-radius: 22px;
          text-decoration: none;
          transition: transform 0.18s ease, box-shadow 0.18s ease;
          box-shadow: 0 9px 26px var(--ob-shadow-soft);
        }
        .band:hover {
          transform: translateY(-3px);
          box-shadow: 0 18px 46px var(--ob-shadow);
        }
        .band h2 {
          font-size: clamp(30px, 4.4vw, 46px);
          margin: 0 0 4px;
          color: var(--green);
        }
        .band p {
          margin: 0 0 10px;
          font-size: 16px;
          color: rgba(38, 48, 42, 0.72);
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
        .arrow {
          font-size: 30px;
          color: var(--green);
          opacity: 0.6;
        }
        .band.clean {
          background: linear-gradient(100deg,#F6F1FF,#EDE4FB);
        }
        .band.handyman {
          background: linear-gradient(120deg, #fff7df 0%, #f8e9f7 56%, #eee7ff 100%);
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
            padding: 54px 16px 62px;
          }
          .bands {
            padding: 30px 16px 4px;
            grid-template-columns: 1fr;
          }
          .band {
            min-height: 130px;
            padding: 22px 22px;
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
            padding: 14px;
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
      `}</style>
    </div>
  );
}
