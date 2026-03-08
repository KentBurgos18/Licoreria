/* Service Worker para Web Push + cache de íconos PWA */
'use strict';

const SW_CACHE = 'locobar-icons-v1';
const PRECACHE_URLS = [
  '/public/img/icon-192.png',
  '/public/img/icon-512.png',
  '/public/manifest.webmanifest'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(SW_CACHE).then(function(cache) {
      // allSettled: si un recurso falla no aborta el install del SW
      return Promise.allSettled(
        PRECACHE_URLS.map(function(url) { return cache.add(url); })
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== SW_CACHE; })
            .map(function(k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(event) {
  var url = event.request.url;
  if (url.includes('/public/img/icon-') || url.includes('/public/manifest')) {
    event.respondWith(
      caches.match(event.request).then(function(cached) {
        if (cached) return cached;
        return fetch(event.request).then(function(res) {
          var clone = res.clone();
          caches.open(SW_CACHE).then(function(cache) { cache.put(event.request, clone); });
          return res;
        });
      })
    );
  }
});

self.addEventListener('push', function (event) {
  let payload = { title: 'Notificación', body: '' };
  if (event.data) {
    try {
      payload = event.data.json();
    } catch (e) {
      payload.body = event.data.text();
    }
  }
  // Notificaciones solo para staff: no mostrar si no hay dashboard/pos abierto
  if (payload.staffOnly) {
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
        const hasStaffClient = clientList.some(function (c) {
          var u = c.url || '';
          return u.indexOf('/dashboard') !== -1 || u.indexOf('/pos') !== -1;
        });
        if (!hasStaffClient) return; // No mostrar: cliente no tiene abierto dashboard/pos
        const title = payload.title || 'Licorería';
        const options = {
          body: payload.body || '',
          tag: payload.tag || 'notification',
          data: { url: payload.url || '/dashboard', saleId: payload.saleId }
        };
        return self.registration.showNotification(title, options);
      })
    );
    return;
  }
  const title = payload.title || 'Licorería';
  const options = {
    body: payload.body || '',
    tag: payload.tag || 'notification',
    data: { url: payload.url || '/dashboard', saleId: payload.saleId }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  let url = event.notification.data && event.notification.data.url ? event.notification.data.url : '/dashboard';
  if (event.notification.data && event.notification.data.saleId) {
    url = '/dashboard/sales';
  }
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if (client.url.indexOf(self.location.origin) === 0 && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(self.location.origin + (url.startsWith('/') ? url : '/' + url));
      }
    })
  );
});
