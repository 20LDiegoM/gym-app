// Service worker: guarda la app para que abra sin conexión en el gym.
// Las llamadas a /api/ siempre van a la red (los datos se cachean en la app).
const CACHE = "hierro-v3";
const SHELL = [
  "./", "index.html", "style.css", "app.js", "vendor/pocketbase.es.mjs",
  "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_/")) return;

  // red primero (para recibir actualizaciones), caché si no hay conexión
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("index.html")))
  );
});

// ---------- notificación de fin de descanso (la manda la Pi) ----------
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data && e.data.text() }; }
  e.waitUntil(
    self.registration.showNotification(d.title || "⏱ Descanso terminado", {
      body: d.body || "¡A darle!",
      tag: d.tag || "rest",
      renotify: true,
      requireInteraction: false,
      vibrate: [300, 120, 300, 120, 300],
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      data: { url: d.url || "/#/activo" },
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/#/activo";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) { c.navigate?.(url).catch?.(() => {}); return c.focus(); }
      }
      return self.clients.openWindow(url);
    })
  );
});
