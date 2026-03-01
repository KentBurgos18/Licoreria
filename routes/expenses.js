const express = require('express');
const { Op } = require('sequelize');
const router = express.Router();

const ExpenseCategoryModel = require('../models/ExpenseCategory');
const ExpenseModel         = require('../models/Expense');
const { sequelize }        = require('../models');

const ExpenseCategory = ExpenseCategoryModel(sequelize);
const Expense         = ExpenseModel(sequelize);

// Asociación para JOINs
Expense.belongsTo(ExpenseCategory, { foreignKey: 'categoryId', as: 'category' });
ExpenseCategory.hasMany(Expense,   { foreignKey: 'categoryId', as: 'expenses' });

// ─────────────────────────────────────────────────────────────
// GET /api/expenses/categories — lista de categorías del tenant
// ─────────────────────────────────────────────────────────────
router.get('/categories', async (req, res) => {
  try {
    const tenantId = req.tenantId || 1;
    const categories = await ExpenseCategory.findAll({
      where: { tenantId },
      order: [['name', 'ASC']]
    });
    res.json({ categories });
  } catch (error) {
    console.error('Error listando categorías de gastos:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/expenses/summary — totales del mes, año y por categoría
// ─────────────────────────────────────────────────────────────
router.get('/summary', async (req, res) => {
  try {
    const tenantId = req.tenantId || 1;

    const [rows] = await sequelize.query(`
      SELECT
        COALESCE(SUM(CASE
          WHEN DATE_TRUNC('month', e.expense_date) = DATE_TRUNC('month', CURRENT_DATE)
          THEN e.amount ELSE 0 END), 0) AS this_month,
        COALESCE(SUM(CASE
          WHEN DATE_PART('year', e.expense_date) = DATE_PART('year', CURRENT_DATE)
          THEN e.amount ELSE 0 END), 0) AS this_year,
        ec.name AS category,
        COALESCE(SUM(e.amount), 0) AS category_total
      FROM expenses e
      LEFT JOIN expense_categories ec ON ec.id = e.category_id
      WHERE e.tenant_id = :tenantId
      GROUP BY ec.name
      ORDER BY category_total DESC
    `, { replacements: { tenantId } });

    const thisMonth    = rows.length > 0 ? parseFloat(rows[0].this_month)  : 0;
    const thisYear     = rows.length > 0 ? parseFloat(rows[0].this_year)   : 0;
    const byCategory   = rows.map(r => ({ name: r.category || 'Sin categoría', total: parseFloat(r.category_total) }));
    const topCategory  = byCategory.length > 0 ? byCategory[0] : null;

    res.json({ thisMonth, thisYear, byCategory, topCategory });
  } catch (error) {
    console.error('Error calculando resumen de gastos:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/expenses — lista con filtros
// ─────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const tenantId  = req.tenantId || 1;
    const { categoryId, startDate, endDate, page = 1, limit = 50 } = req.query;

    const where = { tenantId };
    if (categoryId) where.categoryId = Number(categoryId);
    if (startDate || endDate) {
      where.expenseDate = {};
      if (startDate) where.expenseDate[Op.gte] = startDate;
      if (endDate)   where.expenseDate[Op.lte] = endDate;
    }

    const offset = (Number(page) - 1) * Number(limit);

    const { count, rows } = await Expense.findAndCountAll({
      where,
      include: [{ model: ExpenseCategory, as: 'category', attributes: ['id', 'name'] }],
      order:   [['expenseDate', 'DESC'], ['createdAt', 'DESC']],
      limit:   Number(limit),
      offset
    });

    res.json({ expenses: rows, total: count, page: Number(page), limit: Number(limit) });
  } catch (error) {
    console.error('Error listando gastos:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/expenses — crear gasto
// ─────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const tenantId = req.tenantId || 1;
    const { categoryId, description, amount, expenseDate, paidTo, notes } = req.body;

    if (!description || !description.trim()) {
      return res.status(400).json({ error: 'La descripción es requerida' });
    }
    if (!amount || isNaN(amount) || Number(amount) <= 0) {
      return res.status(400).json({ error: 'El monto debe ser mayor a 0' });
    }
    if (!expenseDate) {
      return res.status(400).json({ error: 'La fecha es requerida' });
    }

    const expense = await Expense.create({
      tenantId,
      categoryId: categoryId ? Number(categoryId) : null,
      description: description.trim(),
      amount:      Number(amount),
      expenseDate,
      paidTo:      paidTo ? paidTo.trim() : null,
      notes:       notes  ? notes.trim()  : null,
      createdBy:   req.userId || null
    });

    // Recargar con categoría
    const full = await Expense.findByPk(expense.id, {
      include: [{ model: ExpenseCategory, as: 'category', attributes: ['id', 'name'] }]
    });

    res.status(201).json({ expense: full });
  } catch (error) {
    console.error('Error creando gasto:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─────────────────────────────────────────────────────────────
// PUT /api/expenses/:id — editar gasto
// ─────────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const tenantId = req.tenantId || 1;
    const expense  = await Expense.findOne({ where: { id: req.params.id, tenantId } });

    if (!expense) {
      return res.status(404).json({ error: 'Gasto no encontrado' });
    }

    const { categoryId, description, amount, expenseDate, paidTo, notes } = req.body;

    if (description !== undefined && !description.trim()) {
      return res.status(400).json({ error: 'La descripción no puede estar vacía' });
    }
    if (amount !== undefined && (isNaN(amount) || Number(amount) <= 0)) {
      return res.status(400).json({ error: 'El monto debe ser mayor a 0' });
    }

    const updates = {};
    if (categoryId  !== undefined) updates.categoryId  = categoryId ? Number(categoryId) : null;
    if (description !== undefined) updates.description = description.trim();
    if (amount      !== undefined) updates.amount      = Number(amount);
    if (expenseDate !== undefined) updates.expenseDate = expenseDate;
    if (paidTo      !== undefined) updates.paidTo      = paidTo ? paidTo.trim() : null;
    if (notes       !== undefined) updates.notes       = notes  ? notes.trim()  : null;

    await expense.update(updates);

    const full = await Expense.findByPk(expense.id, {
      include: [{ model: ExpenseCategory, as: 'category', attributes: ['id', 'name'] }]
    });

    res.json({ expense: full });
  } catch (error) {
    console.error('Error actualizando gasto:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─────────────────────────────────────────────────────────────
// DELETE /api/expenses/:id — eliminar gasto
// ─────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const tenantId = req.tenantId || 1;
    const expense  = await Expense.findOne({ where: { id: req.params.id, tenantId } });

    if (!expense) {
      return res.status(404).json({ error: 'Gasto no encontrado' });
    }

    await expense.destroy();
    res.json({ message: 'Gasto eliminado correctamente' });
  } catch (error) {
    console.error('Error eliminando gasto:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
