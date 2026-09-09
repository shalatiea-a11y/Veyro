// v4: stale-while-revalidate. v3's network-first-with-reload forced a real
// network round-trip for EVERY same-origin file on EVERY navigation
// (every HTML page, every JS file, the CSS) — even when nothing had
// changed. That's the actual root cause of the multi-second white screen
// on every tap between pages: it wasn't a data-loading delay, it was the
// service worker refusing to answer from cache at all. Now: answer
// instantly from cache when a cached copy exists (so navigation feels
// immediate), and fetch in the background to refresh the cache for next
// time — so a code change still reaches users within one navigation or
// two, without making every single navigation pay for a network round-trip.
const CACHE = "rios-v13";
const ASSETS = [
  "index.html", "manager.html", "login.html", "admin.html", "signup.html", "join.html", "delivery.html",
  "style.css", "config.js", "auth.js", "storage.js", "ui.js", "app.js", "manager.js", "admin.js", "delivery.js",
  "manifest.json", "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) {
    return; // never intercept Supabase API calls or non-GET requests
  }
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(e.request);
      // Always refresh the cache in the background, whether or not we can
      // answer from it immediately — this is what keeps code changes
      // reaching users without making every navigation wait on it.
      const refresh = fetch(e.request, { cache: "reload" })
        .then((res) => { cache.put(e.request, res.clone()); return res; })
        .catch(() => null);
      if (cached) return cached;
      return (await refresh) || Response.error();
    })
  );
});
