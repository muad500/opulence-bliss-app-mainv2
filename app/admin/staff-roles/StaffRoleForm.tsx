"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { STAFF_ROLE_LABELS } from "@/lib/staffPermissions";
export default function StaffRoleForm({
  profile,
  role,
  active,
}: {
  profile: string;
  role: string;
  active: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const router = useRouter();
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        const form = new FormData(event.currentTarget);
        setBusy(true);
        setMessage("");
        try {
          const response = await fetch("/api/admin/staff-roles", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              profile,
              role: form.get("role"),
              active: form.get("active") === "on",
              reason: form.get("reason"),
            }),
          });
          const data = await response.json();
          if (!response.ok)
            throw Error(data.error ?? "Staff access could not be saved.");
          setMessage("Staff access saved and logged.");
          router.refresh();
        } catch (failure) {
          setMessage(
            failure instanceof Error ? failure.message : "Please retry.",
          );
        } finally {
          setBusy(false);
        }
      }}
      style={{ display: "grid", gap: 12, maxWidth: 460 }}
    >
      <label>
        Staff role
        <select name="role" defaultValue={role}>
          {Object.entries(STAFF_ROLE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <input name="active" type="checkbox" defaultChecked={active} /> Access
        active
      </label>
      <label>
        Reason for changing access
        <textarea name="reason" required minLength={10} maxLength={1000} />
      </label>
      <button disabled={busy}>
        {busy ? "Saving…" : "Save named staff access"}
      </button>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
