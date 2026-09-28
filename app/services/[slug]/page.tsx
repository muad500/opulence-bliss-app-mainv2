"use client";

// SETUP: mkdir -p "app/services/[slug]" && code "app/services/[slug]/page.tsx"
//
// Public cleaning service category page.

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { compareCleaningSessions } from "@/lib/cleaningBooking";

const supabase = createClient();

type Pkg = {
  id: string;
  name: string;
  description: string | null;
  inclusions: string[] | null;
  good_to_know: string[] | null;
  duration_minutes: number | null;
  service_type: string | null;
};

type Review = {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  service_label: string;
  customer_name: string;
  location: string | null;
  is_demo: boolean;
};

type ServiceFaq = { q: string; a: string };

const COPY: Record<
  string,
  {
    title: string;
    match: string;
    tagline: string;
    ticks: string[];
    proLink: string;
    proText: string;
    intro: string;
    faq: { q: string; a: string }[];
  }
> = {
  cleaning: {
    title: "Home Cleaning near you",
    match: "clean",
    tagline: "Put your feet up — we'll take care of the rest.",
    ticks: [
      "Approved, DBS-verified cleaners in your area",
      "One-off or regular cleaning",
      "All products and equipment included",
      "Book online 24/7 · visits finish by 8pm",
    ],
    proLink: "/provider/join",
    proText: "Become an Opulence cleaner",
    intro:
      "Book a cleaner who learns your home — your products, your preferences, your rhythm. Choose the session and frequency that work for you.",
    faq: [
      {
        q: "What is included in a standard clean?",
        a: "A standard clean includes dusting, vacuuming, mopping floors, cleaning bathrooms and kitchens, wiping accessible surfaces, emptying bins and general tidying.",
      },
      {
        q: "Can I choose which cleaning tasks are prioritised?",
        a: "Tasks can be agreed on before your appointment so we can focus on the areas that matter most to you.",
      },
      {
        q: "Do you offer deep cleaning?",
        a: "Yes. Deep cleaning is available for homes that need more detailed attention. This can include areas not normally covered during a standard clean, and is subject to the condition of the property and the time booked.",
      },
      {
        q: "Do you offer end-of-tenancy cleaning?",
        a: "Yes. We can provide end-of-tenancy cleaning to help prepare a property for handover. We recommend discussing the property’s size, condition and any specific requirements before booking so we can allow enough time.",
      },
      {
        q: "Can I add ironing or laundry?",
        a: "Yes. This can be requested as an additional cleaning service. Please let us know when booking so we can allow enough time.",
      },
      {
        q: "Do you clean windows?",
        a: "Interior window cleaning may be available as an additional service. Please ask when making your booking.",
      },
      {
        q: "Do cleaners bring products and equipment?",
        a: "This depends on the service and your booking. If you have preferred products or specific equipment, please let us know in advance. We will confirm what is required before the appointment.",
      },
      {
        q: "Can you clean homes with pets?",
        a: "Yes. We are happy to clean homes with pets. Please let us know about any pets when booking so we can take appropriate precautions.",
      },
    ],
  },
};

function ago(iso: string) {
  const days = Math.floor(
    (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24)
  );
  if (days < 1) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
  });
}

export default function ServicePage() {
  const copy = COPY.cleaning;

  const [items, setItems] = useState<Pkg[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  // Average and count of every customer rating for the service, including
  // private reviews, whose text stays hidden. Null until loaded.
  const [summary, setSummary] = useState<{ avg: number; count: number } | null>(null);
  const [faqs, setFaqs] = useState<ServiceFaq[]>([]);
  const [postcode, setPostcode] = useState("");
  const [open, setOpen] = useState<number | null>(0);

  // Which service the detail view is showing.
  const [picked, setPicked] = useState<string | null>(null);
  // Below this width the detail view behaves as a modal bottom sheet.
  const [isNarrow, setIsNarrow] = useState(false);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const lastTileRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 899px)");
    const sync = () => setIsNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("packages")
        .select(
          "id, name, description, inclusions, good_to_know, duration_minutes, service_type"
        )
        .eq("active", true)
        .eq("billing_type", "per_visit");

      const matching = ((data ?? []) as Pkg[]).filter((p) =>
        (p.service_type ?? "").includes(copy.match)
      );
      setItems(matching.sort(compareCleaningSessions));

      const [{ data: revs }, { data: curated }, { data: faqRows }, { data: summaryRows }] = await Promise.all([
        supabase
          .from("reviews")
          .select("id, rating, comment, created_at")
          .eq("reviewer", "client")
          .eq("visibility", "public")
          .order("created_at", { ascending: false })
          .limit(6),
        supabase
          .from("marketing_reviews")
          .select(
            "id, rating, comment, service_label, customer_name, location, reviewed_at, is_demo",
          )
          .eq("service_type", "cleaning")
          .eq("published", true)
          .order("sort_order", { ascending: true })
          .order("reviewed_at", { ascending: false })
          .limit(12),
        supabase
          .from("faqs")
          .select("question, answer")
          .eq("category", "cleaning")
          .eq("published", true)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true }),
        supabase.rpc("public_review_summary", { p_service_type: "cleaning" }),
      ]);

      const verified = (revs ?? []).map((review) => ({
        id: `verified-${review.id}`,
        rating: review.rating,
        comment: review.comment,
        created_at: review.created_at,
        service_label: "Home cleaning",
        customer_name: "",
        location: null,
        is_demo: false,
      }));
      const managed = (curated ?? []).map((review) => ({
        id: `managed-${review.id}`,
        rating: review.rating,
        comment: review.comment,
        created_at: review.reviewed_at,
        service_label: review.service_label,
        customer_name: review.customer_name,
        location: review.location,
        is_demo: review.is_demo,
      }));
      // Keep a small curated testimonial selection alongside, rather than in
      // place of, the public booking reviews. The complete feed stays linked.
      setReviews([...managed.slice(0, 3), ...verified]);
      const row = Array.isArray(summaryRows) ? summaryRows[0] : summaryRows;
      const count = Number(row?.rating_count ?? 0);
      setSummary(count > 0 ? { avg: Number(row.rating_avg), count } : { avg: 0, count: 0 });
      setFaqs(
        (faqRows ?? []).map((faq) => ({ q: faq.question, a: faq.answer })),
      );
    })();
  }, [copy.match]);

  // The headline score includes booking ratings and genuine admin-added
  // customer reviews; booking-backed copies are counted only once.
  const scoreCount = summary?.count ?? 0;
  const avg = scoreCount > 0 ? summary?.avg ?? null : null;

  const bookLink = `/book?type=${copy.match}${
    postcode ? `&pc=${encodeURIComponent(postcode)}` : ""
  }`;

  const POPULAR = "Essential Clean";
  const selected = items.find((i) => i.id === picked) ?? null;

  // Desktop always shows a panel, so pre-select rather than leave a gap.
  // Mobile opens nothing until the user taps.
  useEffect(() => {
    if (!items.length) return;
    if (isNarrow) return;
    setPicked((prev) =>
      prev && items.some((i) => i.id === prev)
        ? prev
        : (items.find((i) => i.name === POPULAR) ?? items[0]).id,
    );
  }, [items, isNarrow]);

  const closeSheet = useCallback(() => {
    setPicked(null);
    lastTileRef.current?.focus();
  }, []);

  // Sheet is modal on mobile only: lock the page behind it and wire Escape.
  useEffect(() => {
    if (!isNarrow || !selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeSheet();
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.classList.add("service-sheet-open");
    document.addEventListener("keydown", onKey);
    sheetRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.classList.remove("service-sheet-open");
      document.removeEventListener("keydown", onKey);
    };
  }, [isNarrow, selected, closeSheet]);

  return (
    <div className="page">
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap"
      />

      {/* ---------- HERO ---------- */}
      <header className="hero">
        <div className="inner hero-grid">
          <div>
            <h1>{copy.title}</h1>

            {avg !== null ? (
              <p className="stars">
                <span>{"★".repeat(Math.round(avg))}</span> {avg.toFixed(1)}/5 ·{" "}
                <a href="#reviews">
                  {scoreCount} rating{scoreCount === 1 ? "" : "s"}
                </a>
              </p>
            ) : (
              <p className="stars muted">New — be one of our first reviews</p>
            )}

            <p className="tagline">{copy.tagline}</p>

            <ul className="ticks">
              {copy.ticks.map((t) => (
                <li key={t}>{t}</li>
              ))}
              <li>
                <strong>Vetted cleaners across London</strong>
              </li>
            </ul>

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

            <div className="hero-actions">
              <a className="hero-btn primary" href="#cleaning-services">
                See our cleaning services
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    d="M8 3v9M4 8.5l4 4 4-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </a>
              <a className="hero-btn ghost" href={copy.proLink}>
                {copy.proText}
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    d="M3 8h9M8.5 4l4 4-4 4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </a>
            </div>
          </div>

          <div className="hero-art">
            <Image
              src="/cleaning-hero.webp"
              alt="Cleaner wiping a glass door in a bright home"
              fill
              priority
              sizes="(max-width: 900px) 100vw, 420px"
              style={{ objectFit: "cover", objectPosition: "center 40%" }}
            />
          </div>
        </div>
      </header>

      {/* ---------- SERVICES ---------- */}
      <section className="services" id="cleaning-services">
        <div className="inner">
          <h2>Our cleaning services</h2>
          <p className="intro">{copy.intro}</p>

          <div className="service-collection">
            {items.length === 0 ? (
              <p className="muted">Loading…</p>
            ) : (
              <div className="svc-layout">
                <ul className="tiles">
                  {items.map((pkg) => {
                    const active = picked === pkg.id;
                    return (
                      <li key={pkg.id}>
                        <button
                          type="button"
                          className={`tile${active ? " on" : ""}${
                            pkg.name === POPULAR ? " pop" : ""
                          }`}
                          aria-expanded={active}
                          aria-controls="svc-detail"
                          onClick={(e) => {
                            lastTileRef.current = e.currentTarget;
                            setPicked((prev) =>
                              prev === pkg.id && isNarrow ? null : pkg.id,
                            );
                          }}
                        >
                          {pkg.name === POPULAR && (
                            <span className="tile-pill">Popular</span>
                          )}
                          <span className="tile-name">{pkg.name}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>

                {isNarrow && selected && (
                  <div
                    className="sheet-backdrop"
                    onClick={closeSheet}
                    aria-hidden="true"
                  />
                )}

                {/* Fixed-height column. Panel content varies a lot between
                    services, so without a reserve the whole page below
                    shifts every time the selection changes. */}
                <div className="detail-col">
                  {selected && (
                    <div
                      id="svc-detail"
                      ref={sheetRef}
                      tabIndex={-1}
                      className="detail"
                      role={isNarrow ? "dialog" : undefined}
                      aria-modal={isNarrow ? true : undefined}
                      aria-label={isNarrow ? selected.name : undefined}
                    >
                      {isNarrow && (
                        <button
                          type="button"
                          className="sheet-close"
                          onClick={closeSheet}
                        >
                          Close
                        </button>
                      )}
                      <span className="detail-grip" aria-hidden="true" />
                      <div className="detail-body">
                        <h3>{selected.name}</h3>
                        <p className="detail-price">
                          <span>{selected.name === "Essential Clean" ? "Six-visit minimum · paid upfront · price shown when you book" : "Two-hour minimum · price shown when you book"}</span>
                        </p>
                        {selected.description && (
                          <p className="detail-desc">{selected.description}</p>
                        )}
                        {selected.inclusions && selected.inclusions.length > 0 && (
                          <>
                            <p className="detail-label">What&apos;s included</p>
                            <ul className="detail-list">
                              {selected.inclusions.map((x) => (
                                <li key={x}>{x}</li>
                              ))}
                            </ul>
                          </>
                        )}
                        {selected.good_to_know &&
                          selected.good_to_know.length > 0 && (
                            <>
                              <p className="detail-label">Good to know</p>
                              <ul className="detail-list subtle">
                                {selected.good_to_know.map((x) => (
                                  <li key={x}>{x}</li>
                                ))}
                              </ul>
                            </>
                          )}
                      </div>
                      <a className="btn detail-cta" href={bookLink}>
                        Book this
                      </a>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ---------- REASSURANCE ---------- */}
      <section className="business" id="business-cleaning">
        <div className="inner">
          <h2>Office cleaning and cleaning contracts</h2>
          <p>
            We also clean offices and take on regular cleaning contracts for
            businesses and property managers. These are priced individually,
            so they are quoted rather than booked online.
          </p>
          <p className="business-note">
            <strong>Email or call us for a quote:</strong>{" "}
            <a href="mailto:opulencebliss@gmail.com">opulencebliss@gmail.com</a>
            {" · "}
            <a href="tel:+447484717935">+44 7484 717935</a>
          </p>
        </div>
      </section>

      <section className="love">
        <div className="inner">
          <h2 className="center">You&apos;re going to love us</h2>
          <div className="cards3">
            {[
              [
                "We're thorough",
                "Every provider is approved, DBS-verified and rated by the people they've worked for.",
              ],
              [
                "We're flexible",
                "Cancel more than 48 hours before with no cancellation charge. Later cancellations may incur a charge under our policy.",
              ],
              [
                "We're fair",
                "One-time visits are charged after completion; regular plans are paid upfront. Providers are paid after their visits.",
              ],
            ].map(([t, s]) => (
              <div key={t} className="lovecard">
                <strong>{t}</strong>
                <p>{s}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- REVIEWS ---------- */}
      <section className="reviews" id="reviews">
        <div className="inner">
          <h2>Cleaning reviews</h2>

          {reviews.length === 0 ? (
            <div className="empty">
              No reviews yet. Every customer rates their visit, and they&apos;ll
              appear here as they come in.
            </div>
          ) : (
            <div className="reviews-layout">
              <aside className="review-summary">
                <div className="summary-score">
                  <strong>{avg?.toFixed(1) ?? "—"}</strong>
                  <span>/5</span>
                </div>
                <p>
                  {scoreCount > 0
                    ? `${scoreCount} customer rating${scoreCount === 1 ? "" : "s"} for cleaning`
                    : "Customer feedback on cleaning"}
                </p>
                <a href="#cleaning-services">Book your cleaning</a>
              </aside>

              <div className="review-feed">
                {reviews.map((review) => (
                  <article className="review-row" key={review.id}>
                    <div className="review-meta">
                      <span className="rstars" aria-label={`${review.rating} out of 5 stars`}>
                        {"★".repeat(review.rating)}
                        <i>{"☆".repeat(5 - review.rating)}</i>
                      </span>
                      <strong>{review.rating}/5</strong>
                      <span aria-hidden="true">·</span>
                      <span>{ago(review.created_at)}</span>
                      {review.is_demo && <em className="sample">Prototype sample</em>}
                    </div>
                    <h3>Cleaning: {review.service_label}</h3>
                    <p className="rtext">
                      {review.comment?.trim() || `Rated ${review.rating} out of 5.`}
                    </p>
                    {(review.customer_name || review.location) && (
                      <footer>
                        {review.customer_name}
                        {review.location ? ` (${review.location})` : ""}
                      </footer>
                    )}
                  </article>
                ))}
              </div>
              <a href="/reviews">Read all reviews</a>
            </div>
          )}
        </div>
      </section>

      {/* ---------- FAQ ---------- */}
      <section className="faq">
        <div className="inner">
          <h2>
            All about our cleaning service
          </h2>
          <div className="qs">
            {(faqs.length > 0 ? faqs : copy.faq).map((f, i) => (
              <div key={f.q} className={open === i ? "q open" : "q"}>
                <button onClick={() => setOpen(open === i ? null : i)}>
                  <span>{f.q}</span>
                  <em>{open === i ? "−" : "+"}</em>
                </button>
                {open === i && <p>{f.a}</p>}
              </div>
            ))}
          </div>
        </div>
      </section>

      <style jsx>{`
        .page {
          --cream: #ffffff;
          --green: #16202A;
          --green-pale: #F4ECFE;
          --apricot: #F5C542;
          --apricot-deep: #6D28D9;
          --ink: #16202A;
          --muted: #7A828C;
          --line: #EDEFF1;
          background: var(--cream);
          color: var(--ink);
          font-family: "Nunito", system-ui, sans-serif;
          padding-bottom: 40px;
        }
        .inner {
          max-width: 1040px;
          margin: 0 auto;
          padding: 0 28px;
        }
        h1,
        h2,
        h3 {
          font-family: "Nunito", system-ui, sans-serif;
          font-weight: 900;
          color: var(--green);
        }
        .center {
          text-align: center;
        }
        .muted {
          color: var(--muted);
        }

        /* bars */
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
          font-size: 23px;
          font-weight: 600;
          color: var(--green);
          text-decoration: none;
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
        .servicenav a.on {
          color: var(--apricot-deep);
          border-bottom-color: var(--apricot-deep);
        }

        /* hero */
        .hero {
          background: linear-gradient(120deg,#FFF8E6,#F6F1FF 55%,#EDE4FB);
          padding: 52px 0 58px;
        }
        .hero-grid {
          display: grid;
          grid-template-columns: 1.25fr 0.75fr;
          gap: 40px;
          align-items: center;
        }
        h1 {
          font-size: clamp(30px, 5vw, 50px);
          line-height: 1.05;
          margin: 0 0 8px;
        }
        .stars {
          margin: 0 0 16px;
          font-size: 15px;
        }
        .stars span {
          color: var(--apricot-deep);
          letter-spacing: 2px;
        }
        .stars a {
          color: var(--green);
          text-decoration: underline;
        }
        .tagline {
          font-family: "Nunito", system-ui, sans-serif;
          font-size: 19px;
          color: var(--green);
          margin: 0 0 20px;
        }
        .ticks {
          list-style: none;
          padding: 0;
          margin: 0 0 26px;
          display: grid;
          gap: 9px;
        }
        .ticks li {
          font-size: 16px;
          padding-left: 28px;
          position: relative;
        }
        .ticks li::before {
          content: "✓";
          position: absolute;
          left: 0;
          color: var(--green);
          font-weight: 700;
        }
        .composer {
          display: flex;
          gap: 10px;
          background: #fff;
          border-radius: 999px;
          padding: 7px 7px 7px 22px;
          max-width: 480px;
          box-shadow: 0 10px 30px rgba(22,32,42, 0.12);
        }
        .composer input {
          flex: 1;
          border: none;
          outline: none;
          font: inherit;
          font-size: 16px;
          background: transparent;
          text-transform: uppercase;
          min-width: 0;
          color: var(--ink);
        }
        .btn {
          background: linear-gradient(100deg,#F5C542,#C86FC9 55%,#7B2FF7);
          color: #fff;
          text-decoration: none;
          border-radius: 999px;
          padding: 13px 24px;
          font-weight: 700;
          font-size: 15px;
          white-space: nowrap;
          display: inline-block;
        }
        .btn:hover {
          filter: brightness(1.06);
        }
        .btn.ghost {
          background: transparent;
          color: var(--green);
          border: 1.5px solid var(--green);
          margin-top: auto;
          text-align: center;
        }
        .btn.wide {
          display: block;
          text-align: center;
          background: var(--apricot-deep);
          max-width: 480px;
          margin: 0 auto;
        }
        .hero-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-top: 20px;
        }
        .hero-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 9px;
          min-height: 46px;
          padding: 12px 22px;
          border-radius: 999px;
          font-size: 15px;
          font-weight: 800;
          text-decoration: none;
          white-space: nowrap;
          transition: background 0.15s ease, color 0.15s ease,
            border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .hero-btn svg {
          flex: 0 0 auto;
          width: 15px;
          height: 15px;
          transition: transform 0.15s ease;
        }
        .hero-btn.primary {
          border: 1.5px solid var(--apricot-deep);
          background: var(--apricot-deep);
          color: #fff;
        }
        .hero-btn.ghost {
          border: 1.5px solid var(--line);
          background: #fff;
          color: var(--ink);
        }
        .hero-btn:focus-visible {
          outline: 3px solid rgba(109, 40, 217, 0.4);
          outline-offset: 3px;
        }
        @media (hover: hover) and (pointer: fine) {
          .hero-btn.primary:hover {
            box-shadow: 0 8px 22px rgba(109, 40, 217, 0.28);
          }
          .hero-btn.primary:hover svg {
            transform: translateY(2px);
          }
          .hero-btn.ghost:hover {
            border-color: var(--apricot-deep);
            color: var(--apricot-deep);
          }
          .hero-btn.ghost:hover svg {
            transform: translateX(3px);
          }
        }
        @media (max-width: 520px) {
          .hero-actions {
            flex-direction: column;
          }
          .hero-btn {
            width: 100%;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .hero-btn,
          .hero-btn svg {
            transition: none;
          }
        }
        .hero-art {
          position: relative;
          overflow: hidden;
          aspect-ratio: 4 / 5;
          border-radius: 20px;
          box-shadow: 0 18px 48px rgba(76, 29, 149, 0.14);
        }

        .business {
          padding: 56px 0 8px;
        }
        .business h2 {
          margin: 0 0 10px;
          font-size: clamp(24px, 3.2vw, 30px);
          font-weight: 900;
          line-height: 1.15;
        }
        .business p {
          max-width: 64ch;
          margin: 0;
          color: #4a5260;
          line-height: 1.6;
        }
        .business .business-note {
          margin-top: 16px;
          padding: 14px 18px;
          border-radius: 14px;
          background: #f5f0ff;
          color: #16202a;
        }
        .business-note a {
          color: #6d28d9;
          font-weight: 800;
          text-decoration: none;
        }
        /* love */
        .love {
          padding: 62px 0 10px;
        }
        h2 {
          font-size: clamp(26px, 3.6vw, 36px);
          margin: 0 0 24px;
        }
        .cards3 {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 18px;
        }
        .lovecard {
          background: #fff;
          border: 1px solid var(--line);
          border-radius: 16px;
          padding: 24px 22px;
        }
        .lovecard strong {
          display: block;
          font-family: "Nunito", system-ui, sans-serif;
          font-size: 19px;
          color: var(--green);
          margin-bottom: 6px;
        }
        .lovecard p {
          margin: 0;
          color: var(--muted);
          font-size: 14.5px;
          line-height: 1.55;
        }

        /* reviews */
        .reviews {
          padding: 40px 0 10px;
        }
        .reviews-layout {
          display: grid;
          grid-template-columns: minmax(190px, 0.3fr) minmax(0, 1fr);
          gap: clamp(18px, 3vw, 36px);
          padding: clamp(18px, 2.5vw, 28px);
          border: 1px solid #eadffc;
          border-radius: 24px;
          background: linear-gradient(145deg, #fffdf7 0%, #fff8fb 48%, #f6f1ff 100%);
          box-shadow: 0 18px 45px rgba(72, 40, 118, 0.06);
        }
        .review-summary {
          align-self: start;
          position: sticky;
          top: 24px;
        }
        .summary-score {
          display: flex;
          align-items: baseline;
          color: #efad17;
          line-height: 1;
        }
        .summary-score strong {
          font-size: clamp(48px, 6vw, 62px);
          font-weight: 1000;
          letter-spacing: -0.07em;
        }
        .summary-score span {
          margin-left: 6px;
          font-size: clamp(24px, 2.5vw, 34px);
          font-weight: 950;
        }
        .review-summary p {
          max-width: 24ch;
          margin: 10px 0;
          color: var(--ink);
          font-size: 17px;
          font-weight: 750;
          line-height: 1.45;
        }
        .review-summary a {
          color: var(--apricot-deep);
          font-weight: 900;
          text-underline-offset: 4px;
        }
        .review-feed {
          min-width: 0;
        }
        .review-row {
          padding: 0 0 16px;
          border-bottom: 1px solid #e7dfec;
        }
        .review-row + .review-row {
          padding-top: 16px;
        }
        .review-row:last-child {
          padding-bottom: 0;
          border-bottom: 0;
        }
        .review-meta {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 7px;
          color: var(--muted);
          font-size: 13px;
        }
        .rstars {
          color: #f4bd00;
          letter-spacing: 1px;
          font-size: 20px;
          line-height: 1;
        }
        .rstars i {
          color: #ddd5c1;
          font-style: normal;
        }
        .review-meta > strong {
          color: var(--ink);
          font-size: 14px;
        }
        .review-meta em {
          padding: 3px 8px;
          border-radius: 999px;
          background: #e9f7ef;
          color: #177a4f;
          font-size: 10px;
          font-style: normal;
          font-weight: 900;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .review-meta em.sample {
          background: #f2eaff;
          color: #6d28d9;
        }
        .review-row h3 {
          margin: 7px 0 6px;
          font-size: 14px;
          font-weight: 950;
        }
        .rtext {
          margin: 0 0 8px;
          font-size: 16px;
          line-height: 1.6;
          color: var(--ink);
        }
        .review-row footer {
          font-size: 13.5px;
          color: var(--muted);
        }
        .empty {
          background: #fff;
          border: 1.5px dashed #E5E7EA;
          border-radius: 14px;
          padding: 28px 24px;
          color: var(--muted);
          text-align: center;
        }

        /* services */
        .services {
          padding: 62px 0 10px;
          scroll-margin-top: 24px;
        }
        .service-collection {
          position: relative;
        }
        .intro {
          color: #3A424B;
          font-size: 16.5px;
          line-height: 1.6;
          max-width: 62ch;
          margin: -8px 0 26px;
        }
        h3 {
          font-size: 21px;
          margin: 0 0 6px;
        }
        /* Grid of compact tiles on the left, detail view on the right.
           Below 900px the detail becomes a modal bottom sheet instead. */
        .svc-layout {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 340px;
          gap: 24px;
          align-items: stretch;
        }
        /* The panel is absolutely positioned inside this column, so its
           content height never feeds back into the row height. The row is
           pinned by the reserve below, which keeps everything further down
           the page still when the selection changes. */
        .detail-col {
          position: relative;
          min-width: 0;
          min-height: 660px;
        }
        .tiles {
          /* The row stretches to the reserved panel height; the tiles must
             not, or they inflate to fill it. */
          align-self: start;
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
          grid-auto-rows: 1fr;
          gap: 12px;
          margin: 0;
          padding: 0;
          list-style: none;
        }
        .tiles > li {
          display: grid;
          min-width: 0;
        }
        .tile {
          position: relative;
          display: flex;
          flex-direction: column;
          gap: 4px;
          width: 100%;
          min-width: 0;
          min-height: 122px;
          padding: 16px 14px 14px;
          border: 1.5px solid var(--line);
          border-radius: 16px;
          background: linear-gradient(145deg, #fff9e9 0%, #fff5f7 52%, #f3edff 100%);
          color: var(--ink);
          font: inherit;
          text-align: left;
          cursor: pointer;
          transition: border-color 0.15s ease, box-shadow 0.15s ease,
            transform 0.15s ease;
        }
        .tile.pop {
          border-color: var(--apricot);
        }
        .tiles > li:nth-child(3n + 2) .tile {
          background: linear-gradient(145deg, #fff7ee 0%, #faefff 58%, #eee8ff 100%);
        }
        .tiles > li:nth-child(3n) .tile {
          background: linear-gradient(145deg, #fff4f5 0%, #f7edff 55%, #ebe7ff 100%);
        }
        .tile.on {
          border-color: var(--apricot-deep);
          box-shadow: 0 0 0 2px rgba(109, 40, 217, 0.16);
        }
        .tile:focus-visible {
          outline: 3px solid rgba(109, 40, 217, 0.35);
          outline-offset: 2px;
        }
        /* Hover effects only where a real pointer exists, so phones never
           get stuck in a half-applied hover state after a tap. */
        @media (hover: hover) and (pointer: fine) {
          .tile:hover {
            border-color: var(--apricot-deep);
            transform: translateY(-2px);
          }
        }
        .tile-name {
          font-size: 14.5px;
          font-weight: 800;
          line-height: 1.25;
          overflow-wrap: anywhere;
        }
        .tile-pill {
          position: absolute;
          top: -9px;
          right: 10px;
          padding: 3px 9px;
          border-radius: 999px;
          background: var(--apricot-deep);
          color: #fff;
          font-size: 9.5px;
          font-weight: 800;
          letter-spacing: 0.07em;
          text-transform: uppercase;
        }
        .detail {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          min-width: 0;
          padding: 22px 22px 24px;
          border: 1.5px solid var(--line);
          border-top: 4px solid var(--apricot-deep);
          border-radius: 18px;
          background: linear-gradient(155deg, #fffdf8 0%, #fbf4ff 58%, #f1ecff 100%);
          box-shadow: 0 14px 38px rgba(22, 32, 42, 0.08);
        }
        .detail:focus {
          outline: none;
        }
        /* Only this scrolls, so the CTA below can never scroll out of reach. */
        .detail-body {
          flex: 1 1 auto;
          min-height: 0;
          overflow-y: auto;
          overscroll-behavior: contain;
        }
        .detail-cta {
          flex: 0 0 auto;
          align-self: flex-start;
          margin-top: 16px;
        }
        .detail-grip {
          display: none;
        }
        .detail-price {
          margin: 0 0 14px;
          font-size: 13px;
          font-weight: 700;
          line-height: 1.4;
        }
        .detail-price span {
          /* Own line, so "2-hour minimum" never orphans a word in the
             narrow desktop panel. */
          display: block;
          margin-top: 2px;
          font-size: 13px;
          font-weight: 700;
          color: var(--muted);
        }
        .detail-desc {
          margin: 0 0 16px;
          color: var(--muted);
          font-size: 14.5px;
          line-height: 1.55;
        }
        .detail-label {
          margin: 0 0 8px;
          color: var(--apricot-deep);
          font-size: 11px;
          font-weight: 900;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }
        .detail-list {
          display: grid;
          gap: 7px;
          margin: 0 0 18px;
          padding: 0;
          list-style: none;
        }
        .detail-list li {
          position: relative;
          padding-left: 18px;
          font-size: 14px;
          line-height: 1.45;
          overflow-wrap: anywhere;
        }
        .detail-list li::before {
          content: "·";
          position: absolute;
          left: 5px;
          color: var(--apricot-deep);
          font-weight: 700;
        }
        .detail-list.subtle li {
          color: var(--muted);
          font-size: 13.5px;
        }
        .sheet-backdrop,
        .sheet-close {
          display: none;
        }

        /* faq */
        .faq {
          padding: 62px 0 20px;
        }
        .qs {
          display: grid;
          gap: 10px;
          max-width: 760px;
        }
        .q {
          background: #fff;
          border: 1px solid var(--line);
          border-radius: 14px;
          overflow: hidden;
        }
        .q.open {
          border-color: var(--apricot);
        }
        .q button {
          width: 100%;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 14px;
          background: none;
          border: none;
          padding: 18px 20px;
          font: inherit;
          font-size: 16px;
          font-weight: 600;
          color: var(--green);
          text-align: left;
          cursor: pointer;
        }
        .q em {
          font-style: normal;
          font-size: 21px;
          color: var(--apricot-deep);
        }
        .q p {
          margin: 0;
          padding: 0 20px 20px;
          color: #3A424B;
          font-size: 15.5px;
          line-height: 1.6;
        }


        @media (max-width: 900px) {
          .hero-grid {
            grid-template-columns: 1fr;
          }
          .hero-art {
            width: min(100%, 480px);
            margin: 0 auto;
          }
          .cards3 {
            grid-template-columns: 1fr;
          }
          .reviews-layout {
            grid-template-columns: 1fr;
            gap: 20px;
          }
          .review-summary {
            position: static;
            display: grid;
            grid-template-columns: auto minmax(0, 1fr);
            column-gap: 22px;
            align-items: center;
          }
          .review-summary p {
            margin: 0;
          }
          .review-summary a {
            grid-column: 1 / -1;
            margin-top: 12px;
          }
        }
        /* Detail becomes a modal bottom sheet. Matches the 899px
           matchMedia query that switches the ARIA role in the component. */
        @media (max-width: 899px) {
          .svc-layout {
            grid-template-columns: minmax(0, 1fr);
          }
          .tiles {
            /* Tablets fit more than two; phones fall to two on their own. */
            grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
            gap: 10px;
          }
          .tile {
            min-height: 116px;
            padding: 15px 13px 13px;
          }
          .sheet-backdrop {
            position: fixed;
            inset: 0;
            z-index: 80;
            display: block;
            background: rgba(22, 32, 42, 0.45);
            animation: sheet-fade 0.18s ease-out;
          }
          .detail-col {
            position: static;
            min-height: 0;
          }
          .detail-body {
            flex: none;
            overflow: visible;
          }
          .detail {
            position: fixed;
            inset: auto 0 0 0;
            z-index: 81;
            max-height: 84vh;
            max-height: 84dvh;
            overflow-y: auto;
            -webkit-overflow-scrolling: touch;
            padding: 12px 18px calc(22px + env(safe-area-inset-bottom));
            border: 0;
            border-top: 4px solid var(--apricot-deep);
            border-radius: 20px 20px 0 0;
            box-shadow: 0 -12px 40px rgba(22, 32, 42, 0.22);
            animation: sheet-up 0.22s ease-out;
          }
          .detail h3 {
            /* Keep clear of the Close button. */
            padding-right: 84px;
          }
          .detail-grip {
            display: block;
            width: 42px;
            height: 4px;
            margin: 0 auto 14px;
            border-radius: 999px;
            background: var(--line);
          }
          .sheet-close {
            position: absolute;
            top: 14px;
            right: 14px;
            display: block;
            padding: 6px 12px;
            border: 1.5px solid var(--line);
            border-radius: 999px;
            background: #fff;
            color: var(--ink);
            font: inherit;
            font-size: 13px;
            font-weight: 800;
            cursor: pointer;
          }
        }
        @keyframes sheet-up {
          from {
            transform: translateY(14px);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
        @keyframes sheet-fade {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .tile,
          .detail,
          .sheet-backdrop {
            transition: none;
            animation: none;
          }
        }
        @media (max-width: 620px) {
          .reviews-layout {
            padding: 18px;
            border-radius: 19px;
          }
          .review-summary {
            display: block;
          }
          .review-summary p {
            margin: 12px 0;
          }
          .review-row + .review-row {
            padding-top: 16px;
          }
          .review-row {
            padding-bottom: 16px;
          }
          .tiles {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .inner,
          .topbar,
          .servicenav {
            padding-left: 16px;
            padding-right: 16px;
          }
          .servicenav {
            gap: 20px;
          }
          .composer {
            flex-direction: column;
            border-radius: 18px;
            padding: 14px;
          }
        }
      `}</style>
    </div>
  );
}
