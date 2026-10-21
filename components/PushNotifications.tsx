"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import styles from "./PushNotifications.module.css";

type Config = {
  enabled: boolean;
  eligible: boolean;
  optedOut: boolean;
  publicKey: string;
  userId: string;
};
const supported = () =>
  window.isSecureContext &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window &&
  !/iPhone|iPad|iPod/.test(navigator.userAgent) &&
  !(navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const request = async (body: object) => {
  const r = await fetch("/api/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error("Could not save notifications. Please try again.");
};
async function subscribe(key: string) {
  const registration = await navigator.serviceWorker.register(
    "/app-worker.js",
    { scope: "/" },
  );
  await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    const bytes = Uint8Array.from(
      atob(key.replace(/-/g, "+").replace(/_/g, "/")),
      (c) => c.charCodeAt(0),
    );
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: bytes,
    });
  }
  await request({ subscription: subscription.toJSON() });
}
export default function PushNotifications() {
  const path = usePathname() ?? "/";
  const [config, setConfig] = useState<Config | null>(null);
  const [active, setActive] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!supported() || !/^\/(account|worker|mobile|book)(\/|$)/.test(path))
      return;
    let cancelled = false;
    void fetch("/api/push", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(async (c: Config | null) => {
        if (cancelled || !c?.enabled || !c.eligible || !c.publicKey) return;
        setConfig(c);
        try {
          setDismissed(
            sessionStorage.getItem(`push-later-${c.userId}`) === "true",
          );
        } catch {}
        if (!c.optedOut && Notification.permission === "granted") {
          try {
            await subscribe(c.publicKey);
            if (!cancelled) setActive(true);
          } catch {
            /* Show the manual retry control. */
          }
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [path]);
  useEffect(() => {
    const { data } = createClient().auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_OUT") return;
      setConfig(null);
      setActive(false);
      if ("serviceWorker" in navigator)
        void navigator.serviceWorker
          .getRegistration("/")
          .then(async (registration) => {
            await (
              await registration?.pushManager.getSubscription()
            )?.unsubscribe();
            registration?.active?.postMessage({
              type: "CLEAR_ACCOUNT_NOTIFICATIONS",
            });
          });
    });
    return () => data.subscription.unsubscribe();
  }, []);
  const settings = /\/(profile|account|settings)$/.test(path);
  if (
    !config ||
    (!settings &&
      (dismissed ||
        active ||
        config.optedOut ||
        Notification.permission === "denied"))
  )
    return null;
  async function enable() {
    setBusy(true);
    setMessage("");
    try {
      // Permission is requested only from this explicit click, never on launch.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setMessage(
          "Notifications are off. You can change this in your browser or Android app settings.",
        );
        return;
      }
      await subscribe(config!.publicKey);
      setActive(true);
      setConfig((c) => c && { ...c, optedOut: false });
      setMessage("Notifications enabled on this device.");
    } catch {
      setMessage("Could not enable notifications. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  async function disable() {
    setBusy(true);
    try {
      await request({ action: "disable" });
      const registration = await navigator.serviceWorker.getRegistration("/");
      await (await registration?.pushManager.getSubscription())?.unsubscribe();
      registration?.active?.postMessage({
        type: "CLEAR_ACCOUNT_NOTIFICATIONS",
      });
      setActive(false);
      setConfig((c) => c && { ...c, optedOut: true });
      setMessage(
        "Push notifications disabled on all your devices. Emails are unchanged.",
      );
    } catch {
      setMessage("Could not disable notifications. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={styles.panel} aria-label="Push notifications">
      <div>
        <strong>
          {active
            ? "Device notifications are on"
            : "Keep up with your bookings and jobs"}
        </strong>
        <p>
          Optional alerts for visits, messages and job offers. Your existing
          notification preferences still apply.
        </p>
        {message && <p role="status">{message}</p>}
      </div>
      <div className={styles.actions}>
        <button disabled={busy} onClick={active ? disable : enable}>
          {busy ? "Saving…" : active ? "Turn off push" : "Enable notifications"}
        </button>
        {!settings && (
          <button
            className={styles.later}
            onClick={() => {
              setDismissed(true);
              try {
                sessionStorage.setItem(`push-later-${config.userId}`, "true");
              } catch {}
            }}
          >
            Not now
          </button>
        )}
      </div>
    </section>
  );
}
