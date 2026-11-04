"use client";
import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAppAudience } from "./MobileExperience";
import { ROLE_LABELS, type AccountRoleRecord } from "@/lib/accountRoles";

export default function AccountRoleSwitch({
  fallback,
}: {
  fallback: ReactNode;
}) {
  const audience = useAppAudience();
  const router = useRouter();
  const [roles, setRoles] = useState<AccountRoleRecord[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (audience) return;
    const controller = new AbortController();
    void fetch("/api/account/roles", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data?.roles) setRoles(data.roles);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [audience]);
  if (audience) return null;
  if (!roles) return fallback;
  async function choose(role: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/account/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const result = await response.json();
      if (!response.ok)
        throw Error(result.error ?? "This role could not be opened.");
      router.push(result.href);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Please retry.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div aria-label="Account roles" style={{ display: "grid", gap: 6 }}>
      {roles.map((role) => (
        <button
          key={role.role}
          type="button"
          disabled={busy}
          onClick={() => void choose(role.role)}
          style={{
            padding: "9px 12px",
            border: "1px solid var(--ob-border)",
            borderRadius: 10,
            textAlign: "left",
            background: "var(--ob-surface-raised)",
            color: "var(--ob-text)",
            fontWeight: 800,
          }}
        >
          {role.role === "customer" ? "Book a service" : ROLE_LABELS[role.role]}
          {role.status !== "active" && ` · ${role.status.replaceAll("_", " ")}`}
        </button>
      ))}
      <Link href="/account/roles">Manage my roles</Link>
      {error && <small role="alert">{error}</small>}
    </div>
  );
}
