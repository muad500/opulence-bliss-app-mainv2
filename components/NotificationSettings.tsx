"use client";
import { useEffect, useState } from "react";
import {
  notificationTypes,
  essentialEmailNote,
  type NotificationAudience,
  type NotificationPreference,
  type NotificationChannel,
} from "@/lib/notificationSettings";
import {
  blockedInstructions,
  notificationDeviceId,
  pushRequest,
  pushSupported,
  subscribeDevice,
} from "@/lib/pushBrowser";
import type { PushConfig } from "./PushNotifications";
import styles from "./NotificationSettings.module.css";
type Device = {
  id: string;
  deviceId: string;
  name: string;
  updatedAt: string;
  current: boolean;
};
type Settings = {
  marketingEnabled: boolean;
  enabled: boolean;
  smsEnabled: boolean;
  preferences: NotificationPreference[];
  devices: Device[];
};
export default function NotificationSettings({
  audience,
}: {
  audience: NotificationAudience;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [config, setConfig] = useState<PushConfig | null>(null);
  const [device, setDevice] = useState("");
  const [permission, setPermission] = useState<string>("unsupported");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function load() {
    const c: PushConfig = await fetch("/api/push", { cache: "no-store" }).then(
      (r) => {
        if (!r.ok) throw new Error();
        return r.json();
      },
    );
    if (!c.enabled) return;
    const id = notificationDeviceId(c.userId);
    const s = await fetch(`/api/notification-settings?device=${id}`, {
      cache: "no-store",
    }).then((r) => {
      if (!r.ok) throw new Error();
      return r.json();
    });
    setConfig(c);
    setDevice(id);
    setSettings(s);
    setPermission(pushSupported() ? Notification.permission : "unsupported");
  }
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      if (alive)
        void load().catch(() => {
          if (alive)
            setMessage(
              "Notification settings could not be loaded. Refresh to try again.",
            );
        });
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      alive = false;
      window.removeEventListener("focus", refresh);
    };
  }, []);
  async function act(work: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      await work();
      await load();
      setMessage(success);
      window.dispatchEvent(new Event("opulence:notifications-changed"));
    } catch {
      setMessage("Could not save this change. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  if (!settings || !config)
    return message ? <p role="status">{message}</p> : null;
  const current = settings.devices.find((d) => d.current);
  const eligible =
    audience === "professional" ? config.professional : config.customerEligible;
  const on = Boolean(current && permission === "granted" && !config.optedOut);
  function change(
    kind: string,
    channel: NotificationChannel,
    enabled: boolean,
  ) {
    return act(async () => {
      const r = await fetch("/api/notification-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: device,
          preferences: [{ audience, kind, channel, enabled }],
        }),
      });
      if (!r.ok) throw new Error();
    }, "Notification preference saved.");
  }
  async function turnOn() {
    // Stay before awaits, directly inside the Turn on click handler.
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result !== "granted") {
      setMessage(blockedInstructions);
      return;
    }
    await act(async () => {
      await subscribeDevice(config!.publicKey, config!.userId, true);
    }, "Push is on for this device.");
  }
  return (
    <section
      id="notifications"
      className={styles.panel}
      aria-label="Notification settings"
    >
      <h3>Notifications</h3>
      <p>
        Choose what reaches you and where. Updates in the app always stay on.
      </p>
      <div className={styles.device}>
        <div>
          <h4>This device</h4>
          <p>
            {on
              ? "Push is on for this browser or phone."
              : "Push is off for this browser or phone."}
          </p>
        </div>
        {permission === "denied" ? (
          <p>{blockedInstructions}</p>
        ) : permission === "unsupported" ? (
          <p>
            Use Chrome on Android or a supported desktop browser. iPhone push is
            not available yet.
          </p>
        ) : (
          <div className={styles.actions}>
            <button
              type="button"
              disabled={busy || (!eligible && !on)}
              onClick={() => {
                if (on)
                  void act(async () => {
                    await pushRequest({ action: "disable", deviceId: device });
                    const r =
                      await navigator.serviceWorker.getRegistration("/");
                    await (
                      await r?.pushManager.getSubscription()
                    )?.unsubscribe();
                    r?.active?.postMessage({
                      type: "CLEAR_ACCOUNT_NOTIFICATIONS",
                    });
                  }, "Push is off on this device. Other devices and email are unchanged.");
                else
                  void turnOn().catch(() =>
                    setMessage(
                      "Could not request permission. Please try again.",
                    ),
                  );
              }}
            >
              {on ? "Turn off" : "Turn on"}
            </button>
            <button
              type="button"
              disabled={busy || !on}
              onClick={() =>
                void act(
                  () => pushRequest({ action: "test", deviceId: device }),
                  "Test queued. It should arrive shortly; you can close this app.",
                )
              }
            >
              Send a test notification
            </button>
          </div>
        )}
        {!eligible && (
          <p>
            Customers can turn on push after their first booking. Professionals
            can turn it on after approval.
          </p>
        )}
      </div>
      <p className={styles.essential}>{essentialEmailNote}</p>
      <div
        className={styles.table}
        role="group"
        aria-label="Notification types and channels"
      >
        <div className={styles.row + " " + styles.head}>
          <strong>Type</strong>
          <span>
            Push
            <br />
            <small>This device</small>
          </span>
          <span>Email</span>
          <span>
            SMS
            <br />
            <small>{settings.smsEnabled ? "Available" : "Coming later"}</small>
          </span>
        </div>
        {notificationTypes[audience].map(([kind, label, detail]) => (
          <div className={styles.row} key={kind}>
            <div>
              <strong>{label}</strong>
              <small>{detail}</small>
              {["payments", "booking", "schedule", "checks"].includes(kind) && (
                <small className={styles.badge}>
                  Essential notices: Always on (email)
                </small>
              )}
            </div>
            {(["push", "email", "sms"] as const).map((channel) => (
              <label key={channel}>
                <input
                  type="checkbox"
                  role="switch"
                  aria-label={`${label}: ${channel}${channel === "push" ? " on this device" : ""}`}
                  checked={
                    (audience === "professional" &&
                      channel === "email" &&
                      ["checks", "schedule"].includes(kind)) ||
                    (settings.preferences.find(
                      (p) =>
                        p.audience === audience &&
                        p.kind === kind &&
                        p.channel === channel,
                    )?.enabled ??
                      false)
                  }
                  disabled={
                    busy ||
                    (channel === "sms" && !settings.smsEnabled) ||
                    (audience === "professional" &&
                      channel === "email" &&
                      ["checks", "schedule"].includes(kind))
                  }
                  onChange={(e) => void change(kind, channel, e.target.checked)}
                />
              </label>
            ))}
          </div>
        ))}
      </div>
      <p>
        <small>
          Email toggles control optional notices only. Marketing is a separate
          opt-in, off by default. SMS is not sent while the SMS service is
          switched off.
        </small>
      </p>
      {audience === "professional" && (
        <div className={styles.device}>
          <h4>Marketing (optional)</h4>
          <p>
            Offers and news, separate from work notifications. Off unless you
            opt in.
          </p>
          <label>
            <input
              type="checkbox"
              checked={settings.marketingEnabled}
              disabled={busy}
              onChange={(event) => {
                const enabled = event.target.checked;
                void act(async () => {
                  const response = await fetch("/api/notification-settings", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "marketing", enabled }),
                  });
                  if (!response.ok) throw new Error();
                }, "Marketing preference saved.");
              }}
            />{" "}
            Marketing emails
          </label>
        </div>
      )}
      <h4>Other devices</h4>
      {settings.devices.filter((d) => !d.current).length ? (
        <ul className={styles.devices}>
          {settings.devices
            .filter((d) => !d.current)
            .map((d) => (
              <li key={d.id}>
                <div>
                  <strong>{d.name}</strong>
                  <small>
                    Last registered{" "}
                    {new Date(d.updatedAt).toLocaleDateString("en-GB")}
                  </small>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () =>
                        pushRequest({
                          action: "disable",
                          deviceId: d.deviceId,
                        }),
                      "Device removed. It must be turned on again on that device.",
                    )
                  }
                >
                  Remove
                </button>
              </li>
            ))}
        </ul>
      ) : (
        <p>No other devices are registered.</p>
      )}
      {message && (
        <p role="status" aria-live="polite">
          {message}
        </p>
      )}
    </section>
  );
}
