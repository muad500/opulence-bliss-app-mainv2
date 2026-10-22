"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  blockedInstructions,
  notificationDeviceId,
  pushRequest,
  pushSupported,
  subscribeDevice,
} from "@/lib/pushBrowser";
import { promptDue } from "@/lib/notificationSettings";
import styles from "./PushNotifications.module.css";
export type PushConfig = {
  enabled: boolean;
  eligible: boolean;
  optedOut: boolean;
  hasConsent: boolean;
  publicKey: string;
  userId: string;
  professional: boolean;
  customerEligible: boolean;
  customerCanEnable: boolean;
  promptAfter: string | null;
};
export default function PushNotifications() {
  const path = usePathname() ?? "/";
  const [config, setConfig] = useState<PushConfig | null>(null);
  const [active, setActive] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    if (!pushSupported() || !/^\/(account|worker|mobile|book)(\/|$)/.test(path))
      return;
    let alive = true;
    const load = async () => {
      try {
        const response = await fetch("/api/push", { cache: "no-store" });
        const c: PushConfig | null = response.ok ? await response.json() : null;
        if (!alive) return;
        const eligible = /^\/(worker|mobile\/worker)(\/|$)/.test(path)
          ? c?.professional
          : c?.customerEligible;
        setConfig(c?.enabled && eligible ? c : null);
        setBlocked(Notification.permission === "denied");
        if (!c?.eligible || !c.enabled) return;
        setDismissed(!promptDue(c.promptAfter));
        if (
          c.hasConsent &&
          !c.optedOut &&
          Notification.permission === "granted"
        ) {
          // Refresh an EXISTING device only; never reverse a removed device.
          const r = await navigator.serviceWorker.getRegistration("/");
          const s = await r?.pushManager.getSubscription();
          const device = notificationDeviceId(c.userId);
          const settings = await fetch(
            `/api/notification-settings?device=${device}`,
            { cache: "no-store" },
          ).then((r) => r.json());
          if (
            s &&
            settings.devices?.some((d: { current: boolean }) => d.current)
          ) {
            await subscribeDevice(c.publicKey, c.userId);
            if (alive) setActive(true);
          } else if (alive) setActive(false);
        } else setActive(false);
      } catch {
        /* Never request permission or enrol on failure. */
      }
    };
    void load();
    window.addEventListener("focus", load);
    window.addEventListener("opulence:notifications-changed", load);
    return () => {
      alive = false;
      window.removeEventListener("focus", load);
      window.removeEventListener("opulence:notifications-changed", load);
    };
  }, [path]);
  useEffect(() => {
    const { data } = createClient().auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_OUT") return;
      setConfig(null);
      setActive(false);
      if ("serviceWorker" in navigator)
        void navigator.serviceWorker.getRegistration("/").then(async (r) => {
          await (await r?.pushManager.getSubscription())?.unsubscribe();
          r?.active?.postMessage({ type: "CLEAR_ACCOUNT_NOTIFICATIONS" });
        });
    });
    return () => data.subscription.unsubscribe();
  }, []);
  if (
    !config ||
    /\/(profile|settings)(\/|$)/.test(path) ||
    active ||
    config.optedOut ||
    dismissed
  )
    return null;
  async function enable() {
    setBusy(true);
    setMessage("");
    try {
      // The ONLY permission request is directly in the user's click handler.
      // Chrome delegates it to Android 13+ through the verified TWA service.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setBlocked(permission === "denied");
        setMessage(blockedInstructions);
        return;
      }
      await subscribeDevice(config!.publicKey, config!.userId, true);
      setActive(true);
      window.dispatchEvent(new Event("opulence:notifications-changed"));
    } catch {
      setMessage("Could not turn on notifications. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  async function later() {
    setBusy(true);
    try {
      await pushRequest({ action: "snooze" });
      setDismissed(true);
    } catch {
      setMessage("Could not save your choice. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={styles.panel} aria-label="Notifications">
      <div>
        <strong>
          {blocked
            ? "Notifications are blocked"
            : "A useful update, right when you need it"}
        </strong>
        <p>
          {blocked
            ? blockedInstructions
            : /^\/(worker|mobile\/worker)(\/|$)/.test(path)
              ? "Turn on notifications for new job offers, changes to your jobs and customer messages."
              : "Turn on notifications to know when a cleaner accepts, is on the way, or messages you."}
        </p>
        {message && <p role="status">{message}</p>}
      </div>
      <div className={styles.actions}>
        {!blocked && (
          <button disabled={busy} onClick={() => void enable()}>
            Turn on
          </button>
        )}
        <button
          className={styles.later}
          disabled={busy}
          onClick={() => void later()}
        >
          {blocked ? "Dismiss for 14 days" : "Not now"}
        </button>
      </div>
    </section>
  );
}
