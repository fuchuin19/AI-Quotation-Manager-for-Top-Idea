// Service worker for the quotation app's PWA shell.
//
// Scope, deliberately narrow:
//   - App shell (HTML/CSS/JS) — cached opportunistically so the app still
//     opens if the showroom wifi drops.
//   - GET /api/products (the catalogue) — cached so items can still be
//     added by hand while offline.
//   - Everything else (scanning, export, admin) is left completely alone —
//     those must always hit the network fresh, never served from a cache
//     and never written into one.
//
// Bump CACHE_VERSION on any deploy that should invalidate old clients'
// caches. The activate handler deletes every cache that doesn't match the
// current version, so nobody is ever stuck on a stale shell after an update.
const CACHE_VERSION = "v1";
const SHELL_CACHE = `qb-shell-${CACHE_VERSION}`;
const CATALOG_CACHE = `qb-catalog-${CACHE_VERSION}`;
const CURRENT_CACHES = new Set([SHELL_CACHE, CATALOG_CACHE]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(["/", "/manifest.json"]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => !CURRENT_CACHES.has(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only ever intercept simple same-origin GETs. Scanning and export are
  // POST already, so this alone keeps them untouched — the pathname checks
  // below are a second, explicit guard for those plus the admin page.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (
    url.pathname.startsWith("/api/scan") ||
    url.pathname.startsWith("/api/export") ||
    url.pathname.startsWith("/api/admin") ||
    url.pathname.startsWith("/admin")
  ) {
    // Never cache, never intercept — includes /api/admin/me (a GET): its
    // answer depends on the session cookie at request time, so a cached
    // copy could tell the app it's logged in (or out) when it isn't.
    return;
  }

  if (url.pathname === "/api/products") {
    // Catalogue: serve the cached copy instantly if there is one (so a
    // dropped-wifi showroom can still browse and add items by hand), and
    // always refresh the cache in the background when a connection exists.
    event.respondWith(
      caches.open(CATALOG_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const networkFetch = fetch(request)
          .then((res) => {
            if (res.ok) cache.put(request, res.clone());
            return res;
          })
          .catch(() => null);
        // networkFetch was already started above regardless — returning the
        // cached copy immediately just means we don't wait on it.
        if (cached) return cached;
        const fresh = await networkFetch;
        return fresh || new Response(JSON.stringify({ error: "You're offline and there is no cached catalogue yet." }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        });
      })
    );
    return;
  }

  // App shell — network-first so a live connection always gets the latest
  // build; falls back to whatever was last cached only when truly offline.
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request).then((cached) => cached || Response.error()))
  );
});
