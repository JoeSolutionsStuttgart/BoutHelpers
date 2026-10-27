// Service Worker: zeigt Push-Benachrichtigungen an
// App-Name aus config.js lesen (config.js schreibt in window.TP_CONFIG)
self.window = self;
try { importScripts('config.js'); } catch (e) { /* ohne config.js */ }
const APP_NAME = (self.TP_CONFIG && self.TP_CONFIG.appName) || 'Teamplaner';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: APP_NAME, body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || APP_NAME, {
    body: d.body || '',
    icon: 'img/icon-192.png',
    badge: 'img/badge-96.png',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    data: { url: d.url || './' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if (c.url.startsWith(self.registration.scope) && 'focus' in c) {
        c.navigate(url).catch(() => {});
        return c.focus();
      }
    }
    return self.clients.openWindow(url);
  }));
});
