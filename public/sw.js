/* Service Worker para Web Push + cache de assets PWA */
'use strict';

const SW_VERSION   = 'v4';
const CACHE_STATIC = 'locobar-static-' + SW_VERSION;
const CACHE_ICONS  = 'locobar-icons-'  + SW_VERSION;

const PRECACHE_STATIC = [
  '/libs/css/bootstrap.min.css',
  '/libs/css/bootstrap-icons.css',
  '/libs/js/bootstrap.bundle.min.js',
  '/libs/js/jquery.min.js',
  '/public/css/dashboard-themes.css',
  '/public/css/customer-themes.css',
  '/public/css/theme.css'
];

const PRECACHE_ICONS = [
  '/public/img/icon-192.png',
  '/public/img/icon-512.png',
  '/public/manifest-admin.webmanifest',
  '/public/manifest.webmanifest'
];

// ── Install ───────────────────────────────────────────────────────────────────
self.addEventListener('install', function(event) {
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_STATIC).then(function(cache) {
        return Promise.allSettled(PRECACHE_STATIC.map(function(url) { return cache.add(url); }));
      }),
      caches.open(CACHE_ICONS).then(function(cache) {
        return Promise.allSettled(PRECACHE_ICONS.map(function(url) { return cache.add(url); }));
      })
    ])
  );
  self.skipWaiting();
});

// ── Activate ──────────────────────────────────────────────────────────────────
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_STATIC && k !== CACHE_ICONS; })
            .map(function(k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', function(event) {
  var url = event.request.url;
  if (event.request.method !== 'GET') return;

  // Íconos y manifest → cache-first
  if (url.includes('/public/img/icon-') || url.includes('/manifest')) {
    event.respondWith(cacheFirst(event.request, CACHE_ICONS));
    return;
  }

  // CSS y JS estático → stale-while-revalidate
  if (url.includes('/libs/css/') || url.includes('/libs/js/') ||
      url.includes('/public/css/')) {
    event.respondWith(staleWhileRevalidate(event.request, CACHE_STATIC));
    return;
  }
});

// ── Estrategias ───────────────────────────────────────────────────────────────
function cacheFirst(request, cacheName) {
  return caches.open(cacheName).then(function(cache) {
    return cache.match(request).then(function(cached) {
      if (cached) return cached;
      return fetch(request).then(function(res) {
        if (res.ok) cache.put(request, res.clone());
        return res;
      });
    });
  });
}

function staleWhileRevalidate(request, cacheName) {
  return caches.open(cacheName).then(function(cache) {
    return cache.match(request).then(function(cached) {
      var networkFetch = fetch(request).then(function(res) {
        if (res.ok) cache.put(request, res.clone());
        return res;
      }).catch(function() { return cached; });
      return cached || networkFetch;
    });
  });
}

// ── Push ──────────────────────────────────────────────────────────────────────
self.addEventListener('push', function(event) {
  var payload = { title: 'Notificación', body: '' };
  if (event.data) {
    try { payload = event.data.json(); }
    catch(e) { payload.body = event.data.text(); }
  }
  if (payload.staffOnly) {
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
        var hasStaff = clientList.some(function(c) {
          return (c.url||'').indexOf('/dashboard') !== -1 || (c.url||'').indexOf('/pos') !== -1;
        });
        if (!hasStaff) return;
        return self.registration.showNotification(payload.title || 'Licorería', {
          body: payload.body || '', tag: payload.tag || 'notification',
          data: { url: payload.url || '/dashboard', saleId: payload.saleId }
        });
      })
    );
    return;
  }
  event.waitUntil(self.registration.showNotification(payload.title || 'Licorería', {
    body: payload.body || '', tag: payload.tag || 'notification',
    data: { url: payload.url || '/dashboard', saleId: payload.saleId }
  }));
});

// ── Notification click ────────────────────────────────────────────────────────
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) ? event.notification.data.url : '/dashboard';
  if (event.notification.data && event.notification.data.saleId) url = '/dashboard/sales';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if (client.url.indexOf(self.location.origin) === 0 && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(self.location.origin + (url.startsWith('/') ? url : '/' + url));
    })
  );
});
