"use client";
import { FormEvent, Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
function PreviousReviewForm() {
  const token = useSearchParams().get("token") ?? "";
  const [rating, setRating] = useState(5),
    [comment, setComment] = useState(""),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false),
    [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/reviews/previous", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, rating, comment }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setDone(true);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main style={{ maxWidth: 620, margin: "60px auto", padding: 24 }}>
      <h1>Share your previous experience</h1>
      {done ? (
        <p role="status">
          Thank you. Your review is awaiting approval by our team.
        </p>
      ) : !/^[a-f0-9]{64}$/.test(token) ? (
        <p>
          Please use your personal review invitation link, or email
          hello@opulencebliss.com.
        </p>
      ) : (
        <>
          <p>
            Your review will be labelled “Previous customer” and checked by an
            administrator. It will not count towards our booking star rating.
            Please check your words carefully: submitted reviews cannot be
            edited.
          </p>
          <form onSubmit={submit}>
            <label>
              Rating
              <select
                value={rating}
                onChange={(e) => setRating(Number(e.target.value))}
              >
                {[5, 4, 3, 2, 1].map((n) => (
                  <option key={n} value={n}>
                    {n} stars
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "block", marginBlock: 20 }}>
              Your review
              <textarea
                required
                maxLength={2000}
                rows={7}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                style={{ display: "block", width: "100%", padding: 12 }}
              />
            </label>
            <p>
              Please do not include phone numbers, addresses or other people's
              private details.
            </p>
            {error && <p role="alert">{error}</p>}
            <button disabled={busy}>
              {busy ? "Submitting…" : "Submit for approval"}
            </button>
          </form>
        </>
      )}
    </main>
  );
}
export default function PreviousReviewPage() {
  return (
    <Suspense>
      <PreviousReviewForm />
    </Suspense>
  );
}
