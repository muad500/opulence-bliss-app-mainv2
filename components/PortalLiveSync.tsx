"use client";

// Keeps the server-rendered customer and provider portals in step with the
// other participant. Cross-portal booking actions always create a notification
// for the affected user, so that row is the lightweight refresh signal.

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  PORTAL_DATA_UPDATED,
  PORTAL_REFRESH_REQUESTED,
  portalRefreshInterval,
} from "@/lib/portalUpdates";

const supabase = createClient();
const FOCUS_STALE_MS = 5_000;
const DEBOUNCE_MS = 350;

export default function PortalLiveSync({ userId }: { userId: string }) {
  const router = useRouter();
  const path = usePathname() ?? "";
  const [pending, startTransition] = useTransition();
  const [offline, setOffline] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRefreshRef = useRef(Date.now());
  const notifyRef = useRef(false);
  const pendingRef = useRef(false);
  const queuedRef = useRef(false);
  pendingRef.current = pending;

  const refresh = useCallback(
    (notify = false) => {
      notifyRef.current ||= notify;
      if (debounceRef.current) return;
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        if (document.visibilityState !== "visible" || !navigator.onLine) return;
        if (pendingRef.current) {
          queuedRef.current = true;
          return;
        }
        queuedRef.current = false;
        lastRefreshRef.current = Date.now();
        startTransition(() => router.refresh());
        window.dispatchEvent(new Event(PORTAL_DATA_UPDATED));
        if (notifyRef.current)
          window.dispatchEvent(new Event("opulence:notification"));
        notifyRef.current = false;
      }, DEBOUNCE_MS);
    },
    [router, startTransition],
  );

  useEffect(() => {
    if (!pending && queuedRef.current) refresh();
  }, [pending, refresh]);

  useEffect(() => {
    const channel = supabase
      .channel(`portal-live:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        () => refresh(true),
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") refresh();
      });

    const refreshIfVisible = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastRefreshRef.current >= FOCUS_STALE_MS
      ) {
        refresh();
      }
    };
    const refreshNow = () => refresh();
    const online = () => {
      setOffline(false);
      refresh();
    };
    const wentOffline = () => setOffline(true);
    setOffline(!navigator.onLine);

    const fallback = window.setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine) refresh();
    }, portalRefreshInterval(path));

    window.addEventListener("focus", refreshIfVisible);
    window.addEventListener("online", online);
    window.addEventListener("offline", wentOffline);
    window.addEventListener(PORTAL_REFRESH_REQUESTED, refreshNow);
    document.addEventListener("visibilitychange", refreshIfVisible);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = null;
      queuedRef.current = false;
      window.clearInterval(fallback);
      window.removeEventListener("focus", refreshIfVisible);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", wentOffline);
      window.removeEventListener(PORTAL_REFRESH_REQUESTED, refreshNow);
      document.removeEventListener("visibilitychange", refreshIfVisible);
      void supabase.removeChannel(channel);
    };
  }, [refresh, userId, path]);

  return (
    <div
      role="status"
      aria-live="polite"
      style={{ minHeight: 24, fontSize: 12, color: "var(--ob-muted)" }}
    >
      {offline
        ? "You’re offline. Job updates will resume when you reconnect."
        : pending
          ? "Checking the latest updates…"
          : null}
    </div>
  );
}
