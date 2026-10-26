"use client";

import { useState } from "react";

export default function StaffInvitations() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <main className="mx-auto max-w-xl space-y-5 p-8">
      <h1 className="text-2xl font-bold">Invite an administrator</h1>
      <p>
        This grants access to customer, booking and professional records after
        authenticator setup. DBS evidence requires a separate named grant in
        Settings.
      </p>
      <form
        className="space-y-5"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setMessage("");
          const form = new FormData(event.currentTarget);
          try {
            const response = await fetch("/api/admin/staff-invitations", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                email: form.get("email"),
                confirmAdminAccess: form.get("confirm") === "on",
              }),
            });
            const result = await response.json();
            setMessage(
              response.ok
                ? `Setup email sent to ${result.email}. Staff setup uses ${result.setupOrigin}.`
                : result.error,
            );
          } catch {
            setMessage("The invitation could not be sent. Please try again.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="block">
          Admin email
          <input
            className="mt-2 block w-full rounded-lg border p-3"
            type="email"
            name="email"
            required
            autoComplete="off"
          />
        </label>
        <label className="flex gap-3">
          <input type="checkbox" name="confirm" required />I confirm this person
          should have administrator access.
        </label>
        <button
          disabled={busy}
          className="rounded-xl bg-purple-700 px-6 py-3 font-semibold text-white"
        >
          {busy ? "Sending setup email…" : "Send admin setup email"}
        </button>
      </form>
      {message && <p role="status">{message}</p>}
    </main>
  );
}
