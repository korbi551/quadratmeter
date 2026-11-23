// Service Worker für Quadratmeter: macht die App installierbar und zeigt offline eine Hinweisseite.
// Seiten mit deinen Daten werden bewusst NICHT gespeichert – sie kommen immer frisch vom Server.
const VERSION = '__VERSION__';
const CACHE = `quadratmeter-${VERSION}`;
const ASSETS = [
  '/offline.html',
  `/static/style.css?v=${VERSION}`,
  `/static/app.js?v=${VERSION}`,
  '/static/shared/calc.js',
  '/static/shared/fields.js',
  '/static/shared/display.js',
  '/static/favicon.svg',
  '/static/icons/icon-192.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('quadratmeter-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Seitenaufrufe: immer vom Server, offline die Hinweisseite
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/offline.html')));
    return;
  }

  // Dateien der App (CSS, Skripte, Icons): sofort aus dem Speicher, im Hintergrund aktualisieren
  if (url.pathname.startsWith('/static/')) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        const network = fetch(req)
          .then((res) => {
            if (res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
  }
});
