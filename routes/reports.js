const express = require('express');
const { SaleItem, Product } = require('../models');
const ComboService = require('../services/ComboService');
const { requireRole, checkPermission } = require('./adminAuth');
const { Op } = require('sequelize');

const router = express.Router();

// Reportes requieren al menos permiso 'read' en sección 'sales'
router.use(checkPermission('sales', 'read'));

// GET /reports/combo-sales - Combo sales report with implied discount and margin
router.get('/combo-sales', async (req, res) => {
  try {
    const tenantId = req.tenantId || 1;
    const { startDate, endDate, comboId, limit = 200, page = 1 } = req.query;
    const pageSize = Math.min(parseInt(limit) || 200, 500);
    const offset = (Math.max(parseInt(page) || 1, 1) - 1) * pageSize;

    // Build where clause for sales
    const saleWhereClause = { tenantId, status: 'COMPLETED' };
    if (startDate || endDate) {
      saleWhereClause.createdAt = {};
      if (startDate) saleWhereClause.createdAt[Op.gte] = startDate;
      if (endDate) saleWhereClause.createdAt[Op.lte] = endDate;
    }

    // Build where clause for sale items (only combos)
    const itemWhereClause = { productType: 'COMBO' };
    if (comboId) itemWhereClause.productId = comboId;

    // Get combo sales with pagination
    const { count, rows: comboSales } = await SaleItem.findAndCountAll({
      where: itemWhereClause,
      include: [
        { association: 'sale', where: saleWhereClause },
        { association: 'product', where: { tenantId } }
      ],
      order: [[{ association: 'sale' }, 'createdAt', 'DESC']],
      limit: pageSize,
      offset
    });

    // Obtener IDs únicos de combos para batch de costos
    const uniqueComboIds = [...new Set(comboSales.map(si => si.productId))];

    // Batch: calcular costos de todos los combos de una vez
    const comboMetricsMap = {};
    for (const cid of uniqueComboIds) {
      comboMetricsMap[cid] = await ComboService.calculateComboCost(tenantId, cid);
    }

    // Calculate detailed metrics for each combo sale
    const detailedSales = comboSales.map(saleItem => {
      const comboMetrics = comboMetricsMap[saleItem.productId];
      const itemTotal = saleItem.totalPrice;
      const itemCost = comboMetrics.comboCost * saleItem.quantity;
      const itemMargin = itemTotal - itemCost;
      const itemDiscount = (comboMetrics.componentPriceSum - saleItem.unitPrice) * saleItem.quantity;

      return {
        saleId: saleItem.saleId,
        saleDate: saleItem.sale.createdAt,
        comboId: saleItem.productId,
        comboName: saleItem.product.name,
        comboSku: saleItem.product.sku,
        quantity: saleItem.quantity,
        unitPrice: saleItem.unitPrice,
        totalPrice: itemTotal,
        comboUnitCost: comboMetrics.comboCost,
        totalCost: itemCost,
        unitMargin: saleItem.unitPrice - comboMetrics.comboCost,
        totalMargin: itemMargin,
        marginPercentage: itemTotal > 0 ? (itemMargin / itemTotal) * 100 : 0,
        componentPriceSum: comboMetrics.componentPriceSum,
        unitImpliedDiscount: comboMetrics.componentPriceSum - saleItem.unitPrice,
        totalImpliedDiscount: itemDiscount,
        discountPercentage: comboMetrics.componentPriceSum > 0 ?
          ((comboMetrics.componentPriceSum - saleItem.unitPrice) / comboMetrics.componentPriceSum) * 100 : 0
      };
    });

    // Calculate summary totals
    const summary = detailedSales.reduce((acc, sale) => {
      acc.totalRevenue += sale.totalPrice;
      acc.totalCost += sale.totalCost;
      acc.totalMargin += sale.totalMargin;
      acc.totalDiscount += sale.totalImpliedDiscount;
      acc.totalQuantity += sale.quantity;
      acc.totalCombos += 1;
      return acc;
    }, { totalRevenue: 0, totalCost: 0, totalMargin: 0, totalDiscount: 0, totalQuantity: 0, totalCombos: 0 });

    summary.avgMarginPercentage = summary.totalRevenue > 0 ?
      (summary.totalMargin / summary.totalRevenue) * 100 : 0;
    summary.avgDiscountPercentage = summary.totalRevenue > 0 ?
      (summary.totalDiscount / (summary.totalRevenue + summary.totalDiscount)) * 100 : 0;

    res.json({
      summary,
      sales: detailedSales,
      pagination: { total: count, page: parseInt(page) || 1, pageSize, totalPages: Math.ceil(count / pageSize) },
      filters: { tenantId, startDate, endDate, comboId }
    });
  } catch (error) {
    console.error('Error generating combo sales report:', error);
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
  }
});

// GET /reports/combo-performance - Overall combo performance metrics
router.get('/combo-performance', async (req, res) => {
  try {
    const tenantId = req.tenantId || 1;
    const { startDate, endDate } = req.query;

    // Get all active combos
    const combos = await Product.findAll({
      where: { tenantId, productType: 'COMBO', isActive: true },
      include: [{ association: 'components', include: [{ association: 'component' }] }]
    });

    // Build sale date filter
    const saleWhereClause = { tenantId, status: 'COMPLETED' };
    if (startDate || endDate) {
      saleWhereClause.createdAt = {};
      if (startDate) saleWhereClause.createdAt[Op.gte] = startDate;
      if (endDate) saleWhereClause.createdAt[Op.lte] = endDate;
    }

    // Batch: obtener todas las ventas de combos en 1 query
    const comboIds = combos.map(c => c.id);
    const allSalesData = comboIds.length > 0 ? await SaleItem.findAll({
      where: { productId: comboIds, productType: 'COMBO' },
      include: [{ association: 'sale', where: saleWhereClause, attributes: ['id'] }],
      attributes: ['productId', 'quantity', 'totalPrice']
    }) : [];

    // Agrupar ventas por comboId
    const salesByCombo = {};
    for (const si of allSalesData) {
      if (!salesByCombo[si.productId]) salesByCombo[si.productId] = [];
      salesByCombo[si.productId].push(si);
    }

    // Batch: calcular costos y disponibilidad
    const comboPerformance = [];
    for (const combo of combos) {
      const salesData = salesByCombo[combo.id] || [];
      const totalQuantity = salesData.reduce((sum, item) => sum + item.quantity, 0);
      const totalRevenue = salesData.reduce((sum, item) => sum + item.totalPrice, 0);

      const comboMetrics = await ComboService.calculateComboCost(tenantId, combo.id);
      const totalCost = comboMetrics.comboCost * totalQuantity;
      const totalMargin = totalRevenue - totalCost;
      const totalDiscount = (comboMetrics.componentPriceSum - combo.salePrice) * totalQuantity;

      const availability = await ComboService.getComboAvailability(tenantId, combo.id);

      comboPerformance.push({
        comboId: combo.id,
        comboName: combo.name,
        comboSku: combo.sku,
        totalSales: salesData.length,
        totalQuantity,
        totalRevenue,
        unitCost: comboMetrics.comboCost,
        totalCost,
        totalMargin,
        marginPercentage: totalRevenue > 0 ? (totalMargin / totalRevenue) * 100 : 0,
        componentPriceSum: comboMetrics.componentPriceSum,
        unitImpliedDiscount: comboMetrics.componentPriceSum - combo.salePrice,
        totalDiscount,
        discountPercentage: comboMetrics.componentPriceSum > 0 ?
          ((comboMetrics.componentPriceSum - combo.salePrice) / comboMetrics.componentPriceSum) * 100 : 0,
        currentStock: availability.availableStock,
        componentDetails: availability.components
      });
    }

    // Sort by total revenue descending
    comboPerformance.sort((a, b) => b.totalRevenue - a.totalRevenue);

    // Calculate overall summary
    const overallSummary = comboPerformance.reduce((acc, combo) => {
      acc.totalCombos += 1;
      acc.totalRevenue += combo.totalRevenue;
      acc.totalCost += combo.totalCost;
      acc.totalMargin += combo.totalMargin;
      acc.totalDiscount += combo.totalDiscount;
      acc.totalQuantity += combo.totalQuantity;
      acc.totalSales += combo.totalSales;
      return acc;
    }, { totalCombos: 0, totalRevenue: 0, totalCost: 0, totalMargin: 0, totalDiscount: 0, totalQuantity: 0, totalSales: 0 });

    overallSummary.avgMarginPercentage = overallSummary.totalRevenue > 0 ?
      (overallSummary.totalMargin / overallSummary.totalRevenue) * 100 : 0;
    overallSummary.avgDiscountPercentage = overallSummary.totalRevenue > 0 ?
      (overallSummary.totalDiscount / (overallSummary.totalRevenue + overallSummary.totalDiscount)) * 100 : 0;

    res.json({
      summary: overallSummary,
      combos: comboPerformance,
      filters: { tenantId, startDate, endDate }
    });
  } catch (error) {
    console.error('Error generating combo performance report:', error);
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
  }
});

module.exports = router;
