const { CustomerCredit, GroupPurchaseParticipant } = require('../models');
const { Op } = require('sequelize');

class CreditService {
  /**
   * Calculate interest for a credit
   * @param {Object} credit - Credit object
   * @param {Date} asOfDate - Date to calculate interest as of (defaults to today)
   */
  static calculateInterest(credit, asOfDate = new Date()) {
    if (credit.status !== 'ACTIVE' || credit.interestRate <= 0) {
      return 0;
    }

    // Interest runs from the last calculation date (or creation date) to asOfDate
    const startDate = credit.lastInterestCalculationDate
      ? new Date(credit.lastInterestCalculationDate)
      : new Date(credit.createdAt);

    const calculationDate = new Date(asOfDate);
    calculationDate.setHours(0, 0, 0, 0);
    startDate.setHours(0, 0, 0, 0);

    const daysDiff = Math.floor((calculationDate - startDate) / (1000 * 60 * 60 * 24));
    if (daysDiff <= 0) {
      return 0;
    }

    // Daily interest: principal * daily_rate * days
    const principal = parseFloat(credit.currentBalance || credit.initialAmount);
    const rate = parseFloat(credit.interestRate);

    return Math.max(0, principal * rate * daysDiff);
  }

  /**
   * Update credit balance with interest
   */
  static async updateCreditBalance(creditId, asOfDate = new Date(), transaction = null) {
    const credit = await CustomerCredit.findByPk(creditId, { transaction });

    if (!credit || credit.status !== 'ACTIVE') {
      return credit;
    }

    const lastCalcDate = credit.lastInterestCalculationDate 
      ? new Date(credit.lastInterestCalculationDate) 
      : new Date(credit.createdAt);

    const calcDate = new Date(asOfDate);
    calcDate.setHours(0, 0, 0, 0);
    lastCalcDate.setHours(0, 0, 0, 0);

    // Only recalculate if date has changed
    if (calcDate <= lastCalcDate) {
      return credit;
    }

    // Calculate new interest
    const newInterest = this.calculateInterest(credit, asOfDate);
    
    // Update credit
    credit.interestAmount = parseFloat(credit.interestAmount || 0) + newInterest;
    credit.currentBalance = parseFloat(credit.initialAmount) + credit.interestAmount;
    credit.lastInterestCalculationDate = calcDate.toISOString().split('T')[0];

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
