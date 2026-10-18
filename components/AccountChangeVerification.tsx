"use client";
import { useEffect, useRef, useState } from "react";
import type { AccountCodeRequest } from "@/lib/accountFetch";

export default function AccountChangeVerification() {
  const pending = useRef<AccountCodeRequest | null>(null);
  const [open, setOpen] = useState(false),
    [id, setId] = useState(""),
    [code, setCode] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  function finish(proof: string | null) {
    pending.current?.resolve(proof);
    pending.current = null;
    setOpen(false);
    setCode("");
  }
  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<AccountCodeRequest>).detail;
      if (pending.current) {
        detail.resolve(null);
        return;
      }
      pending.current = detail;
      setId("");
      setCode("");
      setMessage("Send a code to confirm this account change.");
      setOpen(true);
    };
    window.addEventListener("account-change-code", listener);
    return () => {
      window.removeEventListener("account-change-code", listener);
      pending.current?.resolve(null);
    };
  }, []);
  async function submit(action: "send" | "verify") {
    if (!pending.current || busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/account/change-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "send"
            ? { action, requestHash: pending.current.requestHash }
            : { action, id, code },
        ),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Verification is unavailable.");
      if (action === "send") {
        setId(result.id);
        setMessage(
          `We sent a code by ${result.channel} to ${result.destination}. It expires in 10 minutes.`,
        );
      } else finish(result.proof);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  if (!open) return null;
  return (
    <div
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        background: "#16101d99",
        zIndex: 100000,
        display: "grid",
        placeItems: "center",
        padding: 20,
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-code-title"
        style={{
          background: "white",
          color: "#21192d",
          maxWidth: 440,
          width: "100%",
          borderRadius: 20,
          padding: 24,
        }}
      >
        <h2 id="account-code-title">Confirm your change</h2>
        <p role="status">{message}</p>
        {id && (
          <label>
            One-time code
            <input
              autoFocus
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              style={{
                display: "block",
                width: "100%",
                padding: 12,
                marginBlock: 12,
              }}
            />
          </label>
        )}
        <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
          <button
            disabled={busy || (!!id && code.length !== 6)}
            onClick={() => void submit(id ? "verify" : "send")}
          >
            {busy ? "Please wait…" : id ? "Confirm change" : "Send code"}
          </button>
          <button disabled={busy} onClick={() => finish(null)}>
            Cancel
          </button>
        </div>
      </section>
    </div>
  );
}
