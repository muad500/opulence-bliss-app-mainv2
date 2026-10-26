"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function HoldForm({ id }: { id?: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const router = useRouter();
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setMessage("");
        const form = new FormData(event.currentTarget);
        try {
          const response = await fetch("/api/admin/data-retention", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              id
                ? { resolveId: id, reason: form.get("reason") }
                : Object.fromEntries(form),
            ),
          });
          const data = await response.json();
          if (!response.ok)
            throw Error(data.error || "Could not save the hold.");
          setMessage(id ? "Hold resolved." : "Hold added.");
          router.refresh();
        } catch (error) {
          setMessage(
            error instanceof Error ? error.message : "Could not save the hold.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      {!id && (
        <>
          <label>
            Record type{" "}
            <select name="kind" required>
              <option value="user">Account</option>
              <option value="booking">Cleaning booking</option>
              <option value="handyman">Property maintenance job</option>
              <option value="enquiry">Enquiry</option>
            </select>
          </label>
          <label>
            Record reference{" "}
            <input name="recordId" required placeholder="Full record UUID" />
          </label>
        </>
      )}
      <label>
        {id ? "Resolution reason" : "Reason to retain these records"}
        <textarea
          name="reason"
          required
          minLength={10}
          maxLength={1000}
          rows={3}
        />
      </label>
      <button disabled={busy} type="submit">
        {busy ? "Saving…" : id ? "Resolve hold" : "Add retention hold"}
      </button>
      <p role="status">{message}</p>
    </form>
  );
}
