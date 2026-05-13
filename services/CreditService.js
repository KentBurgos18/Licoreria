const { CustomerCredit, Sale } = require('../models');
const { Op } = require('sequelize');
const GroupPurchaseService = require('./GroupPurchaseService');

class CreditService {
  /**
   * Returns 'YYYY-MM-DD' in the server's local timezone (avoids UTC-parse bugs).
   * toLocaleDateString('en-CA') produces YYYY-MM-DD in local time.
   */
  static localDateStr(date = new Date()) {
    return new Date(date).toLocaleDateString('en-CA');
  }

  /**
   * Calculate interest for a credit
   * @param {Object} credit - Credit object
   * @param {Date} asOfDate - Date to calculate interest as of (defaults to today)
   */
  static calculateInterest(credit, asOfDate = new Date()) {
    if (credit.status !== 'ACTIVE' || credit.interestRate <= 0) {
      return 0;
    }

    const startStr = credit.lastInterestCalculationDate
      ? credit.lastInterestCalculationDate
      : this.localDateStr(credit.createdAt);

    const asOfStr = this.localDateStr(asOfDate);

    const startMs = new Date(startStr + 'T00:00:00Z').getTime();
    const asOfMs  = new Date(asOfStr  + 'T00:00:00Z').getTime();

    const totalDays = Math.floor((asOfMs - startMs) / (1000 * 60 * 60 * 24));
    if (totalDays <= 0) return 0;

    const normalRate  = parseFloat(credit.interestRate);
    const overdueRate = parseFloat(credit.overdueInterestRate || 0);

    const originalBalance = parseFloat(credit.currentBalance || credit.initialAmount);
    let balance = originalBalance;

    // Fórmula compuesta directa: evita truncamiento acumulado por Math.floor por día
    if (credit.dueDate && overdueRate > 0) {
      const dueDateMs = new Date(credit.dueDate + 'T00:00:00Z').getTime();

      const daysNormal = Math.max(0, Math.min(
        Math.floor((dueDateMs - startMs) / (1000 * 60 * 60 * 24)),
        totalDays
      ));
      const daysOverdue = totalDays - daysNormal;

      // Tramo 1: tasa normal
      if (daysNormal > 0) balance = balance * Math.pow(1 + normalRate, daysNormal);
      // Tramo 2: tasa normal + mora
      if (daysOverdue > 0) balance = balance * Math.pow(1 + normalRate + overdueRate, daysOverdue);
    } else {
      balance = balance * Math.pow(1 + normalRate, totalDays);
    }

    return Math.max(0, balance - originalBalance);
  }

  /**
   * Update credit balance with interest
   */
  static async updateCreditBalance(creditId, asOfDate = new Date(), transaction = null) {
    const credit = await CustomerCredit.findByPk(creditId, { transaction });

    if (!credit || credit.status !== 'ACTIVE') {
      return credit;
    }

    // Compare as local-timezone date strings to avoid UTC-offset day-boundary bugs
    const asOfStr = this.localDateStr(asOfDate);
    const lastStr = credit.lastInterestCalculationDate
      || this.localDateStr(credit.createdAt);

    // Only recalculate if today (local) is strictly after the last calculation date
    if (asOfStr <= lastStr) {
      return credit;
    }

    // Calculate new interest for this period
    const newInterest = this.calculateInterest(credit, asOfDate);

    // Guardar con 4 decimales de precisión para evitar truncamiento acumulado
    const newBalance = parseFloat(credit.currentBalance) + newInterest;
    credit.currentBalance = Math.round(newBalance * 10000) / 10000;
    credit.lastInterestCalculationDate = asOfStr;

    // No due-date based overdue logic — interest accumulates from day 1

    await credit.save({ transaction });

    return credit;
  }

  /**
   * Apply payment to credit
   */
  static async applyPayment(creditId, paymentAmount, transaction = null) {
    const credit = await CustomerCredit.findByPk(creditId, {
      include: [{ association: 'groupPurchaseParticipant' }],
      transaction
    });

    if (!credit || credit.status !== 'ACTIVE') {
      throw new Error('Credit not found or not active');
    }

    let amount = parseFloat(paymentAmount);
    const currentBalance = parseFloat(credit.currentBalance);

    // Tolerar pequeñas diferencias por redondeo entre el monto preparado y el
    // saldo actual (variaciones de centésimas por recálculo de intereses).
    if (amount > currentBalance) {
      if (amount - currentBalance <= 0.01) {
        amount = currentBalance; // capar al saldo
      } else {
        throw new Error(`Payment amount (${amount}) exceeds current balance (${currentBalance})`);
      }
    }

    // Update credit balance
    credit.currentBalance = currentBalance - amount;

    if (credit.currentBalance <= 0.01) {
      credit.currentBalance = 0;
      credit.status = 'PAID';
      credit.paidAt = new Date();

      // Marcar la venta asociada como COMPLETED (el dinero fue recibido)
      if (credit.saleId) {
        await Sale.update(
          { status: 'COMPLETED' },
          { where: { id: credit.saleId, status: 'PENDING' }, transaction }
        );
      }

      // Update participant status
      if (credit.groupPurchaseParticipant) {
        const participant = credit.groupPurchaseParticipant;
        participant.amountPaid = parseFloat(participant.amountPaid) + amount;
        participant.status = 'PAID';
        participant.paidAt = new Date();
        await participant.save({ transaction });
      }
    } else {
      // Update participant amount paid
      if (credit.groupPurchaseParticipant) {
        const participant = credit.groupPurchaseParticipant;
        participant.amountPaid = parseFloat(participant.amountPaid) + amount;
        
        if (participant.amountPaid >= participant.amountDue) {
          participant.status = 'PAID';
          participant.paidAt = new Date();
        } else {
          participant.status = 'PARTIAL';
        }
        
        await participant.save({ transaction });
      }
    }

    await credit.save({ transaction });

    // Actualizar estado de la compra grupal si el crédito pertenece a una
    if (credit.groupPurchaseParticipant && credit.groupPurchaseParticipant.groupPurchaseId) {
      await GroupPurchaseService.updateGroupPurchaseStatus(
        credit.groupPurchaseParticipant.groupPurchaseId,
        transaction
      );
    }

    return credit;
  }

  /**
   * Check and mark overdue credits
   */
  static async checkOverdueCredits(tenantId, asOfDate = new Date(), transaction = null) {
    const credits = await CustomerCredit.findAll({
      where: {
        tenantId,
        status: 'ACTIVE',
        dueDate: { [Op.not]: null, [Op.lt]: asOfDate },
        currentBalance: { [Op.gt]: 0 }
      },
      include: [{ association: 'groupPurchaseParticipant' }],
      transaction
    });

    for (const credit of credits) {
      await this.updateCreditBalance(credit.id, asOfDate, transaction);

      // Update participant status
      if (credit.groupPurchaseParticipant && credit.groupPurchaseParticipant.status !== 'PAID') {
        await credit.groupPurchaseParticipant.update(
          { status: 'OVERDUE' },
          { transaction }
        );
      }
    }

    return credits.length;
  }

  /**
   * Get credit summary for a customer
   */
  static async getCustomerCreditSummary(tenantId, customerId, includeInterest = true) {
    const credits = await CustomerCredit.findAll({
      where: {
        tenantId,
        customerId,
        status: 'ACTIVE'
      },
      include: [{ association: 'groupPurchaseParticipant' }]
    });

    // Actualizar intereses en paralelo (cada uno es independiente)
    if (includeInterest && credits.length > 0) {
      await Promise.all(credits.map(c => this.updateCreditBalance(c.id)));
      // Recargar balances actualizados
      await Promise.all(credits.map(c => c.reload()));
    }

    let totalBalance = 0;
    let totalInterest = 0;

    for (const credit of credits) {
      totalBalance += parseFloat(credit.currentBalance || 0);
      totalInterest += parseFloat(credit.interestAmount || 0);
    }

    return {
      activeCredits: credits.length,
      totalBalance,
      totalInterest,
      principal: totalBalance - totalInterest
    };
  }
}

module.exports = CreditService;
