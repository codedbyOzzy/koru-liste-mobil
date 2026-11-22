const CACHE_NAME = "koru-liste-pwa-v3";
const SHARED_CACHE = "koru-shared-pdf";
const SHARED_KEY = "./__shared_pdf__";

const PRECACHE_ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.json",
  "./core/converter.js",
  "./vendor/pdf.min.js",
  "./vendor/pdf.worker.min.js",
  "./vendor/pdf-lib.min.js",
  "./vendor/fontkit.umd.min.js",
  "./fonts/Roboto-Regular.ttf",
  "./fonts/Roboto-Bold.ttf",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && k !== SHARED_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Android Web Share Target (WhatsApp -> Paylaş -> Koru Liste)
  if (req.method === "POST" && url.pathname.endsWith("/share-target")) {
    event.respondWith(
      (async () => {
        try {
          const formData = await req.formData();
          const file = formData.get("pdf");
          if (file) {
            const ab = await file.arrayBuffer();
            const sc = await caches.open(SHARED_CACHE);
            const headers = new Headers({
              "Content-Type": "application/pdf",
              "X-Filename": encodeURIComponent(file.name || "Paylasilan_Liste.pdf")
            });
            await sc.put(new URL(SHARED_KEY, self.registration.scope).href, new Response(ab, { headers }));
            return Response.redirect("./?shared=1", 303);
          }
        } catch (err) {
          console.error("Share target hatası:", err);
        }
        return Response.redirect("./?share_err=1", 303);
      })()
    );
    return;
  }

  if (req.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  const isHeavyStatic = /\/(vendor|fonts|icons)\//.test(url.pathname);
  if (isHeavyStatic) {
    event.respondWith(
      caches.match(req, { ignoreSearch: true }).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((networkResp) => {
          if (networkResp && networkResp.ok) {
            const clone = networkResp.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, clone));
          }
          return networkResp;
        });
      })
    );
    return;
  }

  // Network-first with offline cache fallback for HTML & app scripts
  event.respondWith(
    fetch(req)
      .then((networkResp) => {
        if (networkResp && networkResp.ok) {
          const clone = networkResp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, clone));
        }
        return networkResp;
      })
      .catch(() =>
        caches.match(req, { ignoreSearch: true }).then((cached) => {
          if (cached) return cached;
          if (req.mode === "navigate") return caches.match("./index.html");
          return undefined;
        })
      )
  );
});
