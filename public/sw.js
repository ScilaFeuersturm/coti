// Service worker de Coti: guarda la "cáscara" de la app para que abra sin señal.
// Nunca guarda respuestas de /api (son datos privados del taller).
const CACHE = "coti-shell-v4";
const SHELL = [
  "/",
  "/styles.css",
  "/app.js",
  "/manifest.json",
  "/assets/coti-badge.jpg",
  "/assets/coti-mascot.jpg",
  "/icons/icon-192.png",
  "/icons/apple-touch-icon.png",
  "/icons/favicon-32.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // Red primero (siempre la versión más nueva); si no hay señal, la copia guardada.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && SHELL.includes(url.pathname)) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match("/")))
  );
});
