const CACHE_NAME = "abc-resort-shell-v4";
const APP_SHELL = [
  "/app.css",
  "/manifest.webmanifest",
  "/offline.html",
  "/icons/app-icon.svg",
  "/icons/app-icon-192.png",
  "/icons/app-icon-512.png"
];
const CACHEABLE_API_PATHS = new Set([
  "/api/customer/mobile-home",
  "/api/system/health"
]);
const NEVER_CACHE_PATHS = new Set([
  "/logout",
  "/auth/logout"
]);

const isCacheableResponse = (response) => {
  if (!response || !response.ok || response.type !== "basic") return false;
  const cacheControl = response.headers.get("Cache-Control") || "";
  return !cacheControl.toLowerCase().includes("no-store");
};

const safeCachePut = async (request, response) => {
  if (!isCacheableResponse(response)) return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response.clone()).catch(() => undefined);
};

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (NEVER_CACHE_PATHS.has(url.pathname) || request.headers.has("range")) return;

  if (url.pathname.startsWith("/api/")) {
    if (!CACHEABLE_API_PATHS.has(url.pathname)) return;
    event.respondWith(
      fetch(request)
        .then((response) => {
          safeCachePut(request, response).catch(() => undefined);
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const contentType = response.headers.get("Content-Type") || "";
          if (contentType.includes("text/html")) {
            safeCachePut(request, response).catch(() => undefined);
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached || caches.match("/offline.html");
        })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          safeCachePut(request, response).catch(() => undefined);
          return response;
        })
        .catch(() => cached);

      return cached || networkFetch;
    })
  );
});
