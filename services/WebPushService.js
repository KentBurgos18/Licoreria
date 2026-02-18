let webpush = null;
try {
  webpush = require('web-push');
  const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
  const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
  if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && typeof webpush.setVapidDetails === 'function') {
    webpush.setVapidDetails(
      'mailto:support@licoreria.local',
      VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY
    );
  }
} catch (e) {
  console.warn('WebPushService: web-push no disponible', e.message);
}

const { PushSubscription } = require('../models');

/**
 * Envía notificación Web Push a todos los dispositivos suscritos de los usuarios indicados.
 * @param {number[]} userIds - IDs de usuarios (staff) a notificar
 * @param {string} title - Título de la notificación
 * @param {string} body - Cuerpo del mensaje
 * @param {object} [data] - Datos extra (ej. { saleId }) para el payload
 */
async function sendToUsers(userIds, title, body, data = {}) {
  if (!userIds || userIds.length === 0) return;
  if (!webpush || !process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    return;
  }

  let subscriptions;
  try {
    subscriptions = await PushSubscription.findAll({
      where: { userId: userIds },
      attributes: ['id', 'endpoint', 'p256dh', 'auth']
    });
  } catch (e) {
    console.error('Web Push: error al buscar suscripciones:', e.message);
    return;
  }

  const payload = JSON.stringify({
    title: title || 'Notificación',
    body: body || '',
    ...data
  });

  const sendPromises = subscriptions.map(async (sub) => {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth }
        },
        payload,
        { TTL: 3600 }
      );
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        await sub.destroy().catch(() => {});
      }
      console.warn('Web Push: fallo envío a suscripción', sub.id, err.message);
    }
  });

  await Promise.allSettled(sendPromises);
}

module.exports = { sendToUsers };
