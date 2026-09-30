"use client";

import { useState } from "react";

export default function PhotoUpload({ professional = false, onChanged }: {
  professional?: boolean;
  onChanged: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  async function upload(file: File) {
    setBusy(true); setFeedback("");
    try {
      const form = new FormData();
      form.set("file", file); form.set("scope", professional ? "professional" : "client");
      const response = await fetch("/api/account/photo", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Photo could not be saved.");
      await onChanged(); setFeedback("Photo saved.");
    } catch (error) { setFeedback(error instanceof Error ? error.message : "Photo could not be saved."); }
    finally { setBusy(false); }
  }
  return <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
    <label style={{ display: "grid", gap: 8 }}>Profile photo <small>Optional</small>
      <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(event) => {
        const file = event.target.files?.[0]; event.target.value = "";
        if (file) void upload(file);
      }} />
    </label>
    <small>{professional ? "Shown on your public professional profile." : "Private to your account."} JPEG, PNG or WebP, up to 4 MB.</small>
    <button type="button" disabled={busy} onClick={async () => {
      setBusy(true); setFeedback("");
      try {
        const response = await fetch(`/api/account/photo?scope=${professional ? "professional" : "client"}`, { method: "DELETE" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Photo could not be removed.");
        await onChanged(); setFeedback("Photo removed.");
      } catch (error) { setFeedback(error instanceof Error ? error.message : "Photo could not be removed."); }
      finally { setBusy(false); }
    }}>{busy ? "Saving…" : "Remove photo"}</button>
    {feedback && <small role="status">{feedback}</small>}
  </div>;
}
