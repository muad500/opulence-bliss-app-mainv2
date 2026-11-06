"use client";
import { useState, type FormEvent } from "react";
export default function Evidence({ applicationId }: { applicationId: string }) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setMessage("Filing private evidence…");
    try {
      const result = await fetch(
        `/api/admin/cleaner-applications/${applicationId}/evidence`,
        { method: "POST", body: new FormData(form) },
      );
      const data = await result.json();
      if (!result.ok) throw Error(data.error);
      setMessage(
        "Evidence filed. Your identity, time and factual note are recorded. Independent sign-off is still required.",
      );
      form.reset();
    } catch (error) {
      setMessage((error as Error).message || "Evidence could not be filed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details>
      <summary>File the checked private evidence</summary>
      <p>
        Use the original evidence already inspected. Do not upload a DBS
        certificate here. Recording evidence does not activate the professional.
      </p>
      <form onSubmit={save}>
        <label>
          Evidence type
          <select name="type" required>
            <option value="photo_id">Photo ID</option>
            <option value="right_to_work">Right to work</option>
            <option value="proof_of_address">Proof of address</option>
            <option value="public_liability_insurance">
              Public liability insurance
            </option>
          </select>
        </label>
        <label>
          Inspected file (PDF, JPEG or PNG, up to 4 MB)
          <input
            type="file"
            name="file"
            accept="application/pdf,image/jpeg,image/png"
            required
          />
        </label>
        <label>
          Expiry date (required for insurance)
          <input type="date" name="expires" />
        </label>
        <label>
          Insurance cover in pounds (insurance only, minimum £1,000,000)
          <input type="number" name="cover" min="1000000" step="1" />
        </label>
        <label>
          Factual verification note
          <textarea name="note" minLength={10} maxLength={2000} required />
        </label>
        <button disabled={busy} type="submit">
          {busy ? "Filing…" : "File verified evidence"}
        </button>
        <p role="status">{message}</p>
      </form>
    </details>
  );
}
