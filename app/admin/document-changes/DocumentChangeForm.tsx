"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export default function DocumentChangeForm() {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const router = useRouter();
  return (
    <details>
      <summary>Prepare an approved version and queue its notice</summary>
      <form
        style={{ display: "grid", gap: 12, maxWidth: 650, marginTop: 16 }}
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          const form = new FormData(event.currentTarget);
          setBusy(true);
          setMessage("");
          try {
            const response = await fetch("/api/admin/document-changes", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(Object.fromEntries(form.entries())),
            });
            const data = await response.json();
            if (!response.ok)
              throw Error(data.error ?? "Notice could not be prepared.");
            setMessage(
              "Approved version recorded. The normal email scheduler will deliver customer notices. Published legal text is unchanged.",
            );
            router.refresh();
          } catch (failure) {
            setMessage(
              failure instanceof Error ? failure.message : "Please retry.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Document slug
          <input name="slug" required maxLength={80} />
        </label>
        <label>
          Approved title
          <input name="title" required maxLength={120} />
        </label>
        <label>
          New version
          <input name="version" required maxLength={50} />
        </label>
        <label>
          Effective date and time (UTC)
          <input name="effectiveAt" type="datetime-local" required />
        </label>
        <label>
          Summary of changes
          <textarea name="summary" required minLength={10} maxLength={5000} />
        </label>
        <label>
          Exact approved HTML
          <textarea
            name="sourceContentHtml"
            required
            minLength={80}
            maxLength={500000}
          />
        </label>
        <label>
          Approved PDF within the legal pack, e.g. 2026-11-01/terms.pdf
          <input name="pdfPath" required />
        </label>
        <label>
          PDF SHA-256
          <input name="pdfSha256" required pattern="[a-f0-9]{64}" />
        </label>
        <label>
          <input name="approved" type="checkbox" required value="yes" /> The
          client approved this exact document and change summary.
        </label>
        <button disabled={busy}>
          {busy ? "Preparing…" : "Record approved version and queue notices"}
        </button>
        {message && <p role="status">{message}</p>}
      </form>
    </details>
  );
}
