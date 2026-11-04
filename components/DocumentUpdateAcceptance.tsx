"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { documentChangeAcceptance } from "@/lib/documentChangePolicy";
import type { AccountRole } from "@/lib/accountRoles";
export default function DocumentUpdateAcceptance({
  plan,
  role,
  title,
  version,
}: {
  plan: string;
  role: AccountRole;
  title: string;
  version: string;
}) {
  const [checked, setChecked] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const router = useRouter();
  async function accept() {
    if (!checked || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/account/document-updates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, role, checked }),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error ?? "Please retry.");
      setChecked(false);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Please retry.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void accept();
      }}
    >
      <label
        style={{
          display: "flex",
          gap: 10,
          alignItems: "start",
          margin: "16px 0",
        }}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          required
        />
        {documentChangeAcceptance(title, version)}
      </label>
      <button type="submit" disabled={!checked || busy}>
        {busy ? "Saving acceptance…" : "Accept this version"}
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
