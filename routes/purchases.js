const express = require('express');
const { Product, InventoryMovement, PurchaseOrder, PurchaseOrderItem, Supplier, Setting } = require('../models');
const { sequelize } = require('../models');
const { Op } = require('sequelize');
const { resolveMovement } = require('../services/InventoryPoolHelper');
const EmailService = require('../services/EmailService');

const router = express.Router();

// Helper: add days to a date string or Date
function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

// Helper: mark overdue purchase orders
async function markOverdueOrders(tenantId, transaction = null) {
  const today = new Date().toISOString().split('T')[0];
  await PurchaseOrder.update(
    { status: 'OVERDUE' },
    {
      where: {
        tenantId,
        status: { [Op.in]: ['PENDING', 'PARTIAL'] },
        dueDate: { [Op.lt]: today }
      },
      transaction
    }
  );
}

// POST /purchases - Create a purchase (creates PurchaseOrder + inventory movements)
router.post('/', async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const {
      tenantId,
      supplierId,
      invoiceNumber,
      purchaseDate,
      creditDays: creditDaysParam,
      items,
      notes
    } = req.body;

    if (!tenantId || !items || !Array.isArray(items) || items.length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        error: 'Tenant ID and items array are required',
        code: 'INVALID_REQUEST'
      });
    }

    for (const item of items) {
      if (!item.productId || !item.quantity || item.quantity <= 0) {
        await transaction.rollback();
        return res.status(400).json({
          error: 'Each item must have productId and quantity > 0',
          code: 'INVALID_ITEM'
        });
      }
    }

    // Load supplier and inherit creditDays if not specified
    let supplier = null;
    let creditDays = parseInt(creditDaysParam) || 0;

    if (supplierId) {
      supplier = await Supplier.findOne({ where: { id: supplierId, tenantId }, transaction });
      if (!supplier) {
        await transaction.rollback();
        return res.status(404).json({ error: 'Supplier not found', code: 'SUPPLIER_NOT_FOUND' });
      }
      if (creditDaysParam === undefined || creditDaysParam === null || creditDaysParam === '') {
        creditDays = supplier.creditDays || 0;
      }
    }

    // Validate and fetch products (SIMPLE only)
    const productIds = items.map(item => item.productId);
    const products = await Product.findAll({
      where: {
        id: { [Op.in]: productIds },
        tenantId,
        productType: 'SIMPLE',
        isActive: true
      },
      transaction
    });

    if (products.length !== productIds.length) {
      await transaction.rollback();
      return res.status(400).json({
        error: 'One or more products not found, inactive, or not SIMPLE type',
        code: 'PRODUCT_NOT_FOUND'
      });
    }

    // Calculate total amount
    const totalAmount = items.reduce((sum, item) => {
      return sum + (parseFloat(item.quantity) * parseFloat(item.unitCost || 0));
    }, 0);

    // Calculate due date
    const effectivePurchaseDate = purchaseDate || new Date().toISOString().split('T')[0];
    const dueDate = creditDays > 0 ? addDays(effectivePurchaseDate, creditDays) : null;
    const status = creditDays > 0 ? 'PENDING' : 'PAID';
    const paidAt = creditDays === 0 ? new Date() : null;

    // Create PurchaseOrder
    const purchaseOrder = await PurchaseOrder.create({
      tenantId,
      supplierId: supplierId || null,
      invoiceNumber: invoiceNumber || null,
      purchaseDate: effectivePurchaseDate,
      totalAmount,
      creditDays,
      dueDate,
      amountPaid: creditDays === 0 ? totalAmount : 0,
      status,
      notes: notes || null,
      paidAt
    }, { transaction });

    // Create inventory movements + purchase order items
    const productMap = products.reduce((m, p) => { m[p.id] = p; return m; }, {});
    let movementsCount = 0;

    for (const item of items) {
      const product = productMap[item.productId];
      const { productId: mvProductId, qty: mvQty } = resolveMovement(product, item.quantity);
      await InventoryMovement.create({
        tenantId,
        productId: mvProductId,
        movementType: 'IN',
        reason: 'PURCHASE',
        qty: mvQty,
        unitCost: item.unitCost || null,
        refType: 'PURCHASE',
        refId: purchaseOrder.id,
        purchaseOrderId: purchaseOrder.id,
        createdAt: purchaseDate ? new Date(purchaseDate) : new Date()
      }, { transaction });

      // Guardar ítem con la cantidad original ingresada por el usuario
      await PurchaseOrderItem.create({
        purchaseOrderId: purchaseOrder.id,
        productId: item.productId,
        quantity: item.quantity,
        unitCost: item.unitCost || 0
      }, { transaction });

      movementsCount++;
    }

    await transaction.commit();

    // Reload with supplier
    const fullOrder = await PurchaseOrder.findByPk(purchaseOrder.id, {
      include: [{ association: 'supplier' }]
    });

    res.status(201).json({
      message: 'Purchase created successfully',
      purchaseOrder: fullOrder,
      movementsCount
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Error creating purchase:', error);
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
  }
});

// GET /purchases - List purchase orders
router.get('/', async (req, res) => {
  try {
    const {
      tenantId,
      supplierId,
      status,
      startDate,
      endDate,
      page = 1,
      limit = 50
    } = req.query;

    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant ID is required', code: 'TENANT_REQUIRED' });
    }

    // Update overdue status before listing
    await markOverdueOrders(tenantId);

    const whereClause = { tenantId };
    if (supplierId) whereClause.supplierId = supplierId;
    if (status) whereClause.status = status;

    if (startDate || endDate) {
      whereClause.purchaseDate = {};
      if (startDate) whereClause.purchaseDate[Op.gte] = startDate;
      if (endDate) whereClause.purchaseDate[Op.lte] = endDate;
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const { count, rows } = await PurchaseOrder.findAndCountAll({
      where: whereClause,
      include: [
        { association: 'supplier' },
        {
          association: 'items',
          include: [{ association: 'product', attributes: ['id', 'name'] }]
        },
        {
          association: 'movements',
          where: { reason: 'PURCHASE' },
          required: false,
          include: [{ association: 'product', attributes: ['id', 'name'] }]
        }
      ],
      limit: parseInt(limit),
      offset,
      order: [['purchaseDate', 'DESC'], ['createdAt', 'DESC']]
    });

    res.json({
      purchaseOrders: rows,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    console.error('Error listing purchases:', error);
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
  }
});

// GET /purchases/pending-payments - List pending/partial/overdue purchase orders
router.get('/pending-payments', async (req, res) => {
  try {
    const { tenantId, supplierId } = req.query;

    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant ID is required', code: 'TENANT_REQUIRED' });
    }

    await markOverdueOrders(tenantId);

    const whereClause = {
      tenantId,
      status: { [Op.in]: ['PENDING', 'PARTIAL', 'OVERDUE'] }
    };
    if (supplierId) whereClause.supplierId = supplierId;

    const orders = await PurchaseOrder.findAll({
      where: whereClause,
      include: [{ association: 'supplier' }],
      order: [['dueDate', 'ASC'], ['createdAt', 'DESC']]
    });

    res.json({ pendingOrders: orders, total: orders.length });
  } catch (error) {
    console.error('Error listing pending payments:', error);
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
  }
});

// PATCH /purchases/:id/pay - Register payment for a purchase order
router.patch('/:id/pay', async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { tenantId, amount, paymentDate, paymentMethod, notes } = req.body;

    if (!tenantId || !amount || parseFloat(amount) <= 0) {
      await transaction.rollback();
      return res.status(400).json({ error: 'tenantId and amount > 0 are required', code: 'INVALID_REQUEST' });
    }

    const order = await PurchaseOrder.findOne({ where: { id, tenantId }, transaction });
    if (!order) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Purchase order not found', code: 'NOT_FOUND' });
    }

    if (order.status === 'PAID') {
      await transaction.rollback();
      return res.status(400).json({ error: 'This purchase order is already paid', code: 'ALREADY_PAID' });
    }

    const paymentAmount = parseFloat(amount);
    const newAmountPaid = parseFloat(order.amountPaid) + paymentAmount;
    const total = parseFloat(order.totalAmount);

    if (newAmountPaid > total + 0.01) {
      await transaction.rollback();
      return res.status(400).json({
        error: `Payment amount exceeds remaining balance (${(total - parseFloat(order.amountPaid)).toFixed(2)})`,
        code: 'EXCEEDS_BALANCE'
      });
    }

    const updates = { amountPaid: newAmountPaid };

    if (newAmountPaid >= total - 0.01) {
      updates.status = 'PAID';
      updates.paidAt = new Date();
      updates.amountPaid = total; // Avoid floating point drift
    } else {
      updates.status = 'PARTIAL';
    }

    await order.update(updates, { transaction });
    await transaction.commit();

    const updated = await PurchaseOrder.findByPk(id, {
      include: [{ association: 'supplier' }]
    });

    res.json({ message: 'Payment registered successfully', purchaseOrder: updated });
  } catch (error) {
    await transaction.rollback();
    console.error('Error registering payment:', error);
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
  }
});

// POST /purchases/check-overdue-notifications - Send email alerts for overdue/due orders
router.post('/check-overdue-notifications', async (req, res) => {
  try {
    const { tenantId } = req.body;

    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId is required', code: 'TENANT_REQUIRED' });
    }

    // Mark overdue first
    await markOverdueOrders(tenantId);

    const today = new Date().toISOString().split('T')[0];
    const threshold24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Find orders that need notification
    const orders = await PurchaseOrder.findAll({
      where: {
        tenantId,
        status: { [Op.in]: ['PENDING', 'PARTIAL', 'OVERDUE'] },
        dueDate: { [Op.lte]: today },
        [Op.or]: [
          { lastNotifiedAt: null },
          { lastNotifiedAt: { [Op.lt]: threshold24h } }
        ]
      },
      include: [{ association: 'supplier' }]
    });

    if (orders.length === 0) {
      return res.json({ notified: 0, message: 'No pending notifications' });
    }

    // Get admin email from settings
    const adminEmail = await Setting.getSetting(tenantId, 'smtp_from_email', null);
    const brandName = await Setting.getSetting(tenantId, 'brand_slogan', 'Licorería');

    if (!adminEmail) {
      return res.json({ notified: 0, message: 'No admin email configured' });
    }

    try {
      await EmailService.initialize(tenantId);
    } catch (emailErr) {
      console.error('Email service not configured:', emailErr.message);
      return res.json({ notified: 0, message: 'Email service not configured' });
    }

    let notified = 0;
    for (const order of orders) {
      try {
        const supplierName = order.supplier ? order.supplier.name : 'Proveedor desconocido';
        const supplierCode = order.supplier?.supplierCode || '-';
        const balance = (parseFloat(order.totalAmount) - parseFloat(order.amountPaid)).toFixed(2);
        const statusLabel = order.status === 'OVERDUE' ? 'VENCIDA' : 'PENDIENTE';
        const subject = `[${brandName}] Pago a proveedor ${statusLabel}: ${supplierName}`;

        const html = `
          <!DOCTYPE html>
          <html>
          <head><meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #1a1a2e; color: white; padding: 16px 20px; border-radius: 8px 8px 0 0; }
            .content { background: #f8f9fa; padding: 24px; border-radius: 0 0 8px 8px; }
            .badge-overdue { background: #dc3545; color: white; padding: 4px 10px; border-radius: 4px; font-weight: bold; }
            .badge-pending { background: #fd7e14; color: white; padding: 4px 10px; border-radius: 4px; font-weight: bold; }
            table { width: 100%; border-collapse: collapse; margin: 16px 0; }
            th, td { padding: 10px; text-align: left; border-bottom: 1px solid #dee2e6; }
            th { background: #e9ecef; }
            .footer { margin-top: 16px; color: #888; font-size: 12px; }
          </style>
          </head>
          <body>
          <div class="container">
            <div class="header">
              <h2 style="margin:0">${brandName} — Recordatorio de Pago</h2>
            </div>
            <div class="content">
              <p>Se le recuerda que tiene una factura de proveedor <span class="${order.status === 'OVERDUE' ? 'badge-overdue' : 'badge-pending'}">${statusLabel}</span>:</p>
              <table>
                <tr><th>Proveedor</th><td>${supplierName} (${supplierCode})</td></tr>
                <tr><th>N° Factura</th><td>${order.invoiceNumber || '—'}</td></tr>
                <tr><th>Fecha Compra</th><td>${order.purchaseDate}</td></tr>
                <tr><th>Fecha Vencimiento</th><td>${order.dueDate}</td></tr>
                <tr><th>Total</th><td>$${parseFloat(order.totalAmount).toFixed(2)}</td></tr>
                <tr><th>Pagado</th><td>$${parseFloat(order.amountPaid).toFixed(2)}</td></tr>
                <tr><th>Saldo Pendiente</th><td><strong>$${balance}</strong></td></tr>
              </table>
              <p>Por favor registre el pago en el sistema lo antes posible.</p>
              <div class="footer">Correo automático — no responder.</div>
            </div>
          </div>
          </body></html>`;

        await EmailService.sendEmail(adminEmail, subject, html);
        await order.update({ lastNotifiedAt: new Date() });
        notified++;
      } catch (err) {
        console.error(`Error sending notification for order ${order.id}:`, err.message);
      }
    }

    res.json({ notified, message: `${notified} notification(s) sent` });
  } catch (error) {
    console.error('Error checking overdue notifications:', error);
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
  }
});

// POST /purchases/:id/send-reminder - Send manual reminder for a specific order
router.post('/:id/send-reminder', async (req, res) => {
  try {
    const { id } = req.params;
    const { tenantId } = req.body;

    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId is required', code: 'TENANT_REQUIRED' });
    }

    const order = await PurchaseOrder.findOne({
      where: { id, tenantId },
      include: [{ association: 'supplier' }]
    });

    if (!order) {
      return res.status(404).json({ error: 'Purchase order not found', code: 'NOT_FOUND' });
    }

    const adminEmail = await Setting.getSetting(tenantId, 'smtp_from_email', null);
    const brandName = await Setting.getSetting(tenantId, 'brand_slogan', 'Licorería');

    if (!adminEmail) {
      return res.status(400).json({ error: 'No admin email configured', code: 'NO_EMAIL' });
    }

    try {
      await EmailService.initialize(tenantId);
    } catch (emailErr) {
      return res.status(400).json({ error: 'Email service not configured', code: 'EMAIL_NOT_CONFIGURED' });
    }

    const supplierName = order.supplier ? order.supplier.name : 'Proveedor desconocido';
    const supplierCode = order.supplier?.supplierCode || '-';
    const balance = (parseFloat(order.totalAmount) - parseFloat(order.amountPaid)).toFixed(2);
    const subject = `[${brandName}] Recordatorio de pago: ${supplierName}`;

    const html = `
      <!DOCTYPE html><html><head><meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #1a1a2e; color: white; padding: 16px 20px; border-radius: 8px 8px 0 0; }
        .content { background: #f8f9fa; padding: 24px; border-radius: 0 0 8px 8px; }
        table { width: 100%; border-collapse: collapse; margin: 16px 0; }
        th, td { padding: 10px; text-align: left; border-bottom: 1px solid #dee2e6; }
        th { background: #e9ecef; }
      </style></head>
      <body><div class="container">
        <div class="header"><h2 style="margin:0">${brandName} — Recordatorio de Pago a Proveedor</h2></div>
        <div class="content">
          <p>Este es un recordatorio del siguiente pago pendiente a proveedor:</p>
          <table>
            <tr><th>Proveedor</th><td>${supplierName} (${supplierCode})</td></tr>
            <tr><th>N° Factura</th><td>${order.invoiceNumber || '—'}</td></tr>
            <tr><th>Fecha Vencimiento</th><td>${order.dueDate || 'Sin vencimiento'}</td></tr>
            <tr><th>Total</th><td>$${parseFloat(order.totalAmount).toFixed(2)}</td></tr>
            <tr><th>Saldo Pendiente</th><td><strong>$${balance}</strong></td></tr>
          </table>
        </div>
      </div></body></html>`;

    await EmailService.sendEmail(adminEmail, subject, html);
    await order.update({ lastNotifiedAt: new Date() });

    res.json({ message: 'Reminder sent successfully' });
  } catch (error) {
    console.error('Error sending reminder:', error);
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
  }
});

module.exports = router;
