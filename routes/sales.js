const express = require('express');
const { Sale, SaleItem, Product, InventoryMovement, Setting, CustomerCredit, Customer, Notification, GroupPurchase, GroupPurchaseParticipant } = require('../models');
const ComboService = require('../services/ComboService');
const AuditService = require('../services/AuditService');
const { resolveMovement, validateSimpleSaleQuantity } = require('../services/InventoryPoolHelper');
const { sequelize } = require('../models');
const { Op } = require('sequelize');

const router = express.Router();

// POST /sales - Create sale with combo support
router.post('/', async (req, res) => {
  const transaction = await sequelize.transaction();
  
  try {
    const {
      tenantId,
      customerId,
      items,
      paymentMethod,
      totalAmount,
      transferReference,
      transferAccountInfo,
      notes,
      creditDueDate,
      creditInterestRate,
      customerName
    } = req.body;

    // Validate basic required fields
    if (!tenantId || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: 'Tenant ID and items array are required',
        code: 'INVALID_REQUEST'
      });
    }

    // Validate each item
    for (const item of items) {
      if (!item.productId || !item.quantity || item.quantity <= 0) {
        return res.status(400).json({
          error: 'Each item must have productId and quantity > 0',
          code: 'INVALID_ITEM'
        });
      }
    }

    // Get all products and validate availability
    const productIds = items.map(item => item.productId);
    const products = await Product.findAll({
      where: {
        id: { [require('sequelize').Op.in]: productIds },
        tenantId,
        isActive: true
      }
    });

    if (products.length !== productIds.length) {
      return res.status(400).json({
        error: 'One or more products not found or inactive',
        code: 'PRODUCT_NOT_FOUND'
      });
    }

    // Create product map for easy lookup
    const productMap = products.reduce((map, product) => {
      map[product.id] = product;
      return map;
    }, {});

    // Validate stock availability for all items
    const validationPromises = items.map(async (item) => {
      const product = productMap[item.productId];
      if (product.productType === 'SIMPLE') {
        const v = await validateSimpleSaleQuantity(tenantId, product, item.quantity);
        return {
          productId: item.productId,
          productType: 'SIMPLE',
          ...v
        };
      }
      return await ComboService.validateComboSale(tenantId, item.productId, item.quantity);
    });

    const validations = await Promise.all(validationPromises);
    const failedValidations = validations.filter(v => !v.canSell);

    if (failedValidations.length > 0) {
      await transaction.rollback();
      return res.status(400).json({
        error: 'Insufficient stock for one or more items',
        code: 'INSUFFICIENT_STOCK',
        details: failedValidations
      });
    }

    // Calcular subtotal (el IVA se aplica al subtotal completo para coincidir con el POS)
    let subtotal = 0;
    items.forEach(item => {
      const product = productMap[item.productId];
      const unitPrice = item.unitPrice || product.salePrice;
      const lineTotal = unitPrice * item.quantity;
      subtotal += lineTotal;
    });

    const taxEnabledRaw = await Setting.getSetting(tenantId, 'tax_enabled', 'true');
    const isTaxEnabled = taxEnabledRaw === 'true' || taxEnabledRaw === true;

    let taxRate = 0;
    let taxAmount = 0;

    if (isTaxEnabled) {
      const taxRateRaw = await Setting.getSetting(tenantId, 'tax_rate');
      taxRate = taxRateRaw != null ? parseFloat(taxRateRaw) : NaN;
      if (isNaN(taxRate) || taxRate < 0 || taxRate > 100) {
        await transaction.rollback();
        return res.status(400).json({
          error: 'El IVA no está configurado. Configure el IVA en Configuración.',
          code: 'TAX_RATE_NOT_CONFIGURED'
        });
      }
      taxAmount = subtotal * (taxRate / 100);
    }

    const calculatedTotal = subtotal + taxAmount;

    // Use provided totalAmount or calculated total
    const finalTotal = totalAmount || calculatedTotal;

    // Ventas a crédito quedan PENDING hasta que el crédito se pague; el resto COMPLETED
    const saleStatus = paymentMethod === 'CREDIT' ? 'PENDING' : 'COMPLETED';
    
    // For credit sales, customerId is required
    let finalCustomerId = customerId;
    if (paymentMethod === 'CREDIT') {
      if (!customerId) {
        await transaction.rollback();
        return res.status(400).json({
          error: 'customerId is required for credit sales',
          code: 'MISSING_CUSTOMER_ID'
        });
      }
      
      // Verify customer exists and is active
      const customer = await Customer.findOne({
        where: {
          id: customerId,
          tenantId,
          isActive: true
        },
        transaction
      });
      
      if (!customer) {
        await transaction.rollback();
        return res.status(400).json({
          error: 'Customer not found or inactive',
          code: 'CUSTOMER_NOT_FOUND'
        });
      }
      
      finalCustomerId = customerId;
    } else if (!customerId && customerName) {
      // For other payment methods, try to find or create customer by name (optional)
      const existingCustomer = await Customer.findOne({
        where: {
          tenantId,
          name: customerName.trim(),
          isActive: true
        },
        transaction
      });
      
      if (existingCustomer) {
        finalCustomerId = existingCustomer.id;
      }
      // Don't create new customer for non-credit sales if not found
    }

    // Create the sale with historical tax information
    const sale = await Sale.create({
      tenantId,
      customerId: finalCustomerId,
      status: saleStatus,
      totalAmount: finalTotal,
      taxRate: taxRate,
      taxAmount: taxAmount,
      paymentMethod,
      transferReference: paymentMethod === 'TRANSFER' ? transferReference : null,
      transferAccountInfo: paymentMethod === 'TRANSFER' ? (transferAccountInfo || null) : null,
      notes,
      createdAt: new Date()
    }, { transaction });

    // Create sale items
    const saleItemsPromises = items.map(async (item) => {
      const product = productMap[item.productId];
      const unitPrice = item.unitPrice || product.salePrice;
      const totalPrice = unitPrice * item.quantity;

      // Create sale item
      const saleItem = await SaleItem.create({
        saleId: sale.id,
        tenantId,
        productId: item.productId,
        quantity: item.quantity,
        unitPrice,
        totalPrice,
        productType: product.productType
      }, { transaction });

      return saleItem;
    });

    const saleItems = await Promise.all(saleItemsPromises);

    // Crear movimientos de inventario si la venta es COMPLETED, o si es CREDIT (producto entregado aunque pago pendiente)
    if (saleStatus === 'COMPLETED' || paymentMethod === 'CREDIT') {
      const inventoryMovementsPromises = items.map(async (item) => {
        const product = productMap[item.productId];
        
        if (product.productType === 'SIMPLE') {
          const { productId: mvProductId, qty: mvQty } = resolveMovement(product, item.quantity);
          await InventoryMovement.create({
            tenantId,
            productId: mvProductId,
            movementType: 'OUT',
            reason: 'SALE',
            qty: mvQty,
            unitCost: await InventoryMovement.getUnitCost(
              tenantId,
              mvProductId,
              mvQty,
              transaction
            ),
            refType: 'SALE',
            refId: sale.id
          }, { transaction });
        } else {
          await ComboService.createComboSaleMovements(
            tenantId,
            item.productId,
            item.quantity,
            sale.id,
            transaction
          );
        }
      });

      await Promise.all(inventoryMovementsPromises);
    }

    // Create customer credit if payment method is CREDIT
    if (paymentMethod === 'CREDIT' && finalCustomerId) {
      if (!creditDueDate) {
        await transaction.rollback();
        return res.status(400).json({
          error: 'creditDueDate is required for credit sales',
          code: 'MISSING_CREDIT_DUE_DATE'
        });
      }

      // Validate due date is not in the past
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const dueDate = new Date(creditDueDate);
      if (dueDate < today) {
        await transaction.rollback();
        return res.status(400).json({
          error: 'Credit due date cannot be in the past',
          code: 'INVALID_DUE_DATE'
        });
      }

      // Create customer credit
      const interestRate = creditInterestRate ? parseFloat(creditInterestRate) / 100 : 0.01; // Convert percentage to decimal
      await CustomerCredit.create({
        tenantId,
        customerId: finalCustomerId,
        saleId: sale.id,
        groupPurchaseParticipantId: null,
        initialAmount: finalTotal,
        currentBalance: finalTotal,
        interestRate: interestRate,
        dueDate: creditDueDate,
        status: 'ACTIVE',
        lastInterestCalculationDate: new Date().toISOString().split('T')[0]
      }, { transaction });
    }

    await transaction.commit();

    // Fetch complete sale with associations
    const completeSale = await Sale.findByPk(sale.id, {
      include: [
        {
          association: 'items',
          include: [{ association: 'product' }]
        },
        { association: 'customer', attributes: ['id', 'name'] }
      ]
    });

    const PAYMENT_LABELS = { CASH: 'Efectivo', TRANSFER: 'Transferencia', CARD: 'Tarjeta', CREDIT: 'Crédito' };
    AuditService.log({
      ...AuditService.fromReq(req),
      action: 'CREATE', entity: 'sale', entityId: sale.id,
      description: `Registró venta #${sale.id} — $${finalTotal.toFixed(2)} (${paymentMethod})`,
      metadata: {
        total: finalTotal,
        metodoDePago: PAYMENT_LABELS[paymentMethod] || paymentMethod,
        cantidadDeItems: items.length,
        cliente: completeSale.customer ? completeSale.customer.name : (finalCustomerId ? `ID ${finalCustomerId}` : null)
      }
    });

    res.status(201).json(completeSale);
  } catch (error) {
    await transaction.rollback();
    console.error('Error creating sale:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// GET /sales - List sales
router.get('/', async (req, res) => {
  try {
    const {
      tenantId,
      status,
      customerId,
      paymentMethod,
      transferAccountInfo,
      startDate,
      endDate,
      page = 1,
      limit = 50
    } = req.query;

    const whereClause = {};
    if (tenantId) whereClause.tenantId = tenantId;
    if (status) whereClause.status = status;
    if (customerId) whereClause.customerId = customerId;
    if (paymentMethod) whereClause.paymentMethod = paymentMethod;
    if (transferAccountInfo) whereClause.transferAccountInfo = transferAccountInfo;

    if (startDate || endDate) {
      whereClause.createdAt = {};
      if (startDate) whereClause.createdAt[require('sequelize').Op.gte] = startDate;
      if (endDate) whereClause.createdAt[require('sequelize').Op.lte] = endDate;
    }

    const offset = (page - 1) * limit;

    const { count, rows } = await Sale.findAndCountAll({
      where: whereClause,
      include: [
        { association: 'customer', required: false },
        {
          association: 'items',
          include: [{
            association: 'product'
          }]
        }
      ],
      limit: parseInt(limit),
      offset,
      order: [['createdAt', 'DESC']]
    });

    res.json({
      sales: rows,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    console.error('Error listing sales:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// GET /sales/stats/monthly-chart - Ventas por mes (últimos N meses) para gráfico
router.get('/stats/monthly-chart', async (req, res) => {
  try {
    const { tenantId, months = 12 } = req.query;
    if (!tenantId) return res.status(400).json({ error: 'tenantId is required' });

    const n = Math.min(Math.max(parseInt(months) || 12, 1), 24);
    const rows = await sequelize.query(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', created_at AT TIME ZONE 'America/Guayaquil'), 'YYYY-MM') AS month_key,
        TO_CHAR(DATE_TRUNC('month', created_at AT TIME ZONE 'America/Guayaquil'), 'Mon YYYY') AS label,
        COALESCE(SUM(total_amount), 0)::float AS total
      FROM sales
      WHERE tenant_id = :tenantId
        AND status = 'COMPLETED'
        AND (created_at AT TIME ZONE 'America/Guayaquil') >= DATE_TRUNC('month', (NOW() AT TIME ZONE 'America/Guayaquil') - INTERVAL '1 month' * (:n - 1))
      GROUP BY month_key, label
      ORDER BY month_key ASC
    `, { replacements: { tenantId: parseInt(tenantId), n }, type: sequelize.QueryTypes.SELECT });

    // Rellenar meses sin ventas con 0
    const result = [];
    const now = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = d.toISOString().slice(0, 7); // YYYY-MM
      const found = rows.find(r => r.month_key === key);
      const label = d.toLocaleString('es', { month: 'short', year: 'numeric' });
      result.push({ month_key: key, label: found ? found.label : label, total: found ? found.total : 0 });
    }

    res.json(result);
  } catch (error) {
    console.error('Error getting monthly chart data:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /sales/stats/daily-chart - Ventas por día (últimos N días) para gráfico
router.get('/stats/daily-chart', async (req, res) => {
  try {
    const { tenantId, days = 30 } = req.query;
    if (!tenantId) return res.status(400).json({ error: 'tenantId is required' });

    const n = Math.min(Math.max(parseInt(days) || 30, 7), 90);
    const rows = await sequelize.query(`
      SELECT
        TO_CHAR(DATE_TRUNC('day', created_at AT TIME ZONE 'America/Guayaquil'), 'YYYY-MM-DD') AS day_key,
        COALESCE(SUM(total_amount), 0)::float AS total
      FROM sales
      WHERE tenant_id = :tenantId
        AND status = 'COMPLETED'
        AND (created_at AT TIME ZONE 'America/Guayaquil') >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Guayaquil')::date - INTERVAL '1 day' * (:n - 1)
      GROUP BY day_key
      ORDER BY day_key ASC
    `, { replacements: { tenantId: parseInt(tenantId), n }, type: sequelize.QueryTypes.SELECT });

    const result = [];
    const now = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const found = rows.find(r => r.day_key === key);
      const label = d.toLocaleString('es', { day: '2-digit', month: 'short' });
      result.push({ day_key: key, label, total: found ? found.total : 0 });
    }

    res.json(result);
  } catch (error) {
    console.error('Error getting daily chart data:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /sales/stats/monthly-total - Total ventas del mes actual (dashboard)
router.get('/stats/monthly-total', async (req, res) => {
  try {
    const { tenantId } = req.query;
    if (!tenantId) {
      return res.status(400).json({
        error: 'tenantId is required',
        code: 'TENANT_REQUIRED'
      });
    }
    const Op = require('sequelize').Op;
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const result = await Sale.sum('totalAmount', {
      where: {
        tenantId: parseInt(tenantId),
        status: 'COMPLETED',
        createdAt: {
          [Op.gte]: startOfMonth,
          [Op.lte]: endOfMonth
        }
      }
    });

    const total = result != null ? parseFloat(result) : 0;
    res.json({ total });
  } catch (error) {
    console.error('Error getting monthly sales total:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// GET /sales/stats/profitability - Rentabilidad (ingresos, COGS, gastos, ganancia neta)
router.get('/stats/profitability', async (req, res) => {
  try {
    const { tenantId, localDate } = req.query;
    if (!tenantId) return res.status(400).json({ error: 'tenantId is required' });
    const tid = parseInt(tenantId);
    const today = localDate || new Date().toISOString().slice(0, 10);

    const rows = await sequelize.query(`
      WITH
      sales_agg AS (
        SELECT
          COALESCE(SUM(CASE WHEN DATE(created_at AT TIME ZONE 'America/Guayaquil') = :today::date THEN total_amount ELSE 0 END), 0)::float AS today_rev,
          COALESCE(SUM(CASE WHEN DATE(created_at AT TIME ZONE 'America/Guayaquil') >= DATE_TRUNC('week', :today::date) THEN total_amount ELSE 0 END), 0)::float AS week_rev,
          COALESCE(SUM(CASE WHEN DATE(created_at AT TIME ZONE 'America/Guayaquil') >= DATE_TRUNC('month', :today::date) THEN total_amount ELSE 0 END), 0)::float AS month_rev,
          COALESCE(SUM(CASE WHEN DATE(created_at AT TIME ZONE 'America/Guayaquil') >= DATE_TRUNC('month', :today::date - INTERVAL '1 month')
            AND DATE(created_at AT TIME ZONE 'America/Guayaquil') < DATE_TRUNC('month', :today::date) THEN total_amount ELSE 0 END), 0)::float AS prev_rev
        FROM sales
        WHERE tenant_id = :tid AND status = 'COMPLETED'
      ),
      cogs_agg AS (
        SELECT
          COALESCE(SUM(CASE WHEN DATE(paid_at AT TIME ZONE 'America/Guayaquil') = :today::date THEN total_amount ELSE 0 END), 0)::float AS today_cogs,
          COALESCE(SUM(CASE WHEN DATE(paid_at AT TIME ZONE 'America/Guayaquil') >= DATE_TRUNC('week', :today::date) THEN total_amount ELSE 0 END), 0)::float AS week_cogs,
          COALESCE(SUM(CASE WHEN DATE(paid_at AT TIME ZONE 'America/Guayaquil') >= DATE_TRUNC('month', :today::date) THEN total_amount ELSE 0 END), 0)::float AS month_cogs,
          COALESCE(SUM(CASE WHEN DATE(paid_at AT TIME ZONE 'America/Guayaquil') >= DATE_TRUNC('month', :today::date - INTERVAL '1 month')
            AND DATE(paid_at AT TIME ZONE 'America/Guayaquil') < DATE_TRUNC('month', :today::date) THEN total_amount ELSE 0 END), 0)::float AS prev_cogs
        FROM purchase_orders
        WHERE tenant_id = :tid AND paid_at IS NOT NULL
      ),
      exp_agg AS (
        SELECT
          COALESCE(SUM(CASE WHEN expense_date = :today::date THEN amount ELSE 0 END), 0)::float AS today_exp,
          COALESCE(SUM(CASE WHEN expense_date >= DATE_TRUNC('week', :today::date) THEN amount ELSE 0 END), 0)::float AS week_exp,
          COALESCE(SUM(CASE WHEN expense_date >= DATE_TRUNC('month', :today::date) THEN amount ELSE 0 END), 0)::float AS month_exp,
          COALESCE(SUM(CASE WHEN expense_date >= DATE_TRUNC('month', :today::date - INTERVAL '1 month')
            AND expense_date < DATE_TRUNC('month', :today::date) THEN amount ELSE 0 END), 0)::float AS prev_exp
        FROM expenses
        WHERE tenant_id = :tid
      )
      SELECT s.*, c.*, e.* FROM sales_agg s, cogs_agg c, exp_agg e
    `, { replacements: { tid, today }, type: sequelize.QueryTypes.SELECT });

    const r = rows[0] || {};

    function calc(rev, cogs, exp) {
      const gross = rev - cogs;
      const net = gross - exp;
      const margin = rev > 0 ? Math.round((net / rev) * 1000) / 10 : 0;
      const cogsRatio = rev > 0 ? Math.round((cogs / rev) * 1000) / 10 : 0;
      const expRatio = rev > 0 ? Math.round((exp / rev) * 1000) / 10 : 0;
      return { revenue: rev, cogs, expenses: exp, grossProfit: gross, netProfit: net, marginPct: margin, cogsRatio, expRatio };
    }

    res.json({
      today: calc(r.today_rev || 0, r.today_cogs || 0, r.today_exp || 0),
      week:  calc(r.week_rev  || 0, r.week_cogs  || 0, r.week_exp  || 0),
      month: calc(r.month_rev || 0, r.month_cogs || 0, r.month_exp || 0),
      prevMonth: calc(r.prev_rev || 0, r.prev_cogs || 0, r.prev_exp || 0)
    });
  } catch (error) {
    console.error('Error getting profitability:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /sales/stats/profitability/products - Rentabilidad por producto
router.get('/stats/profitability/products', async (req, res) => {
  try {
    const { tenantId, dateFrom, dateTo, search, limit = 50, page = 1 } = req.query;
    if (!tenantId) return res.status(400).json({ error: 'tenantId is required' });
    const tid = parseInt(tenantId);
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const salesDateFilter = dateFrom || dateTo
      ? `AND s.created_at::date BETWEEN COALESCE(:dateFrom::date, '1900-01-01') AND COALESCE(:dateTo::date, CURRENT_DATE)`
      : '';

    const searchFilter = search ? `AND LOWER(p.name) LIKE LOWER(:search)` : '';

    // COGS priority: 1) p.unit_cost (own), 2) base_product.unit_cost × unitsPerSale,
    // 3) weighted avg from movements × unitsPerSale
    const rows = await sequelize.query(`
      WITH avg_costs AS (
        SELECT
          COALESCE(p.base_product_id, p.id) AS pool_id,
          CASE WHEN SUM(im.qty) > 0
            THEN SUM(im.qty * im.unit_cost) / SUM(im.qty)
            ELSE 0
          END AS avg_unit_cost
        FROM products p
        LEFT JOIN inventory_movements im
          ON im.product_id = COALESCE(p.base_product_id, p.id)
          AND im.movement_type = 'IN'
          AND im.unit_cost IS NOT NULL
          AND im.tenant_id = :tid
        WHERE p.tenant_id = :tid
        GROUP BY COALESCE(p.base_product_id, p.id)
      )
      SELECT
        p.id,
        p.name,
        p.sale_price,
        COALESCE(SUM(si.quantity), 0)::float AS qty_vendida,
        COALESCE(SUM(si.unit_price * si.quantity), 0)::float AS ingresos,
        -- COGS: own unit_cost → base product unit_cost × unitsPerSale → avg movements
        COALESCE(SUM(
          si.quantity * COALESCE(
            p.unit_cost,
            bp.unit_cost * p.units_per_sale,
            ac.avg_unit_cost * p.units_per_sale
          )
        ), 0)::float AS cogs,
        COALESCE(SUM(si.unit_price * si.quantity), 0)
          - COALESCE(SUM(si.quantity * COALESCE(p.unit_cost, bp.unit_cost * p.units_per_sale, ac.avg_unit_cost * p.units_per_sale)), 0) AS ganancia_bruta,
        CASE WHEN COALESCE(SUM(si.unit_price * si.quantity), 0) > 0
          THEN ROUND((
            (COALESCE(SUM(si.unit_price * si.quantity), 0)
              - COALESCE(SUM(si.quantity * COALESCE(p.unit_cost, bp.unit_cost * p.units_per_sale, ac.avg_unit_cost * p.units_per_sale)), 0))
            / SUM(si.unit_price * si.quantity) * 100
          )::numeric, 1)
          ELSE 0
        END AS margen_pct
      FROM products p
      LEFT JOIN products bp ON bp.id = p.base_product_id
      JOIN sale_items si ON si.product_id = p.id
      JOIN sales s ON s.id = si.sale_id AND s.tenant_id = :tid AND s.status = 'COMPLETED'
      LEFT JOIN avg_costs ac ON ac.pool_id = COALESCE(p.base_product_id, p.id)
      WHERE p.tenant_id = :tid ${searchFilter} ${salesDateFilter}
      GROUP BY p.id, p.name, p.sale_price, p.unit_cost, p.units_per_sale, bp.unit_cost
      HAVING COALESCE(SUM(si.quantity), 0) > 0
      ORDER BY ganancia_bruta DESC
      LIMIT :limit OFFSET :offset
    `, {
      replacements: { tid, dateFrom: dateFrom || null, dateTo: dateTo || null, search: search ? `%${search}%` : null, limit: parseInt(limit), offset },
      type: sequelize.QueryTypes.SELECT
    });

    const [countRow] = await sequelize.query(`
      SELECT COUNT(DISTINCT p.id) AS total
      FROM products p
      JOIN sale_items si ON si.product_id = p.id
      JOIN sales s ON s.id = si.sale_id AND s.tenant_id = :tid AND s.status = 'COMPLETED'
      WHERE p.tenant_id = :tid ${searchFilter}
    `, { replacements: { tid, search: search ? `%${search}%` : null }, type: sequelize.QueryTypes.SELECT });

    res.json({
      products: rows,
      total: parseInt(countRow?.total || 0),
      page: parseInt(page),
      totalPages: Math.ceil(parseInt(countRow?.total || 0) / parseInt(limit))
    });
  } catch (error) {
    console.error('Error getting product profitability:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /sales/:id - Get sale by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { tenantId } = req.query;

    const sale = await Sale.findOne({
      where: { id, tenantId },
      include: [
        { association: 'customer', required: false },
        {
          association: 'items',
          include: [{
            association: 'product'
          }]
        }
      ]
    });

    if (!sale) {
      return res.status(404).json({
        error: 'Sale not found',
        code: 'SALE_NOT_FOUND'
      });
    }

    res.json(sale);
  } catch (error) {
    console.error('Error getting sale:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// PATCH /sales/:id/confirm-transfer - Confirm transfer payment (same logic as confirm-cash)
router.patch('/:id/confirm-transfer', async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { id } = req.params;
    const saleId = parseInt(id, 10);
    if (isNaN(saleId)) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Invalid sale id', code: 'INVALID_ID' });
    }

    const sale = await Sale.findOne({
      where: { id: saleId },
      include: [
        {
          association: 'items',
          include: [{ association: 'product' }]
        }
      ],
      transaction
    });

    if (!sale) {
      await transaction.rollback();
      return res.status(404).json({
        error: 'Venta no encontrada con ese ID',
        code: 'SALE_NOT_FOUND'
      });
    }
    if (sale.status !== 'PENDING') {
      await transaction.rollback();
      return res.status(400).json({
        error: `La venta no está pendiente (estado actual: ${sale.status})`,
        code: 'SALE_NOT_PENDING'
      });
    }
    const method = (sale.paymentMethod || '').toUpperCase();
    if (method !== 'TRANSFER') {
      await transaction.rollback();
      return res.status(400).json({
        error: `La venta no es por transferencia (método: ${sale.paymentMethod}). Use "Confirmar pago" si es efectivo.`,
        code: 'SALE_NOT_TRANSFER'
      });
    }

    const tenantId = Number(sale.tenantId);

    sale.status = 'COMPLETED';
    await sale.save({ transaction });

    const inventoryMovementsPromises = sale.items.map(async (item) => {
      const product = item.product;
      if (product.productType === 'SIMPLE') {
        const { productId: mvProductId, qty: mvQty } = resolveMovement(product, item.quantity);
        await InventoryMovement.create({
          tenantId,
          productId: mvProductId,
          movementType: 'OUT',
          reason: 'SALE',
          qty: mvQty,
          unitCost: await InventoryMovement.getUnitCost(
            tenantId,
            mvProductId,
            mvQty,
            transaction
          ),
          refType: 'SALE',
          refId: sale.id
        }, { transaction });
      } else {
        await ComboService.createComboSaleMovements(
          tenantId,
          item.productId,
          item.quantity,
          sale.id,
          transaction
        );
      }
    });

    await Promise.all(inventoryMovementsPromises);

    await Notification.destroy({
      where: { saleId: sale.id },
      transaction
    });

    await transaction.commit();

    const io = req.app.get('io');
    if (io) {
      io.to(`sale:${sale.id}`).emit('sale-confirmed', { saleId: sale.id });
    }

    // Fetch complete sale with associations
    const completeSale = await Sale.findByPk(sale.id, {
      include: [
        {
          association: 'items',
          include: [{
            association: 'product'
          }]
        }
      ]
    });

    res.json(completeSale);
  } catch (error) {
    await transaction.rollback();
    console.error('Error confirming transfer:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// POST /sales/:id/confirm-cash - Confirm cash payment (customer web order, pending staff confirmation)
router.post('/:id/confirm-cash', async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { id } = req.params;
    const saleId = parseInt(id, 10);
    if (isNaN(saleId)) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Invalid sale id', code: 'INVALID_ID' });
    }

    // Find by id first to give a clear error if sale exists but is not confirmable
    const sale = await Sale.findOne({
      where: { id: saleId },
      include: [
        {
          association: 'items',
          include: [{ association: 'product' }]
        }
      ],
      transaction
    });

    if (!sale) {
      await transaction.rollback();
      return res.status(404).json({
        error: 'Venta no encontrada con ese ID',
        code: 'SALE_NOT_FOUND'
      });
    }
    if (sale.status !== 'PENDING') {
      await transaction.rollback();
      return res.status(400).json({
        error: `La venta no está pendiente (estado actual: ${sale.status})`,
        code: 'SALE_NOT_PENDING'
      });
    }
    const method = (sale.paymentMethod || '').toUpperCase();
    if (method !== 'CASH') {
      await transaction.rollback();
      return res.status(400).json({
        error: `La venta no es de pago en efectivo (método: ${sale.paymentMethod}). Use "Confirmar transferencia" si es transferencia.`,
        code: 'SALE_NOT_CASH'
      });
    }

    const tenantId = Number(sale.tenantId);

    sale.status = 'COMPLETED';
    await sale.save({ transaction });

    const inventoryMovementsPromises = sale.items.map(async (item) => {
      const product = item.product;
      if (product.productType === 'SIMPLE') {
        const { productId: mvProductId, qty: mvQty } = resolveMovement(product, item.quantity);
        await InventoryMovement.create({
          tenantId,
          productId: mvProductId,
          movementType: 'OUT',
          reason: 'SALE',
          qty: mvQty,
          unitCost: await InventoryMovement.getUnitCost(
            tenantId,
            mvProductId,
            mvQty,
            transaction
          ),
          refType: 'SALE',
          refId: sale.id
        }, { transaction });
      } else {
        await ComboService.createComboSaleMovements(
          tenantId,
          item.productId,
          item.quantity,
          sale.id,
          transaction
        );
      }
    });

    await Promise.all(inventoryMovementsPromises);

    // Remove notifications for this sale so they disappear for all staff
    await Notification.destroy({
      where: { saleId: sale.id },
      transaction
    });

    await transaction.commit();

    const io = req.app.get('io');
    if (io) {
      io.to(`sale:${sale.id}`).emit('sale-confirmed', { saleId: sale.id });
    }

    const completeSale = await Sale.findByPk(sale.id, {
      include: [
        {
          association: 'items',
          include: [{ association: 'product' }]
        }
      ]
    });

    res.json(completeSale);
  } catch (error) {
    await transaction.rollback();
    console.error('Error confirming cash:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// POST /sales/:id/void - Anular una venta (restaura inventario, cancela crédito asociado)
router.post('/:id/void', async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { tenantId, reason } = req.body;
    const saleId = parseInt(id, 10);
    if (isNaN(saleId)) {
      await transaction.rollback();
      return res.status(400).json({ error: 'ID de venta inválido', code: 'INVALID_ID' });
    }

    const sale = await Sale.findOne({
      where: { id: saleId, tenantId, status: { [Op.ne]: 'VOIDED' } },
      transaction
    });

    if (!sale) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Venta no encontrada o ya está anulada', code: 'SALE_NOT_FOUND' });
    }

    // Restaurar inventario: revertir los movimientos OUT de esta venta
    const movements = await InventoryMovement.findAll({
      where: { refType: 'SALE', refId: saleId, movementType: 'OUT' },
      transaction
    });

    for (const mv of movements) {
      await InventoryMovement.create({
        tenantId,
        productId: mv.productId,
        movementType: 'IN',
        reason: 'VOID',
        qty: mv.qty,
        unitCost: mv.unitCost,
        refType: 'SALE_VOID',
        refId: saleId
      }, { transaction });
    }

    // Cancelar créditos directos (ventas individuales)
    await CustomerCredit.update(
      { status: 'CANCELLED' },
      { where: { saleId, status: 'ACTIVE', tenantId }, transaction }
    );

    // Cancelar créditos de venta grupal (vinculados por groupPurchaseParticipantId)
    const groupPurchase = await GroupPurchase.findOne({ where: { saleId }, transaction });
    if (groupPurchase) {
      const participants = await GroupPurchaseParticipant.findAll({
        where: { groupPurchaseId: groupPurchase.id },
        transaction
      });
      const participantIds = participants.map(p => p.id);
      if (participantIds.length > 0) {
        await CustomerCredit.update(
          { status: 'CANCELLED' },
          { where: { groupPurchaseParticipantId: { [Op.in]: participantIds }, status: 'ACTIVE' }, transaction }
        );
      }
    }

    // Anular la venta
    sale.status = 'VOIDED';
    sale.voidReason = reason || 'Venta anulada';
    sale.voidedAt = new Date();
    await sale.save({ transaction });

    await Notification.destroy({ where: { saleId: sale.id }, transaction });

    await transaction.commit();

    const io = req.app.get('io');
    if (io) {
      io.to(`sale:${sale.id}`).emit('sale-voided', { saleId: sale.id });
      if (sale.customerId) {
        io.to(`customer:${sale.customerId}`).emit('sale-voided', { saleId: sale.id });
      }
    }

    AuditService.log({
      ...AuditService.fromReq(req),
      action: 'UPDATE', entity: 'sale', entityId: sale.id,
      description: `Anuló venta #${sale.id} — Motivo: ${reason || 'No especificado'}`,
      metadata: { reason, movimientosRevertidos: movements.length }
    });

    res.json({ success: true, saleId });
  } catch (error) {
    await transaction.rollback();
    console.error('Error al anular venta:', error);
    res.status(500).json({ error: 'Error interno al anular la venta', code: 'INTERNAL_ERROR' });
  }
});

// PATCH /sales/:id/reject-pending - Reject a pending order (cash or transfer) when client never showed / never paid
router.patch('/:id/reject-pending', async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { id } = req.params;
    const saleId = parseInt(id, 10);
    if (isNaN(saleId)) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Invalid sale id', code: 'INVALID_ID' });
    }
    const voidReason = (req.body.voidReason && String(req.body.voidReason).trim()) || 'Orden rechazada (cliente no llegó o no pagó)';

    const sale = await Sale.findOne({
      where: {
        id: saleId,
        status: 'PENDING',
        paymentMethod: { [Op.in]: ['CASH', 'TRANSFER'] }
      },
      transaction
    });

    if (!sale) {
      await transaction.rollback();
      return res.status(404).json({
        error: 'Venta pendiente no encontrada (solo se pueden rechazar órdenes en efectivo o transferencia pendientes)',
        code: 'SALE_NOT_FOUND'
      });
    }

    sale.status = 'VOIDED';
    sale.voidReason = voidReason;
    sale.voidedAt = new Date();
    await sale.save({ transaction });

    await Notification.destroy({
      where: { saleId: sale.id },
      transaction
    });

    await transaction.commit();

    const io = req.app.get('io');
    if (io) {
      io.to(`sale:${sale.id}`).emit('sale-voided', { saleId: sale.id, voidReason: voidReason });
      if (sale.customerId) {
        io.to(`customer:${sale.customerId}`).emit('sale-voided', { saleId: sale.id, voidReason: voidReason });
      }
    }

    const updated = await Sale.findByPk(sale.id, {
      include: [
        { association: 'items', include: [{ association: 'product' }] },
        { association: 'customer', attributes: ['id', 'name'] }
      ]
    });
    res.json(updated);
  } catch (error) {
    await transaction.rollback();
    console.error('Error rejecting pending sale:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// DELETE /sales/:id - Eliminar venta anulada permanentemente
router.delete('/:id', async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { tenantId } = req.query;
    const saleId = parseInt(req.params.id, 10);
    if (isNaN(saleId)) {
      await transaction.rollback();
      return res.status(400).json({ error: 'ID inválido', code: 'INVALID_ID' });
    }

    const sale = await Sale.findOne({
      where: { id: saleId, tenantId, status: 'VOIDED' },
      transaction
    });

    if (!sale) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Solo se pueden eliminar ventas anuladas', code: 'NOT_FOUND' });
    }

    await SaleItem.destroy({ where: { saleId }, transaction });
    await InventoryMovement.destroy({ where: { refId: saleId, refType: { [Op.in]: ['SALE', 'SALE_VOID'] } }, transaction });
    await Notification.destroy({ where: { saleId }, transaction });

    // Eliminar créditos directos
    await CustomerCredit.destroy({ where: { saleId }, transaction });

    // Eliminar créditos de venta grupal
    const groupPurchase = await GroupPurchase.findOne({ where: { saleId }, transaction });
    if (groupPurchase) {
      const participants = await GroupPurchaseParticipant.findAll({
        where: { groupPurchaseId: groupPurchase.id }, transaction
      });
      const participantIds = participants.map(p => p.id);
      if (participantIds.length > 0) {
        await CustomerCredit.destroy({
          where: { groupPurchaseParticipantId: { [Op.in]: participantIds } }, transaction
        });
      }
      await GroupPurchaseParticipant.destroy({ where: { groupPurchaseId: groupPurchase.id }, transaction });
      await groupPurchase.destroy({ transaction });
    }

    await sale.destroy({ transaction });

    await transaction.commit();

    AuditService.log({
      ...AuditService.fromReq(req),
      action: 'DELETE', entity: 'sale', entityId: saleId,
      description: `Eliminó venta anulada #${saleId}`
    });

    res.json({ success: true });
  } catch (error) {
    await transaction.rollback();
    console.error('Error eliminando venta:', error);
    res.status(500).json({ error: 'Error interno al eliminar la venta', code: 'INTERNAL_ERROR' });
  }
});

module.exports = router;