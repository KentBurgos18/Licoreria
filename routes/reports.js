const express = require('express');
const { Sale, SaleItem, Product, ProductComponent, InventoryMovement } = require('../models');
const ComboService = require('../services/ComboService');
const { sequelize } = require('../models');
const { requireRole } = require('./adminAuth');

const router = express.Router();

// Todas las rutas de reportes requieren rol ADMIN
router.use(requireRole('ADMIN'));

// GET /reports/combo-sales - Combo sales report with implied discount and margin
router.get('/combo-sales', async (req, res) => {
  try {
    const {
      tenantId,
      startDate,
      endDate,
      comboId
    } = req.query;

    if (!tenantId) {
      return res.status(400).json({
        error: 'Tenant ID is required',
        code: 'TENANT_REQUIRED'
      });
    }

    // Build where clause for sales
    const saleWhereClause = {
      tenantId,
      status: 'COMPLETED'
    };

    if (startDate || endDate) {
      saleWhereClause.createdAt = {};
      if (startDate) saleWhereClause.createdAt[require('sequelize').Op.gte] = startDate;
      if (endDate) saleWhereClause.createdAt[require('sequelize').Op.lte] = endDate;
    }

    // Build where clause for sale items (only combos)
    const itemWhereClause = {
      productType: 'COMBO'
    };

    if (comboId) {
      itemWhereClause.productId = comboId;
    }

    // Get combo sales with detailed calculations
    const comboSales = await SaleItem.findAll({
      where: itemWhereClause,
      include: [
        {
          association: 'sale',
          where: saleWhereClause
        },
        {
          association: 'product',
          where: { tenantId }
        }
      ],
      order: [[{ association: 'sale' }, 'createdAt', 'DESC']]
    });

    // Calculate detailed metrics for each combo sale
    const detailedSales = [];
    for (const saleItem of comboSales) {
      const comboMetrics = await ComboService.calculateComboCost(
        tenantId,
        saleItem.productId
      );

      const itemTotal = saleItem.totalPrice;
      const itemCost = comboMetrics.comboCost * saleItem.quantity;
      const itemMargin = itemTotal - itemCost;
      const itemDiscount = (comboMetrics.componentPriceSum - saleItem.unitPrice) * saleItem.quantity;

      detailedSales.push({
        saleId: saleItem.saleId,
        saleDate: saleItem.sale.createdAt,
        comboId: saleItem.productId,
        comboName: saleItem.product.name,
        comboSku: saleItem.product.sku,
        quantity: saleItem.quantity,
        unitPrice: saleItem.unitPrice,
        totalPrice: itemTotal,
        // Cost calculations
        comboUnitCost: comboMetrics.comboCost,
        totalCost: itemCost,
        // Margin calculations
        unitMargin: saleItem.unitPrice - comboMetrics.comboCost,
        totalMargin: itemMargin,
        marginPercentage: itemTotal > 0 ? (itemMargin / itemTotal) * 100 : 0,
        // Discount calculations
        componentPriceSum: comboMetrics.componentPriceSum,
        unitImpliedDiscount: comboMetrics.componentPriceSum - saleItem.unitPrice,
        totalImpliedDiscount: itemDiscount,
        discountPercentage: comboMetrics.componentPriceSum > 0 ? 
          ((comboMetrics.componentPriceSum - saleItem.unitPrice) / comboMetrics.componentPriceSum) * 100 : 0
      });
    }

    // Calculate summary totals
    const summary = detailedSales.reduce((acc, sale) => {
      acc.totalRevenue += sale.totalPrice;
      acc.totalCost += sale.totalCost;
      acc.totalMargin += sale.totalMargin;
      acc.totalDiscount += sale.totalImpliedDiscount;
      acc.totalQuantity += sale.quantity;
      acc.totalCombos += 1;
      return acc;
    }, {
      totalRevenue: 0,
      totalCost: 0,
      totalMargin: 0,
      totalDiscount: 0,
      totalQuantity: 0,
      totalCombos: 0
    });

    summary.avgMarginPercentage = summary.totalRevenue > 0 ? 
      (summary.totalMargin / summary.totalRevenue) * 100 : 0;
    summary.avgDiscountPercentage = summary.totalRevenue > 0 ? 
      (summary.totalDiscount / (summary.totalRevenue + summary.totalDiscount)) * 100 : 0;

    res.json({
      summary,
      sales: detailedSales,
      filters: {
        tenantId,
        startDate,
        endDate,
        comboId
      }
    });
  } catch (error) {
    console.error('Error generating combo sales report:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// GET /reports/combo-performance - Overall combo performance metrics
router.get('/combo-performance', async (req, res) => {
  try {
    const { tenantId, startDate, endDate } = req.query;

    if (!tenantId) {
      return res.status(400).json({
        error: 'Tenant ID is required',
        code: 'TENANT_REQUIRED'
      });
    }

    // Get all active combos
    const combos = await Product.findAll({
      where: {
        tenantId,
        productType: 'COMBO',
        isActive: true
      },
      include: [{
        association: 'components',
        include: [{
          association: 'component'
        }]
      }]
    });

    // Calculate performance metrics for each combo
    const comboPerformance = [];
    for (const combo of combos) {
      // Get sales data for this combo
      const saleWhereClause = {
        tenantId,
        status: 'COMPLETED'
      };

      if (startDate || endDate) {
        saleWhereClause.createdAt = {};
        if (startDate) saleWhereClause.createdAt[require('sequelize').Op.gte] = startDate;
        if (endDate) saleWhereClause.createdAt[require('sequelize').Op.lte] = endDate;
      }

      const salesData = await SaleItem.findAll({
        where: {
          productId: combo.id,
          productType: 'COMBO'
        },
        include: [{
          association: 'sale',
          where: saleWhereClause
        }]
      });

      // Calculate metrics
      const totalQuantity = salesData.reduce((sum, item) => sum + item.quantity, 0);
      const totalRevenue = salesData.reduce((sum, item) => sum + item.totalPrice, 0);

      const comboMetrics = await ComboService.calculateComboCost(tenantId, combo.id);
      const totalCost = comboMetrics.comboCost * totalQuantity;
      const totalMargin = totalRevenue - totalCost;
      const totalDiscount = (comboMetrics.componentPriceSum - combo.salePrice) * totalQuantity;

      // Get current availability
      const availability = await ComboService.getComboAvailability(tenantId, combo.id);

      comboPerformance.push({
        comboId: combo.id,
        comboName: combo.name,
        comboSku: combo.sku,
        // Sales metrics
        totalSales: salesData.length,
        totalQuantity,
        totalRevenue,
        // Cost and margin
        unitCost: comboMetrics.comboCost,
        totalCost,
        totalMargin,
        marginPercentage: totalRevenue > 0 ? (totalMargin / totalRevenue) * 100 : 0,
        // Discount metrics
        componentPriceSum: comboMetrics.componentPriceSum,
        unitImpliedDiscount: comboMetrics.componentPriceSum - combo.salePrice,
        totalDiscount,
        discountPercentage: comboMetrics.componentPriceSum > 0 ? 
          ((comboMetrics.componentPriceSum - combo.salePrice) / comboMetrics.componentPriceSum) * 100 : 0,
        // Availability
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
    }, {
      totalCombos: 0,
      totalRevenue: 0,
      totalCost: 0,
      totalMargin: 0,
      totalDiscount: 0,
      totalQuantity: 0,
      totalSales: 0
    });

    overallSummary.avgMarginPercentage = overallSummary.totalRevenue > 0 ? 
      (overallSummary.totalMargin / overallSummary.totalRevenue) * 100 : 0;
    overallSummary.avgDiscountPercentage = overallSummary.totalRevenue > 0 ? 
      (overallSummary.totalDiscount / (overallSummary.totalRevenue + overallSummary.totalDiscount)) * 100 : 0;

    res.json({
      summary: overallSummary,
      combos: comboPerformance,
      filters: {
        tenantId,
        startDate,
        endDate
      }
    });
  } catch (error) {
    console.error('Error generating combo performance report:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

module.exports = router;