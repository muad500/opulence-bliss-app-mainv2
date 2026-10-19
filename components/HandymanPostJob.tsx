"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { handymanTaskLabel } from "@/lib/handymanMarketplace";
import styles from "@/app/handyman/marketplace.module.css";
export default function HandymanPostJob() {
  const [categories, setCategories] = useState<string[]>([]),
    [task, setTask] = useState("");
  const [dates, setDates] = useState<string[]>([]),
    [date, setDate] = useState("");
  const [photos, setPhotos] = useState<File[]>([]),
    [error, setError] = useState("");
  const [busy, setBusy] = useState(false),
    [draft, setDraft] = useState<string | null>(null);
  const key = useRef<string | null>(null),
    uploaded = useRef(new Set<number>());
  useEffect(() => {
    let active = true;
    fetch("/api/handyman/config")
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        if (active) {
          setCategories(d.categories ?? []);
          setTask(d.categories?.[0] ?? "");
        }
      })
      .catch(() => {
        if (active) setError("Services could not be loaded. Please refresh.");
      });
    return () => {
      active = false;
    };
  }, []);
  async function post(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (!dates.length) throw new Error("Add at least one preferred date.");
      if (
        photos.length > 10 ||
        photos.some(
          (p) =>
            p.size > 4194304 || !["image/jpeg", "image/png"].includes(p.type),
        )
      )
        throw new Error(
          "Choose up to ten JPEG or PNG photos, at most 4 MB each.",
        );
      const form = new FormData(event.currentTarget);
      key.current ??= crypto.randomUUID();
      let id = draft;
      if (!id) {
        const r = await fetch("/api/handyman/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestKey: key.current,
            task,
            description: form.get("description"),
            postcode: form.get("postcode"),
            preferredDates: dates,
          }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        id = d.jobId;
        setDraft(id);
      }
      for (const [index, file] of photos.entries()) {
        if (uploaded.current.has(index)) continue;
        const upload = new FormData();
        upload.set("kind", "photo");
        upload.set("file", file);
        const r = await fetch(`/api/handyman/jobs/${id}/files`, {
          method: "POST",
          body: upload,
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        uploaded.current.add(index);
      }
      const r = await fetch(`/api/handyman/jobs/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "publish" }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      window.location.assign("/handyman/jobs/" + id);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Your job could not be posted.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className={styles.page}>
      <nav className={styles.nav}>
        <Link href="/account/handyman">My property maintenance jobs</Link>
      </nav>
      <header className={styles.hero}>
        <p>PROPERTY MAINTENANCE</p>
        <h1>Describe the job. Compare fixed quotes.</h1>
        <p>
          Tell us what needs doing. Approved professionals can quote a total
          including materials, or propose a free site visit. No price is needed
          to post.
        </p>
      </header>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {draft && (
        <p>
          Your draft is saved.{" "}
          <Link href={`/handyman/jobs/${draft}`}>Open the draft →</Link>
        </p>
      )}
      <form className={styles.card} onSubmit={post}>
        <fieldset
          disabled={busy || !categories.length}
          className={styles.formFields}
        >
          <div className={styles.grid}>
            <label className={styles.field}>
              Category
              <select
                value={task}
                onChange={(e) => setTask(e.target.value)}
                disabled={!!draft}
              >
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {handymanTaskLabel(c)}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              Job postcode
              <input
                name="postcode"
                required
                autoComplete="postal-code"
                maxLength={10}
                readOnly={!!draft}
              />
            </label>
          </div>
          <label className={styles.field}>
            What needs doing?
            <textarea
              name="description"
              required
              minLength={10}
              maxLength={2000}
              readOnly={!!draft}
              placeholder="Describe the work and anything the professional should know."
            />
          </label>
          <div className={styles.grid}>
            <label className={styles.field}>
              Preferred dates
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                disabled={!!draft}
              />
            </label>
            <button
              type="button"
              className={styles.secondary}
              disabled={!date || dates.length >= 10 || !!draft}
              onClick={() => {
                setDates([...new Set([...dates, date])].sort());
                setDate("");
              }}
            >
              Add date
            </button>
          </div>
          <div className={styles.actions}>
            {dates.map((d) => (
              <button
                type="button"
                className={styles.secondary}
                key={d}
                disabled={!!draft}
                aria-label={`Remove ${d}`}
                onClick={() => setDates(dates.filter((v) => v !== d))}
              >
                {d} ×
              </button>
            ))}
          </div>
          <label className={styles.field}>
            Photos (optional, up to 10)
            <input
              type="file"
              accept="image/jpeg,image/png"
              multiple
              disabled={!!draft}
              onChange={(e) => setPhotos(Array.from(e.target.files ?? []))}
            />
          </label>
          <p className={styles.muted}>
            JPEG or PNG, up to 4 MB each. Only invited professionals can view
            the job photos. Your full address is shared after you agree a visit
            or quote.
          </p>
          <button className={styles.button}>
            {busy
              ? "Saving your job…"
              : draft
                ? "Retry posting saved draft"
                : "Post job — no payment yet"}
          </button>
        </fieldset>
      </form>
    </main>
  );
}
