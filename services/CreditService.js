const { CustomerCredit } = require('../models');
const { Op } = require('sequelize');

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

    let balanceCents = Math.round(parseFloat(credit.currentBalance || credit.initialAmount) * 100);
    const originalCents = balanceCents;

    // Si hay fecha de vencimiento y tasa de mora, dividimos el período en dos tramos
    if (credit.dueDate && overdueRate > 0) {
      const dueDateMs = new Date(credit.dueDate + 'T00:00:00Z').getTime();

      // Días dentro del plazo normal (start → dueDate, si dueDate está dentro del rango)
      const daysNormal = Math.max(0, Math.min(
        Math.floor((dueDateMs - startMs) / (1000 * 60 * 60 * 24)),
        totalDays
      ));
      // Días en mora (dueDate → asOf)
      const daysOverdue = totalDays - daysNormal;

      // Tramo 1: tasa normal
      for (let i = 0; i < daysNormal; i++) {
        balanceCents += Math.floor(balanceCents * normalRate);
      }
      // Tramo 2: tasa normal + mora
      const combinedRate = normalRate + overdueRate;
      for (let i = 0; i < daysOverdue; i++) {
        balanceCents += Math.floor(balanceCents * combinedRate);
      }
    } else {
      // Sin fecha de vencimiento o sin tasa de mora: solo tasa normal
      for (let i = 0; i < totalDays; i++) {
        balanceCents += Math.floor(balanceCents * normalRate);
      }
    }

    return Math.max(0, (balanceCents - originalCents) / 100);
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

    // Sumar en centavos para evitar 22.49+0.22=22.70999... (float) → truncado erróneo a 22.70
    const balanceCents = Math.round(parseFloat(credit.currentBalance) * 100);
    const interestCents = Math.round(newInterest * 100);
    credit.currentBalance = (balanceCents + interestCents) / 100;
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

    const amount = parseFloat(paymentAmount);
    const currentBalance = parseFloat(credit.currentBalance);

    if (amount > currentBalance) {
      throw new Error(`Payment amount (${amount}) exceeds current balance (${currentBalance})`);
    }

    // Update credit balance
    credit.currentBalance = currentBalance - amount;

    if (credit.currentBalance <= 0.01) {
      credit.currentBalance = 0;
      credit.status = 'PAID';
      credit.paidAt = new Date();

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

    let totalBalance = 0;
    let totalInterest = 0;

    for (const credit of credits) {
      if (includeInterest) {
        await this.updateCreditBalance(credit.id);
      }
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
