/* Service Worker para Web Push - notificaciones en tiempo real */
'use strict';

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
