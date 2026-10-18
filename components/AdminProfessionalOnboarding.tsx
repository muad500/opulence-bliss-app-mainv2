"use client";
import { FormEvent, useEffect, useState } from "react";
export default function AdminProfessionalOnboarding({
  handymanEnabled,
}: {
  handymanEnabled: boolean;
}) {
  const [invitations, setInvitations] = useState<
    {
      provider_id: string;
      sent_at: string | null;
      providers: { display_name: string } | null;
    }[]
  >([]);
  async function refresh() {
    const result = await fetch("/api/admin/professional-onboarding", {
      cache: "no-store",
    })
      .then((r) => r.json())
      .catch(() => ({}));
    setInvitations(result.invitations ?? []);
  }
  useEffect(() => {
    void refresh();
  }, []);
  async function resend(providerId: string) {
    setBusy(true);
    try {
      const result = await fetch("/api/admin/professional-onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resend", providerId }),
      }).then((r) => r.json());
      setMessage(result.message ?? result.error);
      await refresh();
    } catch {
      setMessage("Invitation could not be sent.");
    } finally {
      setBusy(false);
    }
  }
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      data = new FormData(form);
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/professional-onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          email: data.get("email"),
          phone: data.get("phone"),
          services: data.getAll("services"),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setMessage(result.message);
      form.reset();
      await refresh();
    } catch (failure) {
      setMessage(
        failure instanceof Error ? failure.message : "Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <details
      style={{
        background: "white",
        padding: 20,
        borderRadius: 16,
        marginBlock: 24,
      }}
    >
      <summary style={{ cursor: "pointer", fontWeight: 800 }}>
        Onboard a professional
      </summary>
      <p>
        Create a pending account and send a private setup invitation. This does
        not approve any service or checks.
      </p>
      <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
        <label>
          Full legal name
          <input required name="name" maxLength={160} />
        </label>
        <label>
          Email
          <input required type="email" name="email" />
        </label>
        <label>
          UK phone
          <input required type="tel" name="phone" />
        </label>
        <label>
          <input
            name="services"
            type="checkbox"
            value="cleaning"
            defaultChecked
          />{" "}
          Cleaning
        </label>
        {handymanEnabled && (
          <label>
            <input name="services" type="checkbox" value="handyman" /> Property
            maintenance
          </label>
        )}
        <button disabled={busy}>
          {busy ? "Creating…" : "Create and send setup link"}
        </button>
        <p role="status">{message}</p>
      </form>
      <h3>Pending setup invitations</h3>
      {invitations.map((invite) => (
        <p key={invite.provider_id}>
          {invite.providers?.display_name ?? "Professional"} ·{" "}
          {invite.sent_at ? "Invitation sent" : "Delivery pending"}{" "}
          <button
            disabled={busy}
            onClick={() => void resend(invite.provider_id)}
          >
            Resend setup link
          </button>
        </p>
      ))}
    </details>
  );
}
