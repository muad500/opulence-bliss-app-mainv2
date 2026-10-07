"use client";

import Link from "next/link";
import Image from "next/image";
import { FormEvent, ReactNode, useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import PayoutScheduleForm from "../earnings/PayoutScheduleForm";
import VerificationDocuments, { type Check } from "./VerificationDocuments";
import DeletionRequestStatus, { DELETION_REQUEST_UPDATED_EVENT } from "@/components/DeletionRequestStatus";
import PayoutAccount from "@/components/PayoutAccount";
import PhotoUpload from "@/components/PhotoUpload";
import IncidentReport from "@/components/IncidentReport";
import styles from "./profile.module.css";

const supabase = createClient();
const TASKS = ["Mounting and hanging", "Furniture assembly", "Minor repairs", "Curtains and blinds", "Furniture moving", "Minor decorating"];
type Review = { id: string; rating: number; comment: string | null; visibility: "public" | "private"; created_at: string };
type TimeOff = { id: string; startDate: string; endDate: string; note: string | null };
type Profile = {
  personal: { legalName: string | null; dateOfBirth: string | null; email: string | null; phone: string | null; homePostcode: string | null; emergencyContactName: string | null; emergencyContactPhone: string | null };
  publicProfile: { displayName: string | null; photoUrl: string | null; bio: string | null; languages: string[]; yearsExperience: number | null; services: string[]; equipmentProvided: boolean; handymanRates: Record<string, number>; ratingAvg: number | null; ratingCount: number };
  work: { coveragePostcodes: string[]; maxTravelMiles: number | null; maxDailyHours: number | null; acceptsSameDay: boolean; timeOff: TimeOff[] };
  verification: Check[];
  payout: { stripeAccountId: string | null; status: string | null; schedule: "weekly" | "fortnightly" | "monthly" };
  tax: { utrNumber: string | null; vatNumber: string | null };
  alerts: { jobOffers: { app: boolean; sms: boolean; email: boolean }; notifications: { messages: boolean } };
  legalAcceptances: { documentSlug: string; version: string; acceptedAt: string }[];
  accountStatus?:{verificationBlock:string|null;canUseJobs:boolean};
};

function dateText(value: string | null | undefined) {
  if (!value) return "Not provided";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "Not provided" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
function openSupport() { window.dispatchEvent(new Event("opulence:open-support")); }
function Section({ id, eyebrow, title, intro, children }: { id: string; eyebrow: string; title: string; intro: string; children: ReactNode }) {
  return <section id={id} className={styles.card}><header className={styles.sectionHead}><span className={styles.eyebrow}>{eyebrow}</span><h2>{title}</h2><p>{intro}</p></header>{children}</section>;
}
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className={styles.field}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export default function WorkerProfilePage() {
  const [p, setP] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ section: string; message: string; error: boolean } | null>(null);
  const [languages, setLanguages] = useState("");
  const [coverage, setCoverage] = useState("");
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewsError, setReviewsError] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [passwordAgain, setPasswordAgain] = useState("");
  const [timeFrom, setTimeFrom] = useState("");
  const [timeTo, setTimeTo] = useState("");
  const [timeNote, setTimeNote] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteText, setDeleteText] = useState("");

  const refresh = useCallback(async () => {
    const response = await fetch("/api/account/worker-profile", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "Could not load your professional profile.");
    const next = body as Profile;
    setP(next);
    setLanguages((next.publicProfile.languages ?? []).join(", "));
    setCoverage((next.work.coveragePostcodes ?? []).join(", "));
    return next;
  }, []);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        await refresh();
        const { data: auth } = await supabase.auth.getUser();
        if (!live || !auth.user) return;
        const { data: worker } = await supabase.from("providers").select("id").eq("profile_id", auth.user.id).maybeSingle();
        if (!worker || !live) return;
        const { data, error: reviewError } = await supabase.from("reviews")
          .select("id, rating, comment, visibility, created_at, bookings!inner(provider_id)")
          .eq("reviewer", "client").eq("bookings.provider_id", worker.id)
          .order("created_at", { ascending: false });
        if (live) { setReviews((data ?? []) as Review[]); setReviewsError(!!reviewError); }
      } catch (cause) {
        if (live) setError(cause instanceof Error ? cause.message : "Could not load your profile.");
      } finally { if (live) setLoading(false); }
    })();
    return () => { live = false; };
  }, [refresh]);

  function edit<K extends keyof Profile>(section: K, update: Partial<Profile[K]>) {
    setP((current) => current ? { ...current, [section]: { ...current[section], ...update } } : current);
    setFeedback(null);
  }
  const message = (section: string) => feedback?.section === section
    ? <p role="status" className={feedback.error ? styles.errorNotice : styles.successNotice}>{feedback.message}</p> : null;
  const saveButton = (section: string, action: () => void) => <button className={styles.primaryButton} type="button" disabled={busy === section} onClick={action}>{busy === section ? "Saving…" : "Save changes"}</button>;

  async function save(section: "personal" | "publicProfile" | "work" | "tax" | "alerts") {
    if (!p) return;
    const value = section === "personal"
      ? { legalName: p.personal.legalName, phone: p.personal.phone, homePostcode: p.personal.homePostcode, emergencyContactName: p.personal.emergencyContactName, emergencyContactPhone: p.personal.emergencyContactPhone }
      : section === "publicProfile"
        ? { displayName: p.publicProfile.displayName, bio: p.publicProfile.bio, languages: languages.split(",").map((x) => x.trim()).filter(Boolean), yearsExperience: p.publicProfile.yearsExperience, equipmentProvided: p.publicProfile.equipmentProvided, ...(p.publicProfile.services.includes("handyman") ? { handymanRates: p.publicProfile.handymanRates } : {}) }
        : section === "work"
          ? { coveragePostcodes: coverage.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean), maxTravelMiles: p.work.maxTravelMiles, maxDailyHours: p.work.maxDailyHours, acceptsSameDay: p.work.acceptsSameDay }
          : p[section];
    setBusy(section); setFeedback(null);
    try {
      const response = await fetch("/api/account/worker-profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [section]: value }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not save your changes.");
      setP(body as Profile);
      setLanguages((body.publicProfile?.languages ?? []).join(", "));
      setCoverage((body.work?.coveragePostcodes ?? []).join(", "));
      setFeedback({ section, message: "Changes saved.", error: false });
    } catch (cause) { setFeedback({ section, message: cause instanceof Error ? cause.message : "Could not save your changes.", error: true }); }
    finally { setBusy(null); }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < 12 || password !== passwordAgain) { setFeedback({ section: "password", message: "Use at least 12 characters and make sure both passwords match.", error: true }); return; }
    setBusy("password");
    try {
      const response = await fetch("/api/account/password", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword: password }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Password could not be changed.");
      setFeedback({ section: "password", message: "Password changed.", error: false });
      setCurrentPassword(""); setPassword(""); setPasswordAgain("");
    } catch (cause) {
      setFeedback({ section: "password", message: cause instanceof Error ? cause.message : "Password could not be changed.", error: true });
    }
    setBusy(null);
  }
  async function addTimeOff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!timeFrom || !timeTo || timeTo < timeFrom) { setFeedback({ section: "time", message: "Choose a valid start and end date.", error: true }); return; }
    setBusy("time");
    try {
      const response = await fetch("/api/account/time-off", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ startDate: timeFrom, endDate: timeTo, note: timeNote.trim() || null }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not save your time off.");
      await refresh(); setTimeFrom(""); setTimeTo(""); setTimeNote("");
      setFeedback({ section: "time", message: "Time off saved.", error: false });
    } catch (cause) { setFeedback({ section: "time", message: cause instanceof Error ? cause.message : "Could not save your time off.", error: true }); }
    finally { setBusy(null); }
  }
  async function removeTimeOff(id: string) {
    setBusy("time");
    try {
      const response = await fetch(`/api/account/time-off/${encodeURIComponent(id)}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not remove your time off.");
      await refresh(); setFeedback({ section: "time", message: "Time off removed.", error: false });
    } catch (cause) { setFeedback({ section: "time", message: cause instanceof Error ? cause.message : "Could not remove your time off.", error: true }); }
    finally { setBusy(null); }
  }
  async function requestDeletion() {
    if (deleteText !== "DELETE MY ACCOUNT") return;
    setBusy("delete");
    try {
      const response = await fetch("/api/account/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation: deleteText }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not send your request.");
      setDeleteOpen(false); setDeleteText("");
      setFeedback({ section: "legal", message: body.message ?? "Your deletion request has been received.", error: false });
      window.dispatchEvent(new Event(DELETION_REQUEST_UPDATED_EVENT));
    } catch (cause) { setFeedback({ section: "delete", message: cause instanceof Error ? cause.message : "Could not send your request.", error: true }); }
    finally { setBusy(null); }
  }

  if (loading) return <main className={styles.page}><p className={styles.loading}>Loading your professional profile…</p></main>;
  if (!p || error) return <main className={styles.page}><div className={styles.card} role="alert"><h1>We couldn&apos;t open your profile</h1><p>{error ?? "Please sign in as a professional."}</p><Link href="/provider/login">Professional login</Link></div></main>;
  const photo = p.publicProfile.photoUrl;
  const workUnlocked = p.accountStatus?.canUseJobs === true;

  return <main className={styles.page}><div className={styles.container}>
    <header className={styles.hero}><div><span className={styles.eyebrow}>Professional account</span><h1>Your profile and settings</h1><p>Keep your private details up to date and choose what customers see about your work.</p><div className={styles.heroLinks}><Link href={workUnlocked ? "/worker" : "/worker/application"}>{workUnlocked ? "My jobs" : "My application"}</Link><Link href="/account">Client account</Link></div></div><div className={styles.heroIdentity}>{photo ? <Image className={styles.avatar} src={photo} alt="Your profile" width={66} height={66} unoptimized /> : <span className={styles.avatar}>{(p.publicProfile.displayName ?? p.personal.legalName ?? "P").charAt(0).toUpperCase()}</span>}<div><strong>{p.publicProfile.displayName || "Add your display name"}</strong><span>{p.publicProfile.ratingAvg != null && p.publicProfile.ratingCount ? `${p.publicProfile.ratingAvg.toFixed(1)} ★ · ${p.publicProfile.ratingCount} reviews` : "No reviews yet"}</span><small>Public preview</small></div></div></header>
    <nav className={styles.sectionNav} aria-label="Profile sections"><a href="#personal">Personal</a><a href="#public">Public profile</a>{workUnlocked && <a href="#work">Work & areas</a>}<a href="#verification">Verification</a><a href="#payments">Payments</a><a href="#settings">Settings</a></nav>
    <div className={styles.content}><div className={styles.mainColumn}>
      <Section id="personal" eyebrow="Only you and our team" title="Personal details" intro="Your legal name, birth date, home postcode and emergency contact are private."><div className={styles.grid}>
        <Field label="Full legal name"><input value={p.personal.legalName ?? ""} autoComplete="name" onChange={(e) => edit("personal", { legalName: e.target.value })} /></Field>
        <Field label="Date of birth" hint="Contact support to correct this."><input value={dateText(p.personal.dateOfBirth)} disabled /></Field>
        <Field label="Email address"><input value={p.personal.email ?? ""} disabled autoComplete="email" /></Field>
        <Field label="UK phone number"><input type="tel" autoComplete="tel" value={p.personal.phone ?? ""} onChange={(e) => edit("personal", { phone: e.target.value })} /></Field>
        <Field label="Home postcode" hint="Never shown to customers."><input autoComplete="postal-code" value={p.personal.homePostcode ?? ""} onChange={(e) => edit("personal", { homePostcode: e.target.value.toUpperCase() })} /></Field>
      </div><h3>Emergency contact</h3><p className={styles.help}>Recommended when you work alone in customers&apos; homes.</p><div className={styles.grid}><Field label="Contact name"><input value={p.personal.emergencyContactName ?? ""} onChange={(e) => edit("personal", { emergencyContactName: e.target.value })} /></Field><Field label="Contact phone"><input type="tel" value={p.personal.emergencyContactPhone ?? ""} onChange={(e) => edit("personal", { emergencyContactPhone: e.target.value })} /></Field></div>{saveButton("personal", () => void save("personal"))}{message("personal")}</Section>

      <Section id="public" eyebrow="Customers can see this" title="Public profile" intro="Introduce yourself, your experience and the services you offer."><div className={styles.grid}>
        <Field label="Display name" hint="For example, Amina K."><input value={p.publicProfile.displayName ?? ""} onChange={(e) => edit("publicProfile", { displayName: e.target.value })} /></Field>
        <Field label="Years of experience"><input type="number" min="0" max="60" value={p.publicProfile.yearsExperience ?? ""} onChange={(e) => edit("publicProfile", { yearsExperience: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
        <Field label="Languages" hint="Separate with commas."><input value={languages} onChange={(e) => setLanguages(e.target.value)} placeholder="English, Arabic" /></Field>
        <PhotoUpload professional onChanged={refresh} />
      </div><Field label="Short bio"><textarea rows={4} value={p.publicProfile.bio ?? ""} onChange={(e) => edit("publicProfile", { bio: e.target.value })} placeholder="Tell customers about your approach to the work." /></Field>
      <label className={styles.checkLine}><input type="checkbox" checked={p.publicProfile.equipmentProvided} onChange={(e) => edit("publicProfile", { equipmentProvided: e.target.checked })} />I bring my own equipment and supplies</label>
      <div className={styles.serviceBox}><strong>Services on your account</strong><div>{p.publicProfile.services.length ? p.publicProfile.services.map((service) => <span key={service}>{service}</span>) : "No services added"}</div><p>Contact support to request another service. New services require review.</p></div>
      {p.publicProfile.services.includes("handyman") && <div className={styles.rateBox}><h3>Handyman hourly rates</h3><p>Set your own rate for each task. These do not automatically change existing customer quotes.</p><div className={styles.grid}>{TASKS.map((task) => <Field label={task} key={task}><span className={styles.moneyInput}>£ / hr <input type="number" min="0" max="500" value={p.publicProfile.handymanRates[task] ?? ""} onChange={(e) => edit("publicProfile", { handymanRates: { ...p.publicProfile.handymanRates, [task]: Number(e.target.value) } })} /></span></Field>)}</div></div>}
      {saveButton("publicProfile", () => void save("publicProfile"))}{message("publicProfile")}</Section>

      {workUnlocked ? <Section id="work" eyebrow="Your working week" title="Areas and availability" intro="Tell us where you work, your daily limits and when you can accept jobs."><div className={styles.grid}>
        <Field label="Postcodes covered" hint="Use full postcodes or outward codes, separated by commas."><input value={coverage} onChange={(e) => setCoverage(e.target.value)} placeholder="SW3, W8, NW1" /></Field>
        <Field label="Maximum travel distance (miles)" hint="Saved for review. Matching uses listed postcodes within your approved areas when provided."><input type="number" min="1" max="100" value={p.work.maxTravelMiles ?? ""} onChange={(e) => edit("work", { maxTravelMiles: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
        <Field label="Maximum hours per day"><input type="number" min="1" max="16" value={p.work.maxDailyHours ?? ""} onChange={(e) => edit("work", { maxDailyHours: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
      </div><label className={styles.checkLine}><input type="checkbox" checked={p.work.acceptsSameDay} onChange={(e) => edit("work", { acceptsSameDay: e.target.checked })} />Consider same-day offers</label><div className={styles.linkRow}><div><strong>Weekly working hours</strong><span>Set available days and start and end times.</span></div><Link href="/worker/availability">Manage hours →</Link></div>{saveButton("work", () => void save("work"))}{message("work")}
      <div className={styles.divider} /><h3>Time off and holidays</h3>{p.work.timeOff?.length ? <ul className={styles.timeList}>{p.work.timeOff.map((item) => <li key={item.id}><div><strong>{dateText(item.startDate)} – {dateText(item.endDate)}</strong>{item.note && <span>{item.note}</span>}</div><button type="button" disabled={busy === "time"} onClick={() => void removeTimeOff(item.id)}>Remove</button></li>)}</ul> : <p className={styles.help}>No time off planned.</p>}
      <form onSubmit={(e) => void addTimeOff(e)}><div className={styles.grid}><Field label="From"><input type="date" value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)} required /></Field><Field label="To"><input type="date" min={timeFrom} value={timeTo} onChange={(e) => setTimeTo(e.target.value)} required /></Field></div><Field label="Note (optional)"><input maxLength={120} value={timeNote} onChange={(e) => setTimeNote(e.target.value)} placeholder="Holiday" /></Field><button className={styles.secondaryButton} type="submit" disabled={busy === "time"}>{busy === "time" ? "Saving…" : "Add time off"}</button></form>{message("time")}</Section> : <Section id="work" eyebrow="Approval required" title="Working tools are locked" intro="Your application availability is for review. Working hours, time off, jobs and earnings unlock after administrator approval."><Link href="/worker/application">View my application →</Link></Section>}

      <Section id="verification" eyebrow="Private documents" title="Verification and documents" intro="Only you and the review team can see these records. A document is verified only after review.">{p.accountStatus?.verificationBlock&&<p role="status" className={styles.errorNotice}>{p.accountStatus.verificationBlock}</p>}<VerificationDocuments checks={p.verification} services={p.publicProfile.services} onUploaded={refresh} /><button className={styles.textButton} type="button" onClick={openSupport}>Contact support about documents →</button></Section>

      <Section id="payments" eyebrow="Money and tax" title="Payments and payouts" intro="Stripe holds bank details; they are not stored in your profile.">
        {workUnlocked ? <><div className={styles.summaryGrid}>
          <div><span>Stripe account</span><strong>{p.payout.stripeAccountId ? "Linked" : "Not linked"}</strong></div>
          <div><span>Bank details</span><strong>Managed by Stripe</strong></div>
        </div>
        <PayoutAccount /><PayoutScheduleForm current={p.payout.schedule ?? "weekly"} />
        <div className={styles.linkRow}><div><strong>Earnings, tips and payout history</strong><span>See every payment and your job invoices.</span></div><Link href="/worker/earnings">View earnings →</Link></div></> : <p className={styles.help}>Earnings, bank setup and payout settings unlock after your application is approved.</p>}
        <h3>Tax details</h3><p className={styles.help}>UTR is optional. Add a VAT number only if registered for VAT. Both are private.</p>
        <div className={styles.grid}><Field label="UTR number"><input inputMode="numeric" maxLength={10} value={p.tax.utrNumber ?? ""} onChange={(e) => edit("tax", { utrNumber: e.target.value })} placeholder="10 digits" /></Field><Field label="VAT number"><input value={p.tax.vatNumber ?? ""} onChange={(e) => edit("tax", { vatNumber: e.target.value.toUpperCase() })} placeholder="GB…" /></Field></div>
        {saveButton("tax", () => void save("tax"))}{message("tax")}
      </Section>

      <Section id="settings" eyebrow="Your choices" title="Alerts and security" intro="Choose how you hear about new jobs. Email and in-app alerts follow these settings; SMS is not available yet."><h3>New job offers</h3><div className={styles.choiceGrid}>{(["app", "sms", "email"] as const).map((channel) => <label className={styles.checkLine} key={channel}><input type="checkbox" checked={p.alerts.jobOffers[channel]} onChange={(e) => edit("alerts", { jobOffers: { ...p.alerts.jobOffers, [channel]: e.target.checked } })} />{channel === "app" ? "In-app" : channel.toUpperCase()}</label>)}</div><label className={styles.checkLine}><input type="checkbox" checked={p.alerts.notifications.messages} onChange={(e) => edit("alerts", { notifications: { messages: e.target.checked } })} />Message notifications</label>{saveButton("alerts", () => void save("alerts"))}{message("alerts")}<div className={styles.divider} /><h3>Change password</h3><form onSubmit={(e) => void changePassword(e)}><div className={styles.grid}><Field label="Current password"><input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required /></Field><Field label="New password"><input type="password" minLength={12} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field><Field label="Confirm password"><input type="password" minLength={12} autoComplete="new-password" value={passwordAgain} onChange={(e) => setPasswordAgain(e.target.value)} required /></Field></div><button className={styles.secondaryButton} type="submit" disabled={busy === "password"}>{busy === "password" ? "Changing…" : "Change password"}</button></form>{message("password")}</Section>

      <Section id="reviews" eyebrow="Feedback" title="Reviews you received" intro="Private feedback stays here for your reference. Public reviews appear on your public profile, regardless of rating.">{reviewsError ? <p className={styles.errorNotice}>Reviews could not be loaded. Please refresh.</p> : reviews.length ? <div className={styles.reviewList}>{reviews.map((r) => <article className={styles.review} key={r.id}><div><span className={styles.stars} aria-label={`${r.rating} out of 5 stars`}>{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</span><span className={styles.visibility}>{r.visibility === "public" ? "Public" : "Private"}</span></div><p>{r.comment ?? "Rating left without a comment."}</p><time dateTime={r.created_at}>{dateText(r.created_at)}</time></article>)}</div> : <p className={styles.help}>No customer feedback yet.</p>}</Section>

      <Section id="legal" eyebrow="Your rights" title="Legal and account" intro="See the agreements on file and manage your account data.">{p.legalAcceptances.length ? <ul className={styles.legalList}>{p.legalAcceptances.map((item, index) => <li key={`${item.documentSlug}-${index}`}><strong>{item.documentSlug === "professional-partner-agreement" ? "Professional Partner Agreement" : item.documentSlug.replaceAll("-", " ")}</strong><span>Version {item.version} · accepted {dateText(item.acceptedAt)}</span></li>)}</ul> : <p className={styles.help}>No agreement acceptance is recorded on this account.</p>}<div className={styles.accountActions}><a className={styles.secondaryButton} href="/api/account/export">Download my data</a><button className={styles.dangerButton} type="button" onClick={() => setDeleteOpen(true)}>Delete my account</button></div><DeletionRequestStatus />{message("legal")}</Section>
    </div><aside className={styles.aside}><div className={styles.asideCard}><span className={styles.eyebrow}>One account</span><h2>Client and professional</h2><p>Use the same sign-in to book for yourself and manage your professional work.</p><Link href="/account">Go to client account →</Link></div><div className={styles.asideCard}><span className={styles.eyebrow}>Help</span><h2>Need a hand?</h2><p>Ask about verification or an issue on a visit.</p><button type="button" onClick={openSupport}>Contact support →</button><Link href="/faq">Frequently asked questions →</Link><IncidentReport professional /></div></aside></div>
  </div>
  {deleteOpen && <div className={styles.backdrop} onMouseDown={(e) => { if (e.target === e.currentTarget) setDeleteOpen(false); }}><div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="delete-title"><h2 id="delete-title">Request account deletion?</h2><p>We will review your request and explain any records we must retain for legal or financial reasons. Unfinished jobs may need resolving first.</p><label htmlFor="delete-word">Type <strong>DELETE MY ACCOUNT</strong> to confirm</label><input id="delete-word" value={deleteText} onChange={(e) => setDeleteText(e.target.value)} autoComplete="off" />{message("delete")}<div className={styles.modalActions}><button className={styles.secondaryButton} type="button" onClick={() => setDeleteOpen(false)}>Keep my account</button><button className={styles.dangerButton} type="button" disabled={deleteText !== "DELETE MY ACCOUNT" || busy === "delete"} onClick={() => void requestDeletion()}>{busy === "delete" ? "Sending…" : "Request deletion"}</button></div></div></div>}
  </main>;
}
