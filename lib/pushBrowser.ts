// A functional device identifier only; no marketing identifier or private data.
// Preferences survive a browser restart, while account navigation uses sessionStorage.
export function notificationDeviceId(userId: string) {
  const key = `opulence-push-device-${userId}`;
  const existing = localStorage.getItem(key);
  if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(key, id);
  return id;
}
export const pushSupported = () =>
  window.isSecureContext &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window &&
  !/iPhone|iPad|iPod/.test(navigator.userAgent) &&
  !(navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export async function pushRequest(body: object) {
  const response = await fetch("/api/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error("Could not save notifications. Please try again.");
  return response.json();
}
export async function subscribeDevice(
  publicKey: string,
  userId: string,
  explicit = false,
) {
  const deviceId = notificationDeviceId(userId);
  const registration = await navigator.serviceWorker.register(
    "/app-worker.js",
    { scope: "/" },
  );
  await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (explicit && subscription) {
    await subscription.unsubscribe();
    subscription = null;
  }
  if (!subscription) {
    const bytes = Uint8Array.from(
      atob(publicKey.replace(/-/g, "+").replace(/_/g, "/")),
      (c) => c.charCodeAt(0),
    );
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: bytes,
    });
  }
  await pushRequest({
    subscription: subscription.toJSON(),
    optIn: explicit,
    deviceId,
    deviceName: /Android/i.test(navigator.userAgent)
      ? "Android phone"
      : "Computer browser",
  });
}
export const blockedInstructions =
  "Notifications are blocked. In Chrome, open Site settings → Notifications and choose Allow. On Android, also check Settings → Apps → Opulence Bliss (or Opulence Bliss Pro) → Notifications. Then return here and turn them on.";
