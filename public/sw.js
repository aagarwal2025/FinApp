// Service worker: cache-first for the app shell so FinApp opens offline and
// installs cleanly on Android. API requests (/api/*) always go to the network
// — they have their own server-side cache and must stay fresh.
const CACHE = "finapp-shell-v8";
const SHELL = [
  "/",
  "/index.html",
  "/css/app.css",
  "/js/app.js",
  "/js/data.js",
  "/js/chart.js",
  "/js/portfolio.js",
  "/js/backtest.js",
  "/js/strategy.js",
  "/js/mentor.js",
  "/js/daily.js",
  "/js/credits.js",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return; // never cache POSTs (mentor)
  if (url.pathname.startsWith("/api/")) return; // network only for data/mentor

  // Cache-first for the shell, with a network fallback that refreshes the cache.
  e.respondWith(
    caches.match(e.request).then(
      (hit) =>
        hit ||
        fetch(e.request).then((res) => {
          if (res.ok && url.origin === self.location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        }).catch(() => caches.match("/index.html")),
    ),
  );
});
