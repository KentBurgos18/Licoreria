'use strict';
const { sequelize } = require('../models');
const AuditLogModel = require('../models/AuditLog');
const AuditLog = AuditLogModel(sequelize);

/**
 * Registra una acción en el log de auditoría.
 * Nunca lanza error para no interrumpir la operación principal.
 */
async function log({ tenantId, userId, userName, userEmail, action, entity, entityId, description, metadata, ip }) {
  try {
    await AuditLog.create({
      tenantId:    tenantId || 1,
      userId:      userId   || null,
      userName:    userName || null,
      userEmail:   userEmail || null,
      action,
      entity,
      entityId:    entityId != null ? String(entityId) : null,
      description,
      metadata:    metadata || null,
      ipAddress:   ip || null
    });
  } catch (e) {
    console.warn('[AuditService] Error al guardar log:', e.message);
  }
}

/**
 * Extrae los campos de auditoría comunes del objeto req.
 * Combinar con spread: { ...fromReq(req), action, entity, ... }
 */
function fromReq(req) {
  return {
    tenantId:  req.tenantId  || 1,
    userId:    req.userId    || null,
    userName:  req.userName  || null,
    userEmail: req.userEmail || null,
    ip:        req.ip        || null
  };
}

/**
 * Compara dos objetos y retorna { before, after } con solo los campos que cambiaron.
 * Si no cambió nada, retorna null.
 */
function diffObjects(before, after) {
  const changedKeys = Object.keys(after).filter(k => {
    const a = before[k], b = after[k];
    return JSON.stringify(a) !== JSON.stringify(b);
  });
  if (!changedKeys.length) return null;
  return {
    before: Object.fromEntries(changedKeys.map(k => [k, before[k]])),
    after:  Object.fromEntries(changedKeys.map(k => [k, after[k]]))
  };
}

module.exports = { log, fromReq, diffObjects };
