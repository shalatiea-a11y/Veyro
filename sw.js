// v3: switched from cache-first to network-first for same-origin app files.
// Cache-first meant that once a user installed the PWA, every future code
// change (including the security/reliability fixes in this repo's history)
// would silently NOT reach them until this file's CACHE constant changed
// AND they happened to reopen the app with a network connection to let the
// browser notice the updated sw.js — a real "users stuck on old, possibly
// buggy code indefinitely" risk for an app under active development. Now:
// try the network first (so a signed-in user always gets current code and
// current data), and only fall back to the cached copy if the network is
// unreachable — which is exactly the case where a fallback earns its keep.
const CACHE = "rios-v4";
const ASSETS = [
  "index.html", "manager.html", "login.html", "admin.html", "signup.html", "join.html",
  "style.css", "config.js", "auth.js", "storage.js", "app.js", "manager.js", "admin.js",
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
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
