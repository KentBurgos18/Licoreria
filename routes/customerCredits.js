const express = require('express');
const { CustomerCredit, GroupPurchaseParticipant, Customer, Setting, Sale, CreditPaymentRequest, CustomerPayment } = require('../models');
const { sequelize } = require('../models');
const CreditService = require('../services/CreditService');
const EmailService = require('../services/EmailService');
const { Op } = require('sequelize');
const { requireRole, checkPermission } = require('./adminAuth');

const router = express.Router();

// Floor a 2 decimales para display de saldos con precisión interna de 4 decimales
const floorBal = (x) => Math.floor(parseFloat(x || 0) * 100) / 100;

// Todas las rutas de créditos requieren permiso 'full' en sección 'credits'
router.use(checkPermission('credits', 'full'));

// GET /customer-credits - List credits (all or for a specific customer)
router.get('/', async (req, res) => {
  try {
    const {
      tenantId,
      customerId,
      status,
      includeOverdue,
      page = 1,
      limit = 50
    } = req.query;

    if (!tenantId) {
      return res.status(400).json({
        error: 'tenantId is required',
        code: 'TENANT_REQUIRED'
      });
    }

    const whereClause = { tenantId };

    // customerId is optional - if not provided, returns all credits (admin view)
    if (customerId) {
      whereClause.customerId = customerId;
    }

    if (status) {
      whereClause.status = status;
    } else if (includeOverdue === 'true') {
      // Include overdue credits
      whereClause[Op.or] = [
        { status: 'ACTIVE' },
        { status: 'ACTIVE', dueDate: { [Op.lt]: new Date() } }
      ];
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const { count, rows } = await CustomerCredit.findAndCountAll({
      where: whereClause,
      include: [
        { association: 'customer' },
        {
          association: 'groupPurchaseParticipant',
          include: [
            { association: 'groupPurchase', include: [{ association: 'product' }] }
          ]
        }
      ],
      limit: parseInt(limit),
      offset,
      order: [['dueDate', 'ASC'], ['createdAt', 'DESC']]
    });

    res.json({
      credits: rows,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    console.error('Error listing credits:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// ── SOLICITUDES DE PAGO (deben ir ANTES de /:id para no ser capturadas) ──────

// GET /customer-credits/payment-requests — listar solicitudes
router.get('/payment-requests', async (req, res) => {
  try {
    const tenantId = 1;
    const { status } = req.query;
    const where = { tenantId };
    if (status) where.status = status;

    const requests = await CreditPaymentRequest.findAll({
      where,
      include: [
        { association: 'customer', attributes: ['id', 'name', 'email'] },
        { association: 'credit', attributes: ['id', 'initialAmount', 'currentBalance', 'dueDate'] }
      ],
      order: [['createdAt', 'DESC']]
    });

    res.json({ requests });
  } catch (error) {
    console.error('Error fetching credit payment requests:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /customer-credits/payment-requests/:id/approve — aprobar y aplicar pago
router.post('/payment-requests/:id/approve', async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { reviewNotes } = req.body;

    const request = await CreditPaymentRequest.findByPk(id, { transaction });
    if (!request) { await transaction.rollback(); return res.status(404).json({ error: 'Solicitud no encontrada' }); }
    if (request.status !== 'PENDING') { await transaction.rollback(); return res.status(400).json({ error: 'Esta solicitud ya fue procesada' }); }

    const credit = await CustomerCredit.findByPk(request.creditId, { transaction });
    if (!credit || credit.status !== 'ACTIVE') {
      await transaction.rollback();
      return res.status(400).json({ error: 'El crédito ya no está activo' });
    }

    await CreditService.applyPayment(credit.id, parseFloat(request.amount), transaction);

    await CustomerPayment.create({
      tenantId: request.tenantId,
      customerId: request.customerId,
      groupPurchaseParticipantId: credit.groupPurchaseParticipantId || null,
      creditId: credit.id,
      amount: parseFloat(request.amount),
      paymentMethod: request.paymentMethod,
      paymentDate: new Date().toISOString().split('T')[0],
      notes: request.notes || null
    }, { transaction });

    await request.update({ status: 'APPROVED', reviewedAt: new Date(), reviewNotes: reviewNotes || null }, { transaction });

    await transaction.commit();
    res.json({ ok: true });
  } catch (error) {
    await transaction.rollback();
    console.error('Error approving credit payment request:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// POST /customer-credits/payment-requests/:id/reject — rechazar solicitud
router.post('/payment-requests/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;
    const { reviewNotes } = req.body;

    const request = await CreditPaymentRequest.findByPk(id);
    if (!request) return res.status(404).json({ error: 'Solicitud no encontrada' });
    if (request.status !== 'PENDING') return res.status(400).json({ error: 'Esta solicitud ya fue procesada' });

    await request.update({ status: 'REJECTED', reviewedAt: new Date(), reviewNotes: reviewNotes || null });
    res.json({ ok: true });
  } catch (error) {
    console.error('Error rejecting credit payment request:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /customer-credits/:id/payment — registrar pago de crédito individual (admin)
router.post('/:id/payment', async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { amount, paymentMethod, paymentDate, notes, transferAccountInfo } = req.body;
    const tenantId = 1;

    if (!amount || amount <= 0 || !paymentMethod) {
      await transaction.rollback();
      return res.status(400).json({ error: 'amount y paymentMethod son requeridos', code: 'MISSING_FIELDS' });
    }

    if (paymentMethod === 'TRANSFER' && !transferAccountInfo) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Selecciona la cuenta bancaria para la transferencia', code: 'TRANSFER_ACCOUNT_REQUIRED' });
    }

    const credit = await CustomerCredit.findOne({ where: { id, tenantId }, transaction });
    if (!credit) { await transaction.rollback(); return res.status(404).json({ error: 'Crédito no encontrado' }); }
    if (credit.status !== 'ACTIVE') { await transaction.rollback(); return res.status(400).json({ error: 'El crédito ya está pagado o cancelado' }); }

    const payAmt = parseFloat(amount);
    if (payAmt > parseFloat(credit.currentBalance) + 0.01) {
      await transaction.rollback();
      return res.status(400).json({ error: 'El monto supera el saldo actual del crédito' });
    }

    await CreditService.applyPayment(credit.id, payAmt, transaction);

    await CustomerPayment.create({
      tenantId,
      customerId: credit.customerId,
      groupPurchaseParticipantId: credit.groupPurchaseParticipantId || null,
      creditId: credit.id,
      amount: payAmt,
      paymentMethod,
      paymentDate: paymentDate || new Date().toISOString().split('T')[0],
      notes: notes || null,
      transferAccountInfo: paymentMethod === 'TRANSFER' ? (transferAccountInfo || null) : null
    }, { transaction });

    await transaction.commit();
    res.json({ ok: true });
  } catch (error) {
    await transaction.rollback();
    console.error('Error applying admin credit payment:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// POST /customer-credits/bulk-payment — pagar todos los créditos activos de un cliente de una vez
router.post('/bulk-payment', async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { customerId, creditIds, paymentMethod, paymentDate, notes, transferAccountInfo } = req.body;
    const tenantId = 1;

    if (!customerId || !creditIds || !creditIds.length || !paymentMethod) {
      await transaction.rollback();
      return res.status(400).json({ error: 'customerId, creditIds y paymentMethod son requeridos', code: 'MISSING_FIELDS' });
    }
    if (paymentMethod === 'TRANSFER' && !transferAccountInfo) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Selecciona la cuenta destino para la transferencia', code: 'MISSING_ACCOUNT' });
    }

    // Obtener créditos activos del cliente (solo los del listado recibido, para seguridad)
    const credits = await CustomerCredit.findAll({
      where: { id: creditIds, customerId, tenantId, status: 'ACTIVE' },
      transaction
    });

    if (!credits.length) {
      await transaction.rollback();
      return res.status(404).json({ error: 'No se encontraron créditos activos para este cliente' });
    }

    // Ordenar: vencidos primero, luego por fecha de vencimiento ascendente
    credits.sort((a, b) => {
      const now = new Date();
      const aOverdue = a.dueDate && new Date(a.dueDate + 'T00:00:00') < now;
      const bOverdue = b.dueDate && new Date(b.dueDate + 'T00:00:00') < now;
      if (aOverdue && !bOverdue) return -1;
      if (!aOverdue && bOverdue) return 1;
      if (a.dueDate && b.dueDate) return new Date(a.dueDate) - new Date(b.dueDate);
      return 0;
    });

    let paidCount = 0;
    for (const credit of credits) {
      // Actualizar intereses al día de hoy antes de cobrar (incluye tasa de mora si aplica)
      await CreditService.updateCreditBalance(credit.id, new Date(), transaction);
      const updated = await CustomerCredit.findByPk(credit.id, { transaction });
      const balance = parseFloat(updated.currentBalance);
      if (balance <= 0.01) continue;
      await CustomerPayment.create({
        tenantId,
        customerId,
        groupPurchaseParticipantId: updated.groupPurchaseParticipantId || null,
        creditId: updated.id,
        amount: balance,
        paymentMethod,
        paymentDate: paymentDate || new Date().toISOString().split('T')[0],
        notes: notes || 'Cobro masivo',
        transferAccountInfo: paymentMethod === 'TRANSFER' ? (transferAccountInfo || null) : null
      }, { transaction });
      await CreditService.applyPayment(updated.id, balance, transaction);
      paidCount++;
    }

    await transaction.commit();
    res.json({ ok: true, paidCount });
  } catch (error) {
    await transaction.rollback();
    console.error('Error en bulk-payment:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// GET /customer-credits/:id - Get credit by ID
// GET /customer-credits/:id/payments — pagos realizados sobre un crédito (admin)
router.get('/:id/payments', async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = 1;

    const credit = await CustomerCredit.findOne({ where: { id, tenantId } });
    if (!credit) return res.status(404).json({ error: 'Crédito no encontrado' });

    const where = { tenantId, customerId: credit.customerId };
    if (credit.groupPurchaseParticipantId) {
      where[Op.or] = [
        { creditId: credit.id },
        { groupPurchaseParticipantId: credit.groupPurchaseParticipantId }
      ];
    } else {
      where.creditId = credit.id;
    }

    const payments = await CustomerPayment.findAll({
      where,
      order: [['paymentDate', 'DESC'], ['createdAt', 'DESC']]
    });
    res.json({ payments });
  } catch (error) {
    console.error('Error listing credit payments (admin):', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { tenantId } = req.query;

    if (!tenantId) {
      return res.status(400).json({
        error: 'tenantId is required',
        code: 'TENANT_REQUIRED'
      });
    }

    const credit = await CustomerCredit.findOne({
      where: { id, tenantId },
      include: [
        { association: 'customer', attributes: ['id', 'name', 'email'] },
        {
          association: 'groupPurchaseParticipant',
          include: [
            { 
              association: 'groupPurchase', 
              include: [{ association: 'product', attributes: ['id', 'name'] }] 
            },
            { association: 'payments' }
          ]
        }
      ]
    });

    if (!credit) {
      return res.status(404).json({
        error: 'Credit not found',
        code: 'CREDIT_NOT_FOUND'
      });
    }

    res.json(credit);
  } catch (error) {
    console.error('Error getting credit:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// POST /customer-credits/:id/calculate-interest - Calculate interest for a credit
router.post('/:id/calculate-interest', async (req, res) => {
  try {
    const { id } = req.params;
    const { tenantId, asOfDate } = req.query;

    if (!tenantId) {
      return res.status(400).json({
        error: 'tenantId is required',
        code: 'TENANT_REQUIRED'
      });
    }

    const credit = await CustomerCredit.findOne({
      where: { id, tenantId }
    });

    if (!credit) {
      return res.status(404).json({
        error: 'Credit not found',
        code: 'CREDIT_NOT_FOUND'
      });
    }

    const calculationDate = asOfDate ? new Date(asOfDate) : new Date();
    const updatedCredit = await CreditService.updateCreditBalance(credit.id, calculationDate);

    res.json({
      credit: updatedCredit,
      interestCalculated: CreditService.calculateInterest(credit, calculationDate)
    });
  } catch (error) {
    console.error('Error calculating interest:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// GET /customer-credits/summary/:customerId - Get credit summary for a customer
router.get('/summary/:customerId', async (req, res) => {
  try {
    const { customerId } = req.params;
    const { tenantId, includeInterest = 'true' } = req.query;

    if (!tenantId) {
      return res.status(400).json({
        error: 'tenantId is required',
        code: 'TENANT_REQUIRED'
      });
    }

    const summary = await CreditService.getCustomerCreditSummary(
      tenantId,
      customerId,
      includeInterest === 'true'
    );

    res.json(summary);
  } catch (error) {
    console.error('Error getting credit summary:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// POST /customer-credits/:id/send-reminder — enviar recordatorio manual al cliente
router.post('/:id/send-reminder', async (req, res) => {
  try {
    const { id } = req.params;
    const { tenantId } = req.body;

    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId is required', code: 'TENANT_REQUIRED' });
    }

    const credit = await CustomerCredit.findOne({
      where: { id, tenantId },
      include: [{ association: 'customer', attributes: ['id', 'name', 'email'] }]
    });

    if (!credit) {
      return res.status(404).json({ error: 'Crédito no encontrado', code: 'NOT_FOUND' });
    }

    if (!credit.customer || !credit.customer.email) {
      return res.status(400).json({ error: 'El cliente no tiene email registrado', code: 'NO_EMAIL' });
    }

    try {
      await EmailService.initialize(tenantId);
    } catch (e) {
      return res.status(400).json({ error: 'Servicio de correo no configurado', code: 'EMAIL_NOT_CONFIGURED' });
    }

    const brandName = await Setting.getSetting(tenantId, 'brand_slogan', 'Licorería');
    const html = buildCreditReminderHtml(credit, brandName);
    const subject = `[${brandName}] Recordatorio de saldo pendiente`;

    await EmailService.sendEmail(credit.customer.email, subject, html);
    await credit.update({ lastNotifiedAt: new Date() });

    res.json({ message: 'Recordatorio enviado correctamente' });
  } catch (error) {
    console.error('Error sending credit reminder:', error);
    res.status(500).json({ error: 'Error interno del servidor', code: 'INTERNAL_ERROR' });
  }
});

function buildCreditReminderHtml(credit, brandName) {
  const today = new Date().toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const balance = floorBal(credit.currentBalance);
  const initial = parseFloat(credit.initialAmount || 0);
  const interest = Math.max(0, balance - initial);
  const normalRate = parseFloat(credit.interestRate || 0);
  const overdueRate = parseFloat(credit.overdueInterestRate || 0);

  let dueDateRow = '';
  let overdueAlert = '';
  let statusBadge = '<span style="background:#17a2b8;color:white;padding:3px 10px;border-radius:4px;font-size:12px">ACTIVO</span>';

  if (credit.dueDate) {
    const dueDateDisp = new Date(credit.dueDate + 'T00:00:00').toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const nowMs  = new Date(CreditService.localDateStr() + 'T00:00:00Z').getTime();
    const dueMs  = new Date(credit.dueDate + 'T00:00:00Z').getTime();
    const daysOverdue = Math.floor((nowMs - dueMs) / 86400000);

    dueDateRow = `<tr><th>Fecha de vencimiento</th><td>${dueDateDisp}</td></tr>`;

    if (daysOverdue > 0) {
      statusBadge = `<span style="background:#dc3545;color:white;padding:3px 10px;border-radius:4px;font-size:12px">VENCIDO hace ${daysOverdue} día(s)</span>`;
      overdueAlert = `
        <div style="background:#fff3cd;border-left:4px solid #ffc107;padding:12px 16px;margin:16px 0;border-radius:4px">
          <strong>⚠️ Su crédito está vencido.</strong> A partir del vencimiento se aplica un interés de mora adicional del
          <strong>${(overdueRate * 100).toFixed(2)}% diario</strong>. Le recomendamos regularizar su saldo a la brevedad.
        </div>`;
    } else if (daysOverdue > -4) {
      statusBadge = `<span style="background:#fd7e14;color:white;padding:3px 10px;border-radius:4px;font-size:12px">PRÓXIMO A VENCER</span>`;
    }
  }

  let interestRow = '';
  if (interest > 0) {
    interestRow = `<tr><th>Intereses acumulados</th><td>$${interest.toFixed(2)}</td></tr>`;
  }

  let rateInfo = `${(normalRate * 100).toFixed(2)}% diario`;
  if (overdueRate > 0) {
    rateInfo += ` (mora: +${(overdueRate * 100).toFixed(2)}% diario tras vencimiento)`;
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #1a1a2e; color: white; padding: 16px 20px; border-radius: 8px 8px 0 0; }
    .content { background: #f8f9fa; padding: 24px; border-radius: 0 0 8px 8px; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid #dee2e6; }
    th { background: #e9ecef; width: 45%; }
    .footer { margin-top: 16px; color: #888; font-size: 12px; }
    .total-row td { font-size: 18px; font-weight: bold; color: #dc3545; }
  </style></head>
  <body><div class="container">
    <div class="header"><h2 style="margin:0">${brandName} — Recordatorio de Saldo</h2></div>
    <div class="content">
      <p>Estimado/a <strong>${credit.customer.name}</strong>,</p>
      <p>Le recordamos que tiene un saldo pendiente en su cuenta. A continuación el detalle:</p>
      ${overdueAlert}
      <table>
        <tr><th>Estado</th><td>${statusBadge}</td></tr>
        <tr><th>Monto original</th><td>$${initial.toFixed(2)}</td></tr>
        ${interestRow}
        ${dueDateRow}
        <tr><th>Tasa de interés</th><td>${rateInfo}</td></tr>
        <tr><th>Fecha del reporte</th><td>${today}</td></tr>
        <tr class="total-row"><th>Total a pagar</th><td>$${balance.toFixed(2)}</td></tr>
      </table>
      <p>Para realizar su pago o consultar opciones, comuníquese con nosotros.</p>
      <div class="footer">Correo automático — no responder directamente a este mensaje.</div>
    </div>
  </div></body></html>`;
}

function buildCreditReminderHtmlMulti(customer, credits, brandName) {
  const today = new Date().toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const nowMs = new Date(CreditService.localDateStr() + 'T00:00:00Z').getTime();

  let totalBalance = 0;
  let hasOverdue = false;
  let hasUpcoming = false;

  const rows = credits.map(credit => {
    const balance = floorBal(credit.currentBalance);
    const initial = parseFloat(credit.initialAmount || 0);
    const normalRate = parseFloat(credit.interestRate || 0);
    const overdueRate = parseFloat(credit.overdueInterestRate || 0);
    totalBalance += balance;

    let statusLabel = '<span style="background:#17a2b8;color:white;padding:2px 8px;border-radius:4px;font-size:11px">ACTIVO</span>';
    let dueDateStr = '—';

    if (credit.dueDate) {
      dueDateStr = new Date(credit.dueDate + 'T00:00:00').toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const dueMs = new Date(credit.dueDate + 'T00:00:00Z').getTime();
      const daysOverdue = Math.floor((nowMs - dueMs) / 86400000);
      if (daysOverdue > 0) {
        statusLabel = `<span style="background:#dc3545;color:white;padding:2px 8px;border-radius:4px;font-size:11px">VENCIDO ${daysOverdue}d</span>`;
        hasOverdue = true;
      } else if (daysOverdue > -4) {
        statusLabel = `<span style="background:#fd7e14;color:white;padding:2px 8px;border-radius:4px;font-size:11px">PRÓXIMO</span>`;
        hasUpcoming = true;
      }
    }

    const interest = Math.max(0, balance - initial);
    let rateInfo = `${(normalRate * 100).toFixed(2)}%`;
    if (overdueRate > 0) rateInfo += ` (+${(overdueRate * 100).toFixed(2)}% mora)`;

    return `<tr>
      <td style="padding:8px;border-bottom:1px solid #dee2e6">${statusLabel}</td>
      <td style="padding:8px;border-bottom:1px solid #dee2e6">$${initial.toFixed(2)}</td>
      <td style="padding:8px;border-bottom:1px solid #dee2e6">${interest > 0 ? '$' + interest.toFixed(2) : '—'}</td>
      <td style="padding:8px;border-bottom:1px solid #dee2e6">${dueDateStr}</td>
      <td style="padding:8px;border-bottom:1px solid #dee2e6;font-weight:bold;color:#dc3545">$${balance.toFixed(2)}</td>
    </tr>`;
  }).join('');

  const overdueAlert = hasOverdue ? `
    <div style="background:#fff3cd;border-left:4px solid #ffc107;padding:12px 16px;margin:16px 0;border-radius:4px">
      <strong>⚠️ Tiene uno o más créditos vencidos.</strong> Le recomendamos regularizar su saldo a la brevedad para evitar intereses adicionales.
    </div>` : (hasUpcoming ? `
    <div style="background:#d1ecf1;border-left:4px solid #17a2b8;padding:12px 16px;margin:16px 0;border-radius:4px">
      <strong>📅 Tiene créditos próximos a vencer.</strong> Por favor gestione su pago antes de la fecha de vencimiento.
    </div>` : '');

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; color: #333; }
    .container { max-width: 640px; margin: 0 auto; padding: 20px; }
    .header { background: #1a1a2e; color: white; padding: 16px 20px; border-radius: 8px 8px 0 0; }
    .content { background: #f8f9fa; padding: 24px; border-radius: 0 0 8px 8px; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px; }
    th { background: #e9ecef; padding: 8px; text-align: left; border-bottom: 2px solid #dee2e6; }
    .footer { margin-top: 16px; color: #888; font-size: 12px; }
    .total-row { background:#fff3cd; font-weight:bold; font-size:15px; }
    .total-row td { padding:10px; }
  </style></head>
  <body><div class="container">
    <div class="header"><h2 style="margin:0">${brandName} — Resumen de Saldos Pendientes</h2></div>
    <div class="content">
      <p>Estimado/a <strong>${customer.name}</strong>,</p>
      <p>Le recordamos que tiene los siguientes saldos pendientes:</p>
      ${overdueAlert}
      <table>
        <thead><tr>
          <th>Estado</th><th>Monto original</th><th>Intereses</th><th>Vencimiento</th><th>Total a pagar</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr class="total-row">
          <td colspan="4" style="padding:10px;text-align:right">TOTAL A PAGAR:</td>
          <td style="padding:10px;color:#dc3545">$${totalBalance.toFixed(2)}</td>
        </tr></tfoot>
      </table>
      <p>Para realizar su pago o consultar opciones, comuníquese con nosotros.</p>
      <p style="margin-top:12px">Puede revisar el detalle de sus consumos ingresando a su cuenta <a href="https://locobar.atienda.app" style="color:#1a1a2e;font-weight:bold">aquí</a>.</p>
      <div class="footer">Correo automático — no responder directamente a este mensaje. Fecha del reporte: ${today}</div>
    </div>
  </div></body></html>`;
}

// POST /customer-credits/send-summary/:customerId - Enviar resumen detallado al cliente
router.post('/send-summary/:customerId', async (req, res) => {
  try {
    const { customerId } = req.params;
    const { tenantId } = req.body;

    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId is required', code: 'TENANT_REQUIRED' });
    }

    const credits = await CustomerCredit.findAll({
      where: { customerId, tenantId, status: 'ACTIVE' },
      include: [
        { association: 'customer', attributes: ['id', 'name', 'email'] },
        {
          association: 'groupPurchaseParticipant',
          include: [{
            association: 'groupPurchase',
            include: [{
              association: 'sale',
              include: [{ association: 'items', include: [{ association: 'product', attributes: ['id', 'name'] }] }]
            }]
          }]
        }
      ],
      order: [['dueDate', 'ASC']]
    });

    if (!credits.length) {
      return res.status(400).json({ error: 'No hay créditos activos para este cliente', code: 'NO_CREDITS' });
    }

    const customer = credits[0].customer;
    if (!customer || !customer.email) {
      return res.status(400).json({ error: 'El cliente no tiene email registrado', code: 'NO_EMAIL' });
    }

    try {
      await EmailService.initialize(tenantId);
    } catch (e) {
      return res.status(400).json({ error: 'Servicio de correo no configurado', code: 'EMAIL_NOT_CONFIGURED' });
    }

    // Para créditos individuales (saleId set, sin grupo), cargar items de la venta
    for (const credit of credits) {
      if (credit.saleId && !credit.groupPurchaseParticipantId) {
        const sale = await Sale.findOne({
          where: { id: credit.saleId },
          include: [{ association: 'items', include: [{ association: 'product', attributes: ['id', 'name'] }] }]
        });
        credit._saleData = sale;
      }
    }

    const brandName = await Setting.getSetting(tenantId, 'brand_slogan', 'Licorería');
    const html = buildCustomerDetailedSummaryHtml(customer, credits, brandName);
    const totalDebt = credits.reduce((s, c) => s + floorBal(c.currentBalance), 0);
    const subject = `[${brandName}] Detalle de tus créditos pendientes — $${totalDebt.toFixed(2)}`;

    await EmailService.sendEmail(customer.email, subject, html);
    await CustomerCredit.update(
      { lastNotifiedAt: new Date() },
      { where: { customerId, tenantId, status: 'ACTIVE' } }
    );

    res.json({ message: 'Resumen detallado enviado correctamente' });
  } catch (error) {
    console.error('Error sending customer summary:', error);
    res.status(500).json({ error: 'Error interno del servidor', code: 'INTERNAL_ERROR' });
  }
});

function buildCustomerDetailedSummaryHtml(customer, credits, brandName) {
  const today = new Date().toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const nowMs = new Date(CreditService.localDateStr() + 'T00:00:00Z').getTime();

  let totalBalance = 0;
  let hasOverdue = false;
  let hasUpcoming = false;

  const creditBlocks = credits.map(credit => {
    const balance = floorBal(credit.currentBalance);
    const initial = parseFloat(credit.initialAmount || 0);
    const interest = Math.max(0, balance - initial);
    const normalRate = parseFloat(credit.interestRate || 0);
    const overdueRate = parseFloat(credit.overdueInterestRate || 0);
    totalBalance += balance;

    let statusLabel = '<span style="background:#17a2b8;color:white;padding:2px 8px;border-radius:4px;font-size:11px">ACTIVO</span>';
    let dueDateStr = '—';
    let overdueNote = '';

    if (credit.dueDate) {
      dueDateStr = new Date(credit.dueDate + 'T00:00:00').toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const dueMs = new Date(credit.dueDate + 'T00:00:00Z').getTime();
      const daysOverdue = Math.floor((nowMs - dueMs) / 86400000);
      if (daysOverdue > 0) {
        statusLabel = `<span style="background:#dc3545;color:white;padding:2px 8px;border-radius:4px;font-size:11px">VENCIDO ${daysOverdue}d</span>`;
        hasOverdue = true;
        overdueNote = `<div style="background:#fff3cd;border-left:3px solid #ffc107;padding:8px 12px;margin:8px 0;font-size:13px">⚠️ Vencido hace ${daysOverdue} día(s). Aplica interés de mora: ${(overdueRate * 100).toFixed(2)}% diario.</div>`;
      } else if (daysOverdue > -4) {
        statusLabel = `<span style="background:#fd7e14;color:white;padding:2px 8px;border-radius:4px;font-size:11px">PRÓXIMO A VENCER</span>`;
        hasUpcoming = true;
      }
    }

    const rateInfo = overdueRate > 0
      ? `${(normalRate * 100).toFixed(2)}% diario (+${(overdueRate * 100).toFixed(2)}% mora)`
      : `${(normalRate * 100).toFixed(2)}% diario`;

    function buildItemsTable(items, note) {
      if (!items || !items.length) return '';
      const rows = items.map(it => {
        const name = it.product ? it.product.name : 'Producto';
        const qty = parseFloat(it.quantity);
        const qtyStr = Number.isInteger(qty) ? qty : parseFloat(qty.toFixed(3));
        const price = parseFloat(it.totalPrice || 0);
        return `<tr>
          <td style="padding:5px 8px;border-bottom:1px solid #eee">${name}</td>
          <td style="padding:5px 8px;border-bottom:1px solid #eee;text-align:center">${qtyStr}</td>
          <td style="padding:5px 8px;border-bottom:1px solid #eee;text-align:right">$${price.toFixed(2)}</td>
        </tr>`;
      }).join('');
      return `<div style="margin:10px 0 6px;font-size:13px;color:#555">${note}</div>
        <table style="width:100%;border-collapse:collapse;font-size:13px;background:#fff;border-radius:6px;overflow:hidden">
          <thead><tr style="background:#e9ecef">
            <th style="padding:5px 8px;text-align:left">Producto</th>
            <th style="padding:5px 8px;text-align:center">Cant.</th>
            <th style="padding:5px 8px;text-align:right">Total</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
    }

    let typeLabel = '';
    let itemsHtml = '';

    const saleDate = credit.groupPurchaseParticipant
      ? (credit.groupPurchaseParticipant.groupPurchase && credit.groupPurchaseParticipant.groupPurchase.createdAt
          ? new Date(credit.groupPurchaseParticipant.groupPurchase.createdAt).toLocaleString('es-EC', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
          : '—')
      : (credit._saleData
          ? new Date(credit._saleData.createdAt).toLocaleString('es-EC', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
          : new Date(credit.createdAt).toLocaleString('es-EC', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }));

    if (credit.groupPurchaseParticipant) {
      const gp = credit.groupPurchaseParticipant.groupPurchase;
      const saleItems = gp && gp.sale && gp.sale.items ? gp.sale.items : [];
      typeLabel = '<span style="background:#6610f2;color:white;padding:2px 8px;border-radius:4px;font-size:11px">👥 COMPRA GRUPAL</span>';
      itemsHtml = buildItemsTable(saleItems, `Artículos del grupo (tu parte del total: $${initial.toFixed(2)}):`);
    } else {
      const saleItems = credit._saleData && credit._saleData.items ? credit._saleData.items : [];
      typeLabel = '<span style="background:#0d6efd;color:white;padding:2px 8px;border-radius:4px;font-size:11px">🛍️ VENTA INDIVIDUAL</span>';
      itemsHtml = buildItemsTable(saleItems, 'Artículos consumidos:');
    }

    return `
    <div style="background:#fff;border:1px solid #dee2e6;border-radius:8px;padding:16px;margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:6px">
        <div>${typeLabel} &nbsp; ${statusLabel}</div>
        <div style="font-size:12px;color:#888;text-align:right">
          <div>Compra: <strong>${saleDate}</strong></div>
          <div>Vence: <strong>${dueDateStr}</strong></div>
        </div>
      </div>
      ${overdueNote}
      ${itemsHtml}
      <table style="width:100%;border-collapse:collapse;margin-top:12px;font-size:13px">
        <tr>
          <td style="padding:4px 0;color:#555">Monto original</td>
          <td style="padding:4px 0;text-align:right">$${initial.toFixed(2)}</td>
        </tr>
        ${interest > 0 ? `<tr>
          <td style="padding:4px 0;color:#e67e22">Intereses acumulados (${rateInfo})</td>
          <td style="padding:4px 0;text-align:right;color:#e67e22">+$${interest.toFixed(2)}</td>
        </tr>` : ''}
        <tr style="border-top:2px solid #dee2e6;font-weight:bold;font-size:14px">
          <td style="padding:8px 0">Total a pagar</td>
          <td style="padding:8px 0;text-align:right;color:#dc3545">$${balance.toFixed(2)}</td>
        </tr>
      </table>
    </div>`;
  }).join('');

  const alertBox = hasOverdue
    ? `<div style="background:#fff3cd;border-left:4px solid #ffc107;padding:12px 16px;margin:16px 0;border-radius:4px"><strong>⚠️ Tiene créditos vencidos.</strong> Le recomendamos regularizar su saldo a la brevedad.</div>`
    : hasUpcoming
    ? `<div style="background:#d1ecf1;border-left:4px solid #17a2b8;padding:12px 16px;margin:16px 0;border-radius:4px"><strong>📅 Tiene créditos próximos a vencer.</strong> Por favor gestione su pago antes.</div>`
    : '';

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; color: #333; margin:0; padding:0; }
    .container { max-width: 640px; margin: 0 auto; padding: 20px; }
    .header { background: #1a1a2e; color: white; padding: 16px 20px; border-radius: 8px 8px 0 0; }
    .content { background: #f8f9fa; padding: 24px; border-radius: 0 0 8px 8px; }
    .footer { margin-top: 16px; color: #888; font-size: 12px; }
  </style></head>
  <body><div class="container">
    <div class="header"><h2 style="margin:0">${brandName} — Detalle de Créditos Pendientes</h2></div>
    <div class="content">
      <p>Estimado/a <strong>${customer.name}</strong>,</p>
      <p>A continuación encontrará el detalle completo de sus créditos pendientes:</p>
      ${alertBox}
      ${creditBlocks}
      <div style="background:#1a1a2e;color:white;padding:14px 20px;border-radius:8px;text-align:center;margin-top:8px">
        <div style="font-size:13px;opacity:.8">TOTAL ADEUDADO</div>
        <div style="font-size:2rem;font-weight:bold">$${totalBalance.toFixed(2)}</div>
      </div>
      <p style="margin-top:20px">Puede revisar el detalle de sus consumos ingresando a su cuenta <a href="https://locobar.atienda.app" style="color:#1a1a2e;font-weight:bold">aquí</a>.</p>
      <div class="footer">Correo generado el ${today} — no responder a este mensaje.</div>
    </div>
  </div></body></html>`;
}

module.exports = router;
module.exports.buildCreditReminderHtml = buildCreditReminderHtml;
module.exports.buildCreditReminderHtmlMulti = buildCreditReminderHtmlMulti;
module.exports.buildCustomerDetailedSummaryHtml = buildCustomerDetailedSummaryHtml;
