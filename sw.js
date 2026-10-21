// Campi · Service Worker: macht die App installierbar und offline nutzbar.
// Seiten kommen zuerst aus dem Netz (damit Änderungen sofort ankommen), sonst aus dem Speicher.
// Supabase, Kartenbilder und andere fremde Adressen werden nicht angefasst.
const CACHE = 'campi-v2026-10-i';
const CORE = ['./', './index.html', './config.js', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if(req.method !== 'GET' || url.origin !== self.location.origin) return;
  if(url.pathname.endsWith('/admin.html')) return;
  e.respondWith(fetch(req).then(res => {
    if(res && res.ok){ const copy = res.clone(); caches.open(CACHE).then(c => c.put(req.mode === 'navigate' ? './index.html' : req, copy)); }
    return res;
  }).catch(() => caches.match(req.mode === 'navigate' ? './index.html' : req).then(r => r || caches.match('./index.html'))));
});
