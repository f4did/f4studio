/* F4 Studio service worker: offline app shell + runtime cache. Bump VERSION to invalidate. */
const VERSION = 'f4-v2';
const SHELL = ['/', '/index.html', '/favicon.ico', '/manifest.webmanifest', '/icons/f4-mark.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png', '/f4-studio-home-enhanced.html', '/F4-Audio-Studio-Modern-F4-Home-Design.html'];
const FFMPEG_CDN = /^https:\/\/cdn\.jsdelivr\.net\/npm\/@ffmpeg\//;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()).catch(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !FFMPEG_CDN.test(req.url)) return;
  if (req.headers.has('range')) return; // never interfere with media range requests

  // Navigations: network first, fall back to the cached shell so the app opens offline.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(VERSION).then((c) => c.put('/index.html', copy)); return res; }).catch(() => caches.match('/index.html').then((r) => r || caches.match('/'))));
    return;
  }
  // Everything else: stale-while-revalidate (hashed build assets never change, the FFmpeg core is large).
  event.respondWith(caches.open(VERSION).then(async (cache) => {
    const hit = await cache.match(req);
    const net = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  }));
});
