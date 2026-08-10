const express = require('express');
const { Op } = require('sequelize');
const router = express.Router();

const { sequelize, Loan, LoanPayment, Customer } = require('../models');
const AuditService = require('../services/AuditService');

// Préstamos = información financiera del dueño → solo ADMIN.
router.use((req, res, next) => {
  if ((req.userRole || '').toUpperCase() !== 'ADMIN') {
    return res.status(403).json({ error: 'Solo un administrador puede gestionar préstamos', code: 'FORBIDDEN' });
  }
  next();
});

const DIRECTIONS = ['LENT', 'BORROWED'];
const METHODS    = ['CASH', 'TRANSFER', 'CARD'];

function parseMoney(v) {
  const n = parseFloat(v);
  return isNaN(n) ? null : Math.round(n * 100) / 100;
}

// Recalcula saldo y estado desde los abonos (fuente de verdad = suma de abonos).
async function recalcLoan(loanId, transaction) {
  const loan = await Loan.findByPk(loanId, { transaction });
  if (!loan) return null;
  const paid = await LoanPayment.sum('amount', { where: { loanId }, transaction }) || 0;
  const amount  = parseFloat(loan.amount);
  const balance = Math.max(0, Math.round((amount - parseFloat(paid)) * 100) / 100);
  const status  = loan.status === 'VOIDED' ? 'VOIDED' : (balance <= 0.001 ? 'PAID' : 'ACTIVE');
  await loan.update({ balance, status }, { transaction });
  return loan;
}

// ─────────────────────────────────────────────────────────────
// GET /api/loans — lista + resumen (me deben / yo debo)
// Filtros: direction, status, q (nombre)
// ─────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const tenantId = req.tenantId || 1;
    const { direction, status, q } = req.query;

    const where = { tenantId };
    if (direction && DIRECTIONS.includes(direction)) where.direction = direction;
    if (status) where.status = status;
    else where.status = { [Op.ne]: 'VOIDED' }; // por defecto ocultar anulados
    if (q && q.trim()) where.personName = { [Op.iLike]: `%${q.trim()}%` };

    const loans = await Loan.findAll({ where, order: [['loan_date', 'DESC'], ['id', 'DESC']] });

    // Resumen global (solo activos, no anulados)
    const [rows] = await sequelize.query(`
      SELECT direction, SUM(balance) AS pendiente, COUNT(*) AS n
      FROM loans
      WHERE tenant_id = :tenantId AND status = 'ACTIVE'
      GROUP BY direction
    `, { replacements: { tenantId } });

    const summary = { lentPending: 0, borrowedPending: 0, lentCount: 0, borrowedCount: 0 };
    for (const r of rows) {
      if (r.direction === 'LENT') {
        summary.lentPending = parseFloat(r.pendiente) || 0;
        summary.lentCount   = parseInt(r.n, 10) || 0;
      } else if (r.direction === 'BORROWED') {
        summary.borrowedPending = parseFloat(r.pendiente) || 0;
        summary.borrowedCount   = parseInt(r.n, 10) || 0;
      }
    }

    res.json({ loans, summary });
  } catch (error) {
    console.error('Error listando préstamos:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/loans/people — nombres ya usados (autocompletar)
// ─────────────────────────────────────────────────────────────
router.get('/people', async (req, res) => {
  try {
    const tenantId = req.tenantId || 1;
    const [rows] = await sequelize.query(`
      SELECT person_name AS name, MAX(created_at) AS last_used
      FROM loans WHERE tenant_id = :tenantId
      GROUP BY person_name ORDER BY last_used DESC LIMIT 50
    `, { replacements: { tenantId } });
    res.json({ people: rows.map(r => r.name) });
  } catch (error) {
    console.error('Error listando personas de préstamos:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/loans/:id — detalle + abonos
// ─────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const tenantId = req.tenantId || 1;
    const loan = await Loan.findOne({ where: { id: req.params.id, tenantId } });
    if (!loan) return res.status(404).json({ error: 'Préstamo no encontrado' });

    const payments = await LoanPayment.findAll({
      where: { loanId: loan.id },
      order: [['payment_date', 'ASC'], ['id', 'ASC']]
    });

    let customer = null;
    if (loan.customerId) {
      customer = await Customer.findByPk(loan.customerId, { attributes: ['id', 'name', 'phone'] });
    }

    res.json({ loan, payments, customer });
  } catch (error) {
    console.error('Error obteniendo préstamo:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/loans — crear préstamo
// ─────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const tenantId = req.tenantId || 1;
    const { personName, customerId, direction, amount, loanDate, paymentMethod, transferAccountInfo, notes } = req.body || {};

    if (!personName || !String(personName).trim()) {
      return res.status(400).json({ error: 'El nombre de la persona es requerido' });
    }
    if (!DIRECTIONS.includes(direction)) {
      return res.status(400).json({ error: 'Debe indicar si usted presta o le prestan' });
    }
    const amt = parseMoney(amount);
    if (amt === null || amt <= 0) {
      return res.status(400).json({ error: 'El monto debe ser un número mayor a 0' });
    }
    const method = METHODS.includes(paymentMethod) ? paymentMethod : 'CASH';
    if (method === 'TRANSFER' && !(transferAccountInfo || '').trim()) {
      return res.status(400).json({ error: 'Debe seleccionar la cuenta bancaria para transferencias' });
    }
    if (!loanDate) {
      return res.status(400).json({ error: 'La fecha es requerida' });
    }

    const loan = await Loan.create({
      tenantId,
      personName: String(personName).trim(),
      customerId: customerId || null,
      direction,
      amount: amt,
      balance: amt,
      loanDate,
      paymentMethod: method,
      transferAccountInfo: method === 'TRANSFER' ? transferAccountInfo.trim() : null,
      status: 'ACTIVE',
      notes: notes || null,
      createdBy: req.userId || null
    });

    AuditService.log({
      ...AuditService.fromReq(req),
      action: 'CREATE', entity: 'loan', entityId: loan.id,
      description: `Registró préstamo (${direction === 'LENT' ? 'prestado a' : 'recibido de'} "${loan.personName}") por $${amt.toFixed(2)}`,
      metadata: { created: { personName: loan.personName, direction, amount: amt, paymentMethod: method } }
    });

    res.status(201).json({ loan });
  } catch (error) {
    console.error('Error creando préstamo:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/loans/:id/payments — registrar abono
// ─────────────────────────────────────────────────────────────
router.post('/:id/payments', async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const tenantId = req.tenantId || 1;
    const { amount, paymentDate, paymentMethod, transferAccountInfo, notes } = req.body || {};

    const loan = await Loan.findOne({ where: { id: req.params.id, tenantId }, transaction });
    if (!loan) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Préstamo no encontrado' });
    }
    if (loan.status === 'VOIDED') {
      await transaction.rollback();
      return res.status(400).json({ error: 'El préstamo está anulado' });
    }

    const amt = parseMoney(amount);
    if (amt === null || amt <= 0) {
      await transaction.rollback();
      return res.status(400).json({ error: 'El monto del abono debe ser mayor a 0' });
    }
    // Tolerancia de 1 centavo por redondeos; nunca abonar más que el saldo.
    const balance = parseFloat(loan.balance);
    if (amt - balance > 0.01) {
      await transaction.rollback();
      return res.status(400).json({ error: `El abono ($${amt.toFixed(2)}) supera el saldo pendiente ($${balance.toFixed(2)})` });
    }
    const method = METHODS.includes(paymentMethod) ? paymentMethod : 'CASH';
    if (method === 'TRANSFER' && !(transferAccountInfo || '').trim()) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Debe seleccionar la cuenta bancaria para transferencias' });
    }
    if (!paymentDate) {
      await transaction.rollback();
      return res.status(400).json({ error: 'La fecha del abono es requerida' });
    }

    const payment = await LoanPayment.create({
      tenantId,
      loanId: loan.id,
      amount: Math.min(amt, balance), // capa al saldo si venía 1 centavo arriba
      paymentDate,
      paymentMethod: method,
      transferAccountInfo: method === 'TRANSFER' ? transferAccountInfo.trim() : null,
      notes: notes || null,
      createdBy: req.userId || null
    }, { transaction });

    await recalcLoan(loan.id, transaction);
    await transaction.commit();

    const updated = await Loan.findByPk(loan.id);
    res.status(201).json({ payment, loan: updated });
  } catch (error) {
    await transaction.rollback();
    console.error('Error registrando abono de préstamo:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─────────────────────────────────────────────────────────────
// DELETE /api/loans/:id/payments/:paymentId — borrar abono (reversa saldo)
// ─────────────────────────────────────────────────────────────
router.delete('/:id/payments/:paymentId', async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const tenantId = req.tenantId || 1;
    const payment = await LoanPayment.findOne({
      where: { id: req.params.paymentId, loanId: req.params.id, tenantId }, transaction
    });
    if (!payment) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Abono no encontrado' });
    }
    await payment.destroy({ transaction });
    await recalcLoan(req.params.id, transaction);
    await transaction.commit();

    const updated = await Loan.findByPk(req.params.id);
    res.json({ success: true, loan: updated });
  } catch (error) {
    await transaction.rollback();
    console.error('Error borrando abono de préstamo:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─────────────────────────────────────────────────────────────
// PUT /api/loans/:id — editar datos (no toca abonos)
// ─────────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const tenantId = req.tenantId || 1;
    const loan = await Loan.findOne({ where: { id: req.params.id, tenantId } });
    if (!loan) return res.status(404).json({ error: 'Préstamo no encontrado' });

    const before = loan.toJSON();
    const { personName, customerId, amount, loanDate, paymentMethod, transferAccountInfo, notes } = req.body || {};
    const patch = {};

    if (personName !== undefined) {
      if (!String(personName).trim()) return res.status(400).json({ error: 'El nombre no puede estar vacío' });
      patch.personName = String(personName).trim();
    }
    if (customerId !== undefined) patch.customerId = customerId || null;
    if (loanDate !== undefined && loanDate) patch.loanDate = loanDate;
    if (notes !== undefined) patch.notes = notes || null;

    if (paymentMethod !== undefined) {
      const method = METHODS.includes(paymentMethod) ? paymentMethod : 'CASH';
      if (method === 'TRANSFER' && !(transferAccountInfo || '').trim()) {
        return res.status(400).json({ error: 'Debe seleccionar la cuenta bancaria para transferencias' });
      }
      patch.paymentMethod = method;
      patch.transferAccountInfo = method === 'TRANSFER' ? transferAccountInfo.trim() : null;
    }

    if (amount !== undefined) {
      const amt = parseMoney(amount);
      if (amt === null || amt <= 0) return res.status(400).json({ error: 'El monto debe ser mayor a 0' });
      const paid = await LoanPayment.sum('amount', { where: { loanId: loan.id } }) || 0;
      if (amt < parseFloat(paid) - 0.01) {
        return res.status(400).json({ error: `El monto no puede ser menor a lo ya abonado ($${parseFloat(paid).toFixed(2)})` });
      }
      patch.amount = amt;
    }

    await loan.update(patch);
    await recalcLoan(loan.id);

    AuditService.log({
      ...AuditService.fromReq(req),
      action: 'UPDATE', entity: 'loan', entityId: loan.id,
      description: `Editó préstamo de "${loan.personName}"`,
      metadata: { before, after: patch }
    });

    res.json({ loan: await Loan.findByPk(loan.id) });
  } catch (error) {
    console.error('Error editando préstamo:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/loans/:id/void — anular (sale de tesorería y de los totales)
// ─────────────────────────────────────────────────────────────
router.post('/:id/void', async (req, res) => {
  try {
    const tenantId = req.tenantId || 1;
    const loan = await Loan.findOne({ where: { id: req.params.id, tenantId } });
    if (!loan) return res.status(404).json({ error: 'Préstamo no encontrado' });
    if (loan.status === 'VOIDED') return res.status(400).json({ error: 'El préstamo ya está anulado' });

    const before = loan.toJSON();
    await loan.update({ status: 'VOIDED' });

    AuditService.log({
      ...AuditService.fromReq(req),
      action: 'VOID', entity: 'loan', entityId: loan.id,
      description: `Anuló préstamo de "${loan.personName}" por $${parseFloat(before.amount).toFixed(2)}`,
      metadata: { before }
    });

    res.json({ success: true, loan });
  } catch (error) {
    console.error('Error anulando préstamo:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─────────────────────────────────────────────────────────────
// DELETE /api/loans/:id — eliminar préstamo y sus abonos
// ─────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const tenantId = req.tenantId || 1;
    const loan = await Loan.findOne({ where: { id: req.params.id, tenantId }, transaction });
    if (!loan) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Préstamo no encontrado' });
    }
    const before = loan.toJSON();
    await LoanPayment.destroy({ where: { loanId: loan.id }, transaction });
    await loan.destroy({ transaction });
    await transaction.commit();

    AuditService.log({
      ...AuditService.fromReq(req),
      action: 'DELETE', entity: 'loan', entityId: before.id,
      description: `Eliminó préstamo de "${before.person_name || before.personName}" por $${parseFloat(before.amount).toFixed(2)}`,
      metadata: { deleted: before }
    });

    res.json({ success: true });
  } catch (error) {
    await transaction.rollback();
    console.error('Error eliminando préstamo:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
