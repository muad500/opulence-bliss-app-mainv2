"use client";
import { FormEvent, Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { safeAuthNext } from "@/lib/authReturn";

function PhoneForm() {
  const params = useSearchParams();
  const [phone, setPhone] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/account/complete-phone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Your phone could not be saved.");
      window.location.assign(safeAuthNext(params.get("next")) ?? "/account");
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main style={{ maxWidth: 480, margin: "64px auto", padding: 24 }}>
      <h1>Complete your account</h1>
      <p>
        A phone number is required. Your number is private and is never shared
        with your cleaner or customer.
      </p>
      <form onSubmit={submit}>
        <label>
          UK phone number
          <input
            required
            type="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            style={{
              display: "block",
              width: "100%",
              padding: 14,
              marginBlock: 16,
            }}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button disabled={busy}>{busy ? "Saving…" : "Continue"}</button>
      </form>
    </main>
  );
}
export default function CompleteProfile() {
  return (
    <Suspense>
      <PhoneForm />
    </Suspense>
  );
}
