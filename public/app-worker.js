const OFFLINE_CACHE = "opulence-offline-v1";
const OFFLINE_PAGE = "/offline.html";

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
