const express = require('express');
const { CustomerCredit, GroupPurchaseParticipant, Customer, Setting } = require('../models');
const CreditService = require('../services/CreditService');
const EmailService = require('../services/EmailService');
const { Op } = require('sequelize');
const { requireRole } = require('./adminAuth');

const router = express.Router();

// Todas las rutas de créditos requieren rol ADMIN
router.use(requireRole('ADMIN'));

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

// GET /customer-credits/:id - Get credit by ID
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
  const balance = parseFloat(credit.currentBalance || 0);
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

module.exports = router;
module.exports.buildCreditReminderHtml = buildCreditReminderHtml;
