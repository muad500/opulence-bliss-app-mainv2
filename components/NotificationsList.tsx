"use client";

// SETUP: mkdir -p "components" && code "components/NotificationsList.tsx"
//
// One list, used inside both the customer and provider portals.

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import LoadingState from "./LoadingState";
import { PORTAL_DATA_UPDATED, requestPortalRefresh } from "@/lib/portalUpdates";
import Link from "next/link";

const supabase = createClient();

const GRAD = "linear-gradient(100deg,#F5C542,#C86FC9 55%,#7B2FF7)";
const PURPLE = "var(--ob-purple)";

type Note = {
  id: string;
  title: string;
  body: string | null;
  href: string | null;
  read: boolean;
  created_at: string;
};

function ago(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

export default function NotificationsList() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [marking, setMarking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const version = useRef(0);
  const markingRef = useRef(false);

  const load = useCallback(async () => {
    const current = ++version.current;
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (current !== version.current) return;
      if (!user) {
        setNotes([]);
        setLoading(false);
        return;
      }
      const { data, error: failure } = await supabase
        .from("notifications")
        .select("id, title, body, href, read, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (current !== version.current) return;
      if (failure) throw failure;
      setNotes((data ?? []) as Note[]);
      setError(null);
    } catch {
      if (current === version.current)
        setError("Updates could not be loaded. Please try again.");
    } finally {
      if (current === version.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const refresh = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener(PORTAL_DATA_UPDATED, refresh);
    window.addEventListener("opulence:notification", refresh);
    window.addEventListener("online", refresh);
    return () => {
      // This is a request counter, not a DOM ref: invalidate all pending reads.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      version.current++;
      window.removeEventListener(PORTAL_DATA_UPDATED, refresh);
      window.removeEventListener("opulence:notification", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [load]);

  async function markAll() {
    if (markingRef.current) return;
    markingRef.current = true;
    setMarking(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { error: failure } = await supabase
        .from("notifications")
        .update({ read: true })
        .eq("user_id", user.id)
        .eq("read", false);
      if (failure) throw failure;
      await load();
      requestPortalRefresh();
    } catch {
      setError("Could not mark updates as read. Please try again.");
    } finally {
      markingRef.current = false;
      setMarking(false);
    }
  }

  const unread = notes.filter((n) => !n.read).length;

  if (loading) {
    return <LoadingState title="Loading your updates…" compact />;
  }

  const feedback = error ? (
    <p role="alert" style={muted}>
      {error}{" "}
      <button onClick={() => void load()} style={markBtn}>
        Try again
      </button>
    </p>
  ) : null;

  if (notes.length === 0) {
    return (
      <div style={empty}>
        {feedback}
        <span style={{ fontSize: 34 }}>✦</span>
        <strong style={{ fontSize: 17, fontWeight: 900, marginTop: 8 }}>
          Nothing yet
        </strong>
        <p
          style={{
            margin: "5px 0 0",
            color: "var(--ob-muted)",
            fontWeight: 600,
          }}
        >
          Updates about your bookings will appear here.
        </p>
      </div>
    );
  }

  return (
    <>
      {feedback}
      <div style={topRow}>
        <span style={muted}>
          {unread > 0 ? `${unread} unread` : "All caught up"}
        </span>
        {unread > 0 && (
          <button
            style={markBtn}
            onClick={markAll}
            disabled={marking}
            aria-busy={marking}
          >
            {marking ? "Marking as read…" : "Mark all as read"}
          </button>
        )}
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        {notes.map((n) => {
          const inner = (
            <>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong style={noteTitle}>{n.title}</strong>
                {n.body && <p style={noteBody}>{n.body}</p>}
              </div>
              <span style={when}>{ago(n.created_at)}</span>
            </>
          );

          const style: React.CSSProperties = {
            ...card,
            backgroundImage: n.read
              ? "none"
              : `${GRAD}, linear-gradient(var(--ob-surface-raised),var(--ob-surface-raised))`,
            backgroundSize: n.read ? "auto" : "4px 100%, 100% 100%",
            backgroundPosition: n.read ? "center" : "left center, center",
            backgroundRepeat: "no-repeat",
          };

          return n.href ? (
            <Link key={n.id} href={n.href} style={style}>
              {inner}
            </Link>
          ) : (
            <div key={n.id} style={style}>
              {inner}
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ---------- styles ---------- */

const muted: React.CSSProperties = {
  color: "var(--ob-muted)",
  fontSize: 14.5,
  fontWeight: 700,
};

const topRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  marginBottom: 14,
};

const markBtn: React.CSSProperties = {
  background: "var(--ob-surface-raised)",
  border: "2px solid var(--ob-border)",
  borderRadius: 999,
  padding: "8px 16px",
  fontFamily: "'Nunito', system-ui, sans-serif",
  fontSize: 13.5,
  fontWeight: 800,
  color: PURPLE,
  cursor: "pointer",
};

const card: React.CSSProperties = {
  display: "flex",
  gap: 14,
  alignItems: "flex-start",
  background: "var(--ob-surface-raised)",
  border: "2px solid var(--ob-border)",
  borderRadius: 16,
  padding: "16px 18px",
  textDecoration: "none",
  color: "var(--ob-text)",
};

const noteTitle: React.CSSProperties = {
  display: "block",
  fontSize: 15.5,
  fontWeight: 900,
  marginBottom: 3,
};

const noteBody: React.CSSProperties = {
  margin: 0,
  fontSize: 14,
  fontWeight: 600,
  color: "var(--ob-muted)",
  lineHeight: 1.5,
};

const when: React.CSSProperties = {
  fontSize: 12.5,
  fontWeight: 700,
  color: "var(--ob-muted)",
  whiteSpace: "nowrap",
};

const empty: React.CSSProperties = {
  background: "var(--ob-surface-raised)",
  border: "2px dashed var(--ob-border-strong)",
  borderRadius: 20,
  padding: "36px 24px",
  textAlign: "center",
  display: "grid",
  placeItems: "center",
};
