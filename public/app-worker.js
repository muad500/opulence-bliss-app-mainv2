const OFFLINE_CACHE = "opulence-offline-v1";
const OFFLINE_PAGE = "/offline.html";

// No private response or notification payload is cached. Resolve the account
// again before showing a background notification, including after sign-out.
self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let data;
      try {
        data = event.data?.json();
      } catch {
        return;
      }
      if (!data || typeof data.userId !== "string") return;
      const response = await fetch("/api/push", {
        credentials: "include",
        cache: "no-store",
      }).catch(() => null);
      if (!response?.ok) return;
      const config = await response.json();
      if (!config.enabled || config.optedOut || config.userId !== data.userId)
        return;
      const href =
        typeof data.href === "string" &&
        /^\/(account|worker|handyman)(\/|$)/.test(data.href) &&
        !/[\\\s?#]/.test(data.href)
          ? data.href
          : "/notifications";
      await self.registration.showNotification(
        String(data.title || "Opulence Bliss").slice(0, 80),
        {
          body: String(data.body || "You have an account update.").slice(
            0,
            180,
          ),
          icon: "/icons/app-192.png",
          badge: "/icons/push-badge.png",
          tag: String(data.tag || "opulence-update").slice(0, 80),
          data: { href },
        },
      );
    })(),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = event.notification.data?.href;
  const target = new URL(
    typeof href === "string" &&
      /^\/(account|worker|handyman)(\/|$)/.test(href) &&
      !/[\\\s?#]/.test(href)
      ? href
      : "/notifications",
    self.location.origin,
  );
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of windows) {
        if (
          new URL(client.url).origin === target.origin &&
          "navigate" in client
        ) {
          await client.navigate(target.href);
          await client.focus();
          return;
        }
      }
      await self.clients.openWindow(target.href);
    })(),
  );
});
self.addEventListener("message", (event) => {
  if (event.data?.type === "CLEAR_ACCOUNT_NOTIFICATIONS")
    event.waitUntil(
      self.registration
        .getNotifications()
        .then((items) => items.forEach((item) => item.close())),
    );
});

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(OFFLINE_CACHE).then((cache) => cache.add(OFFLINE_PAGE)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key.startsWith("opulence-offline-") && key !== OFFLINE_CACHE,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    request.mode !== "navigate" ||
    url.origin !== self.location.origin
  ) {
    return;
  }

  // Never cache accounts, bookings, payments, messages, API responses or sessions.
  // Only an interrupted page load receives the public offline help screen.
  event.respondWith(
    fetch(request).catch(async () => {
      const cached = await caches.match(OFFLINE_PAGE);
      return (
        cached ||
        new Response("Reconnect to use Opulence Bliss.", { status: 503 })
      );
    }),
  );
});
