const { CustomerPayment, GroupPurchaseParticipant, CustomerCredit, GroupPurchase } = require('../models');
const CreditService = require('./CreditService');
const { sequelize } = require('../models');

class PaymentService {
  /**
   * Process a payment
   * @param {Object} data - Payment data
   * @param {number} data.tenantId
   * @param {number} data.customerId
   * @param {number} data.amount
   * @param {string} data.paymentMethod
   * @param {Date} data.paymentDate
   * @param {number} data.groupPurchaseParticipantId - Optional
   * @param {string} data.notes
   * @param {Object} transaction
   */
  static async processPayment(data, transaction = null) {
    const {
      tenantId,
      customerId,
      amount,
      paymentMethod,
      paymentDate = new Date(),
      groupPurchaseParticipantId,
      creditId,
      notes,
      transferAccountInfo
    } = data;

    const useTransaction = transaction || await sequelize.transaction();
    const shouldCommit = !transaction;

    try {
      // Create payment record
      const payment = await CustomerPayment.create({
        tenantId,
        customerId,
        groupPurchaseParticipantId,
        amount,
        paymentMethod,
        paymentDate: paymentDate instanceof Date ? paymentDate.toISOString().split('T')[0] : paymentDate,
        notes,
        transferAccountInfo: transferAccountInfo || null
      }, { transaction: useTransaction });

      // Apply payment to credit balance
      if (groupPurchaseParticipantId) {
        await this.applyToCredit(groupPurchaseParticipantId, amount, useTransaction);
      } else if (creditId) {
        await CreditService.applyPayment(parseInt(creditId), parseFloat(amount), useTransaction);
      }

      if (shouldCommit) {
        await useTransaction.commit();
      }

      return await CustomerPayment.findByPk(payment.id, {
        include: [
          { association: 'customer' },
          { association: 'groupPurchaseParticipant', include: [{ association: 'groupPurchase' }] }
        ]
      });
    } catch (error) {
      if (shouldCommit) {
        await useTransaction.rollback();
      }
      throw error;
    }
  }

  /**
   * Apply payment to a group purchase participant's credit
   */
  static async applyToCredit(groupPurchaseParticipantId, amount, transaction = null) {
    const participant = await GroupPurchaseParticipant.findByPk(groupPurchaseParticipantId, {
      include: [
        { association: 'credit' },
        { association: 'groupPurchase' }
      ],
      transaction
    });

    if (!participant) {
      throw new Error('Group purchase participant not found');
    }

    const paymentAmount = parseFloat(amount);
    const remainingDue = parseFloat(participant.amountDue) - parseFloat(participant.amountPaid);

    // Permitir pagar hasta remainingDue + interés acumulado en el crédito
    const creditInterest = (participant.credit && participant.credit.status === 'ACTIVE')
      ? Math.max(0, parseFloat(participant.credit.currentBalance || 0) - parseFloat(participant.credit.initialAmount || 0))
      : 0;
    const maxAllowed = remainingDue + creditInterest;

    if (paymentAmount > maxAllowed + 0.01) {
      throw new Error(`Payment amount (${paymentAmount}) exceeds remaining due (${maxAllowed.toFixed(2)})`);
    }

    // Update participant — solo el monto base (sin interés) cuenta para amountPaid
    const basePayment = Math.min(paymentAmount, remainingDue);
    participant.amountPaid = parseFloat(participant.amountPaid || 0) + basePayment;

    if (participant.amountPaid >= participant.amountDue) {
      participant.status = 'PAID';
      participant.paidAt = new Date();
    } else {
      participant.status = 'PARTIAL';
    }

    await participant.save({ transaction });

    // Apply to credit if exists
    if (participant.credit && participant.credit.status === 'ACTIVE') {
      // Update credit balance first to include current interest
      await CreditService.updateCreditBalance(participant.credit.id, new Date(), transaction);
      
      // Reload credit with updated balance
      await participant.credit.reload({ transaction });

      // Apply payment
      await CreditService.applyPayment(participant.credit.id, paymentAmount, transaction);
    }

    // Update group purchase status
    if (participant.groupPurchase) {
      const GroupPurchaseService = require('./GroupPurchaseService');
      await GroupPurchaseService.updateGroupPurchaseStatus(participant.groupPurchase.id, transaction);
    }

    return participant;
  }

  /**
   * Update participant status based on payments
   */
  static async updateParticipantStatus(participantId, transaction = null) {
    const participant = await GroupPurchaseParticipant.findByPk(participantId, {
      include: [{ association: 'payments' }],
      transaction
    });

    if (!participant) {
      throw new Error('Participant not found');
    }

    const totalPaid = participant.payments.reduce((sum, p) => sum + parseFloat(p.amount), 0);
    participant.amountPaid = totalPaid;

    if (totalPaid >= participant.amountDue) {
      participant.status = 'PAID';
      participant.paidAt = new Date();
    } else if (totalPaid > 0) {
      participant.status = 'PARTIAL';
    } else {
      participant.status = 'PENDING';
    }

    await participant.save({ transaction });

    return participant;
  }
}

module.exports = PaymentService;
