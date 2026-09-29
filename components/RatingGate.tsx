"use client";

// Compulsory rating pop-up. Save at: components/RatingGate.tsx
// Add <RatingGate /> to app/layout.tsx.
//
// Appears as soon as a visit is completed and won't close until the person
// gives a star rating. The comment is optional; clients also get an optional
// tip step afterwards.

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import ReviewVisibilityChoice from "@/components/ReviewVisibilityChoice";
import type { ReviewVisibility } from "@/lib/reviewVisibility";

const supabase = createClient();

type Pending = {
  bookingId: string;
  service: string;
  other: string; // who they're rating
  role: "client" | "provider";
};

export default function RatingGate() {
  const [job, setJob] = useState<Pending | null>(null);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [visibility, setVisibility] =
    useState<ReviewVisibility>("public");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [customTip, setCustomTip] = useState("");
  const [phase, setPhase] = useState<"rate" | "tip">("rate");

  const look = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data: me } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (me?.role === "admin") return;

    const { data: provider } = await supabase.from("providers")
      .select("id").eq("profile_id", user.id).maybeSingle();

    // Completed jobs on my side
    const { data: done } = await supabase
      .from("bookings")
      .select("id, customer_id, provider_id, packages(name), providers(display_name)")
      .eq("status", "completed")
      .order("scheduled_at", { ascending: false })
      .limit(20);

    if (!done?.length) return;

    // Which have I already rated?
    const ids = done.map((b) => b.id);
    const { data: mine } = await supabase
      .rpc("my_review_submission_states");

    const rated = new Set((mine ?? [])
      .filter((review) => ids.includes(review.booking_id))
      .map((review) => `${review.booking_id}:${review.reviewer}`));
    const pending = done.flatMap((booking) => {
      const roles: Array<"client" | "provider"> = [];
      if (booking.customer_id === user.id) roles.push("client");
      if (provider?.id && booking.provider_id === provider.id) roles.push("provider");
      return roles.filter((reviewer) => !rated.has(`${booking.id}:${reviewer}`))
        .map((reviewer) => ({ booking, reviewer }));
    });
    const next = pending[0];
    if (!next) return;

    const pkg = next.booking.packages as { name: string } | { name: string }[] | null;
    const prv = next.booking.providers as
      | { display_name: string | null }
      | { display_name: string | null }[]
      | null;
    const pkgName =
      (Array.isArray(pkg) ? pkg[0]?.name : pkg?.name) ?? "your visit";
    const provName =
      (Array.isArray(prv) ? prv[0]?.display_name : prv?.display_name) ??
      "your provider";

    setJob({
      bookingId: next.booking.id,
      service: pkgName,
      other: next.reviewer === "client" ? provName : "this client",
      role: next.reviewer,
    });
  }, []);

  useEffect(() => {
    look();
    const t = setInterval(look, 20000);
    return () => clearInterval(t);
  }, [look]);

  async function submit() {
    if (!job || stars === 0) return;
    setBusy(true);
    setErr(null);

    const { error } = await supabase.from("reviews").insert({
      booking_id: job.bookingId,
      reviewer: job.role,
      rating: stars,
      comment: comment.trim() || null,
      visibility,
    });

    setBusy(false);

    if (error) {
      // Already rated (or blocked) — clear it and move on.
      if (/duplicate|unique/i.test(error.message)) {
        reset();
        look();
        return;
      }
      setErr(error.message);
      return;
    }

    if (job.role === "client") {
      setPhase("tip");
    } else {
      reset();
      look();
    }
  }

  async function tip(amount: number) {
    if (!job) return;
    setBusy(true);
    try {
      const res = await fetch("/api/tip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId: job.bookingId, amount }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      throw new Error(data.error || "Couldn't start the tip");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Tip failed");
      setBusy(false);
    }
  }

  function reset() {
    setJob(null);
    setStars(0);
    setComment("");
    setVisibility("public");
    setPhase("rate");
    setErr(null);
  }

  if (!job) return null;

  return (
    <div className="scrim" role="dialog" aria-modal="true">
      <div className="modal">
        {phase === "rate" ? (
          <>
            <p className="eyebrow">Visit complete</p>
            <h2>
              {job.role === "client"
                ? `How was your ${job.service}?`
                : `How was this job?`}
            </h2>
            <p className="sub">
              {job.role === "client"
                ? `Rate ${job.other}. This takes a second and helps everyone.`
                : "Rate the client, then choose who can see your review."}
            </p>

            <div className="stars">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  className={n <= stars ? "star on" : "star"}
                  onClick={() => {
                    setStars(n);
                    setVisibility(
                      job.role === "client" && n < 4 ? "private" : "public",
                    );
                  }}
                  aria-label={`${n} star${n > 1 ? "s" : ""}`}
                >
                  ★
                </button>
              ))}
            </div>
            <p className="hint">
              {stars === 0
                ? "Tap a star to continue"
                : ["", "Poor", "Below par", "Fine", "Good", "Excellent"][stars]}
            </p>

            <textarea
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Add a sentence (optional)"
            />

            <ReviewVisibilityChoice
              rating={stars}
              value={visibility}
              onChange={setVisibility}
              idPrefix={`rating-gate-${job.bookingId}`}
              reviewer={job.role}
            />

            <button className="go" onClick={submit} disabled={busy || !stars}>
              {busy ? "Saving…" : "Submit rating"}
            </button>
          </>
        ) : (
          <>
            <p className="eyebrow">Thank you</p>
            <h2>Add a tip?</h2>
            <p className="sub">
              Entirely optional — and it all goes to {job.other}. We take
              nothing.
            </p>
            <form onSubmit={(event) => { event.preventDefault(); void tip(Number(customTip)); }} style={{ margin: "14px 0", display: "grid", gap: 8 }}>
              <label htmlFor="rating-tip">Your tip (£)</label>
              <input id="rating-tip" type="number" inputMode="decimal" min="0.30" step="0.01" required value={customTip} onChange={(event) => setCustomTip(event.target.value)} placeholder="Enter any amount" disabled={busy} />
              <button type="submit" disabled={busy || !Number.isFinite(Number(customTip)) || Number(customTip) < 0.30}>Continue with your tip</button>
              <small>Card payments start at £0.30.</small>
            </form>
            <div className="tips">
              {[3, 5, 10].map((n) => (
                <button key={n} onClick={() => tip(n)} disabled={busy}>
                  £{n}
                </button>
              ))}
            </div>
            <button
              className="skip"
              onClick={() => {
                reset();
                look();
              }}
              disabled={busy}
            >
              No thanks
            </button>
          </>
        )}

        {err && <p className="err">{err}</p>}
      </div>

      <style jsx>{`
        .scrim {
          position: fixed;
          inset: 0;
          background: rgba(38, 48, 42, 0.55);
          backdrop-filter: blur(3px);
          display: grid;
          place-items: center;
          padding: 20px;
          z-index: 10000;
          font-family: "Nunito", system-ui, sans-serif;
        }
        .modal {
          background: #fff;
          border-radius: 20px;
          padding: 34px 32px;
          width: min(420px, 100%);
          text-align: center;
          box-shadow: 0 30px 70px rgba(0, 0, 0, 0.28);
        }
        .eyebrow {
          text-transform: uppercase;
          letter-spacing: 0.14em;
          font-size: 11.5px;
          font-weight: 600;
          color: #6D28D9;
          margin: 0 0 8px;
        }
        h2 {
          font-family: "Nunito", system-ui, sans-serif;
          font-weight: 900;
          font-size: 26px;
          color: #16202A;
          margin: 0 0 8px;
        }
        .sub {
          color: #7A828C;
          font-size: 14.5px;
          margin: 0 0 20px;
          line-height: 1.5;
        }
        .stars {
          display: flex;
          justify-content: center;
          gap: 6px;
        }
        .star {
          background: none;
          border: none;
          font-size: 38px;
          line-height: 1;
          padding: 0 2px;
          cursor: pointer;
          color: #ddd5c7;
          transition: transform 0.12s ease, color 0.12s ease;
        }
        .star:hover {
          transform: scale(1.12);
        }
        .star.on {
          color: #6D28D9;
        }
        .hint {
          font-size: 13px;
          color: #7A828C;
          margin: 8px 0 18px;
          min-height: 18px;
        }
        textarea {
          width: 100%;
          box-sizing: border-box;
          padding: 12px 14px;
          border: 1.5px solid #E5E7EA;
          border-radius: 12px;
          font: inherit;
          font-size: 14.5px;
          resize: vertical;
          margin-bottom: 16px;
          color: #16202A;
        }
        textarea:focus-visible {
          outline: none;
          border-color: #16202A;
        }
        .go {
          width: 100%;
          background: #16202A;
          color: #FFFFFF;
          border: none;
          border-radius: 999px;
          padding: 14px;
          font: inherit;
          font-size: 15.5px;
          font-weight: 600;
          cursor: pointer;
        }
        .go:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .tips {
          display: flex;
          gap: 10px;
          justify-content: center;
          margin-bottom: 16px;
        }
        .tips button {
          background: #FFFFFF;
          border: 1.5px solid #EDEFF1;
          border-radius: 999px;
          padding: 12px 24px;
          font: inherit;
          font-size: 16px;
          font-weight: 600;
          color: #16202A;
          cursor: pointer;
        }
        .tips button:hover {
          border-color: #6D28D9;
          background: #fdf6f0;
        }
        .skip {
          background: none;
          border: none;
          color: #7A828C;
          font: inherit;
          font-size: 14px;
          text-decoration: underline;
          cursor: pointer;
        }
        .err {
          background: #FFE6EA;
          color: #B0384F;
          padding: 10px 12px;
          border-radius: 10px;
          font-size: 13.5px;
          margin: 14px 0 0;
        }
      `}</style>
    </div>
  );
}
