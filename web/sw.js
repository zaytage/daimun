/* Istiqamah service worker: works offline and handles taps on reminder notifications. */
const CACHE = 'istiqamah-v1';
const ASSETS = ['./', 'index.html', 'styles.css', 'app.js', 'prayertimes.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/favicon.png', 'sounds/chime.wav', 'sounds/soft.wav'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

// Network first so updates arrive straight away; the cache keeps it working offline.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req.mode === 'navigate' ? req.url : req, { cache: 'no-cache' }).then((res) => {
      if (res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
  );
});

self.addEventListener('notificationclick', (e) => {
  const n = e.notification;
  const action = e.action || 'open';
  const event = n.data && n.data.event;
  n.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = all[0];
    if (client) {
      client.postMessage({ type: 'notification-action', action, event });
      if (action === 'open') { try { await client.focus(); } catch (err) { /* ignore */ } }
    } else if (action === 'open') {
      await self.clients.openWindow('./');
    }
  })());
});
