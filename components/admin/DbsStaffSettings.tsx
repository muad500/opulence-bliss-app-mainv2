"use client";

import { useEffect, useState } from "react";

type Staff = { id: string; full_name: string | null; email: string };
type AccessEvent = {
  id: number;
  actor_id: string;
  provider_id: string | null;
  action: string;
  created_at: string;
};
export default function DbsStaffSettings() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [events, setEvents] = useState<AccessEvent[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    fetch("/api/admin/dbs-staff", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error();
        setStaff(data.staff);
        setSelected(data.selected);
        setEvents(data.events);
        setReady(true);
      })
      .catch(() =>
        setMessage(
          "Onboarding access could not be loaded. Refresh to try again.",
        ),
      );
  }, []);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/dbs-staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selected }),
      });
      if (!response.ok) throw new Error();
      setMessage(
        "Named onboarding staff saved. Only these staff can view or review DBS evidence.",
      );
    } catch {
      setMessage("Access could not be saved. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section style={{ marginTop: 32 }}>
      <h2>DBS onboarding access</h2>
      <p>
        Choose the named onboarding staff. Admin access alone is not enough.
        Every record and certificate view is logged; certificate copies are
        deleted after verification.
      </p>
      {message && <p role="status">{message}</p>}
      <form onSubmit={save}>
        <fieldset
          disabled={!ready || busy}
          style={{ padding: 18, border: "1px solid #e3ddef", borderRadius: 12 }}
        >
          <legend>Named staff</legend>
          {staff.map((person) => (
            <label
              key={person.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                margin: "12px 0",
              }}
            >
              <input
                type="checkbox"
                checked={selected.includes(person.id)}
                onChange={(e) =>
                  setSelected((ids) =>
                    e.target.checked
                      ? [...ids, person.id]
                      : ids.filter((id) => id !== person.id),
                  )
                }
              />
              {person.full_name || person.email} ({person.email})
            </label>
          ))}
          {ready && !selected.length && (
            <p>No staff currently have DBS viewing access.</p>
          )}
          <button disabled={!ready || busy}>Save onboarding access</button>
        </fieldset>
      </form>
      <details style={{ marginTop: 16 }}>
        <summary>Recent DBS access (last 30)</summary>
        <ul>
          {events.map((event) => (
            <li key={event.id}>
              {new Date(event.created_at).toLocaleString("en-GB")} ·{" "}
              {staff.find((person) => person.id === event.actor_id)
                ?.full_name || event.actor_id}{" "}
              · {event.action.replaceAll("_", " ")}
              {event.provider_id && (
                <>
                  {" "}
                  ·{" "}
                  <a href={`/admin/cleaners/${event.provider_id}`}>
                    Professional record
                  </a>
                </>
              )}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
