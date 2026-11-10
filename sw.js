// Sensei English service worker: keeps the app (especially the vocabulary cards) usable offline.
// Change CACHE_VERSION when you add or rename files in PRECACHE, so old caches are cleaned up.
const CACHE_VERSION = "sensei-v1";

const PRECACHE = [
  "./",
  "./vocab.html",
  "./dashboard.html",
  "./index.html",
  "./app.js",
  "./app.css",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
];

// How long to wait for the network before using the cached copy (slow mobile connections).
const NETWORK_TIMEOUT_MS = 3000;

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first (so students get updates when online), cache as fallback (so it works offline).
// Only same-origin GET requests are handled — the Claude API call (POST to another site) is never cached.
self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE_VERSION);

  const fromNetwork = fetch(req).then(res => {
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  });

  try {
    return await withTimeout(fromNetwork, NETWORK_TIMEOUT_MS);
  } catch (e) {
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    // Network was only slow, not down: keep waiting for it.
    try { return await fromNetwork; } catch (e2) {}
    // Offline and the page is not cached: open the vocabulary cards instead.
    if (req.mode === "navigate") {
      const fallback = await cache.match("./vocab.html");
      if (fallback) return fallback;
    }
    return new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
  }
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      v => { clearTimeout(timer); resolve(v); },
      e => { clearTimeout(timer); reject(e); }
    );
  });
}
