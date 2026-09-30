"use client";

import Link from "next/link";
import Image from "next/image";
import {
  Armchair,
  Drill,
  Hammer,
  Move,
  PaintRoller,
  Wrench,
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

type HandymanFaq = { id: string; question: string; answer: string };
type CustomerProfile = {
  full_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  postcode: string | null;
};
type QuoteAccess = "loading" | "signed_out" | "customer" | "wrong_role";

const TASKS = [
  { name: "Mounting and hanging", note: "Pictures, mirrors, shelves and TVs", icon: Drill },
  { name: "Furniture assembly", note: "Flat-pack furniture and installations", icon: Armchair },
  { name: "Minor repairs", note: "Everyday fixes and small maintenance jobs", icon: Hammer },
  { name: "Curtains and blinds", note: "Rails, blinds and curtain installation", icon: Wrench },
  { name: "Furniture moving", note: "Help repositioning furniture at home", icon: Move },
  { name: "Minor decorating", note: "Small touch-ups and minor decorating", icon: PaintRoller },
] as const;

const TASK_OPTIONS = [
  ...TASKS.map((task) => ({ value: task.name, label: task.name })),
  { value: "Other", label: "Other" },
];

export default function HandymanPage() {
  const [taskType, setTaskType] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const [faqs, setFaqs] = useState<HandymanFaq[]>([]);
  const [quoteAccess, setQuoteAccess] = useState<QuoteAccess>("loading");
  const [customer, setCustomer] = useState<CustomerProfile | null>(null);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from("faqs")
        .select("id, question, answer")
        .eq("category", "handyman")
        .eq("published", true)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      setFaqs((data ?? []) as HandymanFaq[]);
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setQuoteAccess("signed_out");
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("role, full_name, email, phone, address, postcode")
        .eq("id", user.id)
        .maybeSingle();
      if (profile?.role !== "customer") {
        setQuoteAccess("wrong_role");
        return;
      }
      setCustomer({
        full_name: profile.full_name,
        email: profile.email ?? user.email ?? null,
        phone: profile.phone,
        address: profile.address,
        postcode: profile.postcode,
      });
      setQuoteAccess("customer");
    })();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (quoteAccess !== "customer") {
      setError("Sign in with a customer account before requesting a quote.");
      return;
    }
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/handyman-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: form.get("fullName"),
          email: form.get("email"),
          phone: form.get("phone"),
          address: form.get("address"),
          postcode: form.get("postcode"),
          taskType: form.get("taskType"),
          description: form.get("description"),
          preferredDate: form.get("preferredDate"),
          preferredTime: form.get("preferredTime"),
          consentAccepted: form.get("consentAccepted") === "on",
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not send your quote request.");
      setReference(data.reference);
      event.currentTarget.reset();
      setTaskType("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not send your quote request.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <header className="hero">
        <div className="inner heroGrid">
          <div>
            <p className="eyebrow">Handyman services across London</p>
            <h1>Tell us what needs doing. We&apos;ll arrange the right quote.</h1>
            <p className="lede">
              Repairs, assembly, mounting, minor decorating and practical help around
              your home from trusted professionals.
            </p>
            <a className="primary" href="#quote">Request a quote</a>
          </div>
          <div className="heroVisual">
            <div className="heroPhoto">
              <Image
                src="/handyman-hero.webp"
                alt="Handyman preparing tools for work in a home"
                fill
                priority
                sizes="(max-width: 900px) 100vw, 560px"
                style={{ objectFit: "cover", objectPosition: "center 45%" }}
              />
            </div>
            <div className="heroCard">
              <Hammer size={32} strokeWidth={1.7} />
              <strong>No automatic price or payment</strong>
              <span>
                We review the work first and send a tailored quotation before
                anything is agreed or charged.
              </span>
            </div>
          </div>
        </div>
      </header>

      <nav className="mobileCta mobile-service-cta" aria-label="Handyman quick actions">
        <a className="mobileCtaServices" href="#handyman-services">See our services</a>
        <a className="mobileCtaQuote" href="#quote">Request a quote</a>
      </nav>

      <section className="inner services" aria-labelledby="handyman-services">
        <p className="eyebrow">What we can help with</p>
        <h2 id="handyman-services">Handyman services</h2>
        <div className="taskGrid">
          {TASKS.map(({ name, note, icon: Icon }) => (
            <button
              type="button"
              key={name}
              className={taskType === name ? "task selected" : "task"}
              onClick={() => {
                setTaskType(name);
                document.getElementById("quote")?.scrollIntoView({ behavior: "smooth" });
              }}
            >
              <Icon size={23} strokeWidth={1.8} />
              <span>
                <strong>{name}</strong>
                <small>{note}</small>
              </span>
            </button>
          ))}
        </div>
      </section>

      {faqs.length > 0 && (
        <section className="faqBand" aria-labelledby="handyman-faqs">
          <div className="inner faqGrid">
            <div>
              <p className="eyebrow">Before you request a quote</p>
              <h2 id="handyman-faqs">Handyman questions</h2>
              <p className="faqIntro">
                Useful details about jobs, materials, assembly and specialist work.
              </p>
            </div>
            <div className="faqList">
              {faqs.map((faq) => (
                <details key={faq.id}>
                  <summary>{faq.question}</summary>
                  <p>{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="quoteBand" id="quote">
        <div className="inner quoteGrid">
          <div className="quoteIntro">
            <p className="eyebrow">Tailored quotation</p>
            <h2>Request your handyman quote</h2>
            <p>
              Describe the task and your preferred timing. The team will review
              the scope and contact you before confirming the work.
            </p>
            <ol>
              <li><span>1</span> Send the job details</li>
              <li><span>2</span> We review the scope</li>
              <li><span>3</span> Receive and approve your quote</li>
            </ol>
          </div>

          {quoteAccess === "loading" ? (
            <div className="accessGate" aria-live="polite">
              <span className="gateMark">•••</span>
              <h2>Checking your account</h2>
              <p>This takes just a moment.</p>
            </div>
          ) : quoteAccess === "signed_out" ? (
            <div className="accessGate">
              <span className="gateMark">✓</span>
              <h2>Sign in to request a quote</h2>
              <p>
                Handyman quotations are available to registered Opulence Bliss
                customers so every request stays linked to the correct account.
              </p>
              <div className="gateActions">
                <Link href="/login?next=%2Fservices%2Fhandyman%23quote">Sign in</Link>
                <Link className="secondary" href="/auth/sign-up?next=%2Fservices%2Fhandyman%23quote">
                  Create an account
                </Link>
              </div>
            </div>
          ) : quoteAccess === "wrong_role" ? (
            <div className="accessGate">
              <span className="gateMark">!</span>
              <h2>A customer account is required</h2>
              <p>
                This quotation form cannot be submitted from a professional or
                administrator account. Sign in with your customer account instead.
              </p>
              <Link className="gateSingle" href="/login?next=%2Fservices%2Fhandyman%23quote">
                Go to customer sign in
              </Link>
            </div>
          ) : reference ? (
            <div className="success" role="status">
              <span>✓</span>
              <h2>Quote request received</h2>
              <p>Your reference is <strong>{reference}</strong>.</p>
              <p>We&apos;ll contact you after the job details have been reviewed.</p>
              <button type="button" onClick={() => setReference(null)}>Send another request</button>
            </div>
          ) : (
            <form className="quoteForm" onSubmit={submit}>
              <div className="two">
                <label>Full name<input name="fullName" autoComplete="name" defaultValue={customer?.full_name ?? ""} required /></label>
                <label>Email<input name="email" type="email" autoComplete="email" defaultValue={customer?.email ?? ""} required /></label>
              </div>
              <div className="two">
                <label>Phone<input name="phone" type="tel" autoComplete="tel" defaultValue={customer?.phone ?? ""} required /></label>
                <label>Postcode<input name="postcode" autoComplete="postal-code" defaultValue={customer?.postcode ?? ""} required /></label>
              </div>
              <label>Service address<input name="address" autoComplete="street-address" defaultValue={customer?.address ?? ""} required /></label>
              <label>
                What do you need help with?
                <select
                  name="taskType"
                  value={taskType}
                  onChange={(event) => setTaskType(event.target.value)}
                  required
                >
                  <option value="">Choose a task</option>
                  {TASK_OPTIONS.map((task) => (
                    <option key={task.value} value={task.value}>{task.label}</option>
                  ))}
                </select>
              </label>
              <label>
                Describe the work
                <textarea
                  name="description"
                  rows={5}
                  maxLength={2000}
                  placeholder="Tell us what needs doing, quantities, measurements and anything we should know."
                  required
                />
              </label>
              <div className="two">
                <label>Preferred date (optional)<input name="preferredDate" type="date" min={new Date().toISOString().slice(0, 10)} /></label>
                <label>
                  Preferred time (optional)
                  <select name="preferredTime" defaultValue="">
                    <option value="">Flexible</option>
                    <option>Morning</option>
                    <option>Afternoon</option>
                    <option>Evening</option>
                  </select>
                </label>
              </div>
              <label className="consent">
                <input name="consentAccepted" type="checkbox" required />
                <span>
                  I have read and accept the <Link href="/legal/handyman-terms">Handyman Services Terms</Link>,{" "}
                  <Link href="/legal/terms">Terms &amp; Conditions</Link>,{" "}
                  <Link href="/legal/privacy">Privacy Policy</Link> and{" "}
                  <Link href="/legal/cancellation-refund">Cancellation &amp; Refund Policy</Link>.
                </span>
              </label>
              {error && <p className="error" role="alert">{error}</p>}
              <button className="submit" type="submit" disabled={busy}>
                {busy ? "Sending request…" : "Send quote request"}
              </button>
              <p className="finePrint">No payment is taken when you request a quote.</p>
            </form>
          )}
        </div>
      </section>

      <style jsx>{`
        .page { color:#16202a; font-family:"Nunito",system-ui,sans-serif; }
        .inner { width:min(1120px,calc(100% - 40px)); margin:0 auto; }
        .hero { overflow:hidden; padding:72px 0; background:linear-gradient(120deg,#fff5d8 0%,#f8eaf8 52%,#eee7ff 100%); }
        .heroGrid { display:grid; grid-template-columns:minmax(0,1.05fr) minmax(0,.95fr); gap:40px; align-items:center; }
        .eyebrow { margin:0 0 9px; color:#6d28d9; font-size:12px; font-weight:900; letter-spacing:.13em; text-transform:uppercase; }
        h1 { max-width:780px; margin:0 0 18px; font-size:clamp(38px,6vw,66px); font-weight:900; letter-spacing:-.035em; line-height:1.02; }
        h2 { margin:0 0 16px; font-size:clamp(28px,4vw,40px); font-weight:900; line-height:1.1; }
        .lede { max-width:650px; margin:0 0 26px; color:#58616d; font-size:18px; line-height:1.6; }
        .primary,.submit { display:inline-flex; justify-content:center; padding:14px 24px; border:0; border-radius:999px; background:linear-gradient(100deg,#f5c542,#c86fc9 55%,#7b2ff7); color:#fff; box-shadow:0 9px 24px rgba(109,40,217,.2); font:inherit; font-weight:900; text-decoration:none; cursor:pointer; }
        .heroVisual { display:grid; gap:14px; }
        .heroPhoto { position:relative; overflow:hidden; aspect-ratio:4/3; border-radius:24px; box-shadow:0 18px 48px rgba(76,29,149,.14); }
        .heroCard { display:grid; gap:7px; padding:20px 22px; border:1px solid rgba(109,40,217,.17); border-radius:20px; background:rgba(255,255,255,.78); box-shadow:0 18px 48px rgba(76,29,149,.12); }
        .heroCard svg { color:#6d28d9; }
        .heroCard strong { font-size:19px; }
        .heroCard span { color:#68717d; line-height:1.55; }
        .mobileCta { display:none; }
        .services { padding-top:72px; padding-bottom:78px; }
        #handyman-services { scroll-margin-top:90px; }
        .taskGrid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; margin-top:28px; }
        .task { display:flex; align-items:flex-start; gap:13px; min-height:118px; padding:20px; border:1.5px solid #e8e3ef; border-radius:18px; background:linear-gradient(145deg,#fffaf0,#f8f0ff); color:#16202a; font:inherit; text-align:left; cursor:pointer; }
        .task:nth-child(3n+2) { background:linear-gradient(145deg,#fff6f3,#f1ecff); }
        .task:nth-child(3n) { background:linear-gradient(145deg,#faf2ff,#ece8ff); }
        .task.selected { border-color:#6d28d9; box-shadow:0 0 0 3px rgba(109,40,217,.12); }
        .task svg { flex:0 0 auto; color:#6d28d9; }
        .task span { display:grid; gap:5px; }
        .task strong { font-size:16px; font-weight:900; }
        .task small { color:#68717d; font-size:13px; line-height:1.4; }
        .faqBand { padding:72px 0; border-top:1px solid #eee9f3; background:linear-gradient(145deg,#fffdf8,#fff8fb 52%,#f6f0ff); }
        .faqGrid { display:grid; grid-template-columns:minmax(230px,.62fr) minmax(0,1.38fr); gap:52px; align-items:start; }
        .faqIntro { margin:0; color:#68717d; line-height:1.6; }
        .faqList { display:grid; gap:10px; }
        .faqList details { border:1px solid #e3deea; border-radius:15px; background:rgba(255,255,255,.9); }
        .faqList summary { display:flex; align-items:center; justify-content:space-between; gap:15px; padding:18px 20px; font-weight:900; cursor:pointer; list-style:none; }
        .faqList summary::-webkit-details-marker { display:none; }
        .faqList summary::after { content:"+"; color:#6d28d9; font-size:23px; line-height:1; }
        .faqList details[open] summary::after { content:"−"; }
        .faqList details p { margin:0; padding:0 20px 19px; color:#68717d; line-height:1.65; white-space:pre-line; }
        .quoteBand { padding:76px 0 88px; background:#f8f5fc; scroll-margin-top:24px; }
        .quoteGrid { display:grid; grid-template-columns:minmax(250px,.72fr) minmax(0,1.28fr); gap:54px; align-items:start; }
        .quoteIntro > p:not(.eyebrow) { color:#68717d; line-height:1.6; }
        .quoteIntro ol { display:grid; gap:16px; margin:30px 0 0; padding:0; list-style:none; }
        .quoteIntro li { display:flex; align-items:center; gap:11px; font-weight:800; }
        .quoteIntro li span { display:grid; width:32px; height:32px; place-items:center; border-radius:50%; background:#ede4fb; color:#6d28d9; }
        .quoteForm,.success,.accessGate { display:grid; gap:15px; padding:28px; border:1px solid #e6e0ec; border-radius:24px; background:#fff; box-shadow:0 16px 45px rgba(51,35,75,.09); }
        .two { display:grid; grid-template-columns:1fr 1fr; gap:13px; }
        label { display:grid; gap:7px; color:#3f4652; font-size:13px; font-weight:900; }
        input,select,textarea { width:100%; box-sizing:border-box; min-height:46px; padding:11px 13px; border:1.5px solid #dde1e7; border-radius:12px; background:#fff; color:#16202a; font:inherit; font-size:16px; }
        textarea { resize:vertical; line-height:1.5; }
        input:focus-visible,select:focus-visible,textarea:focus-visible { outline:none; border-color:#6d28d9; box-shadow:0 0 0 3px rgba(109,40,217,.1); }
        .consent { display:flex; align-items:flex-start; gap:10px; font-weight:700; line-height:1.45; }
        .consent input { flex:0 0 auto; width:18px; min-height:18px; margin-top:2px; }
        .consent a { color:#6d28d9; }
        .submit { width:100%; font-size:16px; }
        .submit:disabled { opacity:.65; cursor:wait; }
        .error { margin:0; padding:12px 14px; border-radius:12px; background:#ffe9ed; color:#a92f47; font-weight:800; }
        .finePrint { margin:-5px 0 0; color:#7a828c; font-size:12.5px; text-align:center; }
        .success { justify-items:start; }
        .success > span { display:grid; width:48px; height:48px; place-items:center; border-radius:50%; background:#e3f7ec; color:#138454; font-size:24px; font-weight:900; }
        .success p { margin:0; color:#68717d; }
        .success button { margin-top:8px; padding:11px 18px; border:1.5px solid #6d28d9; border-radius:999px; background:#fff; color:#6d28d9; font:inherit; font-weight:900; cursor:pointer; }
        .accessGate { min-height:320px; align-content:center; justify-items:center; text-align:center; }
        .accessGate h2 { margin:0; }
        .accessGate p { max-width:520px; margin:0; color:#68717d; line-height:1.6; }
        .gateMark { display:grid; width:50px; height:50px; place-items:center; border-radius:50%; background:#f2eafd; color:#6d28d9; font-size:18px; font-weight:900; }
        .gateActions { display:flex; flex-wrap:wrap; justify-content:center; gap:9px; margin-top:5px; }
        .gateActions a,.gateSingle { padding:11px 19px; border:1.5px solid #6d28d9; border-radius:999px; background:#6d28d9; color:#fff; font-weight:900; text-decoration:none; }
        .gateActions a.secondary { background:#fff; color:#6d28d9; }
        @media (max-width:900px) {
          .page { padding-bottom:calc(84px + env(safe-area-inset-bottom)); }
          .heroGrid { position:relative; display:block; isolation:isolate; padding-bottom:240px; }
          .heroGrid > div:first-child { position:relative; z-index:1; max-width:680px; }
          .heroVisual { position:absolute; inset:0; z-index:0; display:block; margin:0; pointer-events:none; }
          .heroPhoto {
            position:absolute;
            inset:-72px -20px -72px auto;
            width:min(58%,480px);
            height:auto;
            aspect-ratio:auto;
            border-radius:0;
            box-shadow:none;
            opacity:.72;
            -webkit-mask-image:linear-gradient(to right,transparent,#000 45%);
            mask-image:linear-gradient(to right,transparent,#000 45%);
          }
          .heroCard {
            position:absolute;
            right:0;
            bottom:0;
            z-index:1;
            width:min(46%,460px);
            padding:16px 18px;
            background:rgba(255,255,255,.92);
          }
          .hero .primary { display:none; }
          .mobileCta {
            position:fixed;
            inset:auto 0 0;
            z-index:50;
            display:grid;
            grid-template-columns:repeat(2,minmax(0,1fr));
            gap:10px;
            padding:10px max(16px,env(safe-area-inset-left)) calc(10px + env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-right));
            border-top:1px solid rgba(109,40,217,.15);
            background:rgba(255,255,255,.96);
            box-shadow:0 -8px 28px rgba(22,32,42,.1);
            backdrop-filter:blur(12px);
          }
          .mobileCta a {
            display:flex;
            min-height:48px;
            align-items:center;
            justify-content:center;
            padding:9px 10px;
            border-radius:999px;
            font-size:14px;
            font-weight:900;
            line-height:1.2;
            text-align:center;
            text-decoration:none;
          }
          .mobileCta a:focus-visible { outline:3px solid #6d28d9; outline-offset:2px; }
          .mobileCtaServices { border:1.5px solid #6d28d9; color:#6d28d9; background:#fff; }
          .mobileCtaQuote { color:#fff; background:linear-gradient(100deg,#f5c542,#c86fc9 55%,#7b2ff7); }
          .quoteGrid,.faqGrid { grid-template-columns:1fr; }
        }
        @media (min-width:701px) and (max-width:900px) {
          .heroGrid { padding-bottom:200px; }
          .heroGrid > div:first-child { max-width:52%; }
          .hero h1 { font-size:clamp(34px,4.8vw,44px); line-height:1.08; }
          .hero .lede { font-size:16px; line-height:1.5; }
          .heroCard { right:auto; left:0; width:min(52%,430px); }
        }
        @media (max-width:800px) { .taskGrid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
        @media (max-width:700px) {
          .hero { padding:24px 0 36px; }
          .heroGrid { display:flex; flex-direction:column; gap:22px; padding-bottom:0; }
          .heroGrid > div:first-child { order:1; }
          .heroVisual { position:relative; order:0; width:100%; height:230px; pointer-events:auto; }
          .heroPhoto {
            position:absolute;
            inset:0;
            width:100%;
            height:100%;
            border-radius:20px;
            opacity:1;
            -webkit-mask-image:none;
            mask-image:none;
          }
          .heroCard {
            right:12px;
            bottom:12px;
            left:12px;
            width:auto;
            gap:3px;
            padding:10px 13px;
            border-radius:14px;
            background:rgba(255,255,255,.95);
            box-shadow:0 6px 22px rgba(22,32,42,.13);
          }
          .heroCard :global(svg) { display:none; }
          .heroCard strong { font-size:14px; line-height:1.25; }
          .heroCard span { font-size:12px; line-height:1.3; }
          .hero .eyebrow { margin-bottom:8px; font-size:11px; line-height:1.35; }
          .hero h1 { max-width:550px; margin-bottom:12px; font-size:clamp(30px,7.5vw,40px); line-height:1.08; }
          .hero .lede { max-width:540px; margin:0; color:#4b5563; font-size:16px; line-height:1.5; }
        }
        @media (max-width:560px) {
          .inner { width:min(100% - 28px,1120px); }
          .heroVisual { height:210px; }
          .taskGrid,.two { grid-template-columns:1fr; }
          .services,.quoteBand { padding-top:54px; padding-bottom:60px; }
          .quoteForm,.success { padding:21px 17px; }
        }
      `}</style>
    </main>
  );
}
