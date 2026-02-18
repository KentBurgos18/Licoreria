const { GroupPurchase, GroupPurchaseParticipant, Sale, SaleItem, Product, InventoryMovement, CustomerCredit } = require('../models');
const ComboService = require('./ComboService');
const { sequelize } = require('../models');
const { Op } = require('sequelize');

class GroupPurchaseService {
  /**
   * Create a group purchase with participants
   * @param {Object} data - Group purchase data
   * @param {number} data.tenantId
   * @param {number} data.productId
   * @param {number} data.quantity
   * @param {Array} data.participants - Array of {customerId, amountDue, dueDate, interestRate}
   * @param {string} data.paymentMethod
   * @param {string} data.notes
   * @param {Object} transaction
   */
  static async createGroupPurchase(data, transaction = null) {
    const { tenantId, productId, quantity, participants, paymentMethod = 'CASH', notes } = data;

    // Validate participants
    if (!participants || participants.length === 0) {
      throw new Error('At least one participant is required');
    }

    // Get product
    const product = await Product.findOne({
      where: { id: productId, tenantId, isActive: true },
      transaction
    });

    if (!product) {
      throw new Error('Product not found or inactive');
    }

    // Calculate total amount
    const unitPrice = parseFloat(product.salePrice);
    const totalAmount = unitPrice * parseFloat(quantity);

    // Validate participant amounts sum to total
    const participantAmountsSum = participants.reduce((sum, p) => sum + parseFloat(p.amountDue), 0);
    if (Math.abs(participantAmountsSum - totalAmount) > 0.01) {
      throw new Error(`Participant amounts sum (${participantAmountsSum}) must equal total amount (${totalAmount})`);
    }

    // Check stock availability
    if (product.productType === 'SIMPLE') {
      const currentStock = await InventoryMovement.getCurrentStock(tenantId, productId);
      if (currentStock < quantity) {
        throw new Error(`Insufficient stock. Available: ${currentStock}, Required: ${quantity}`);
      }
    } else {
      const availableStock = await ComboService.calculateComboStock(tenantId, productId);
      if (availableStock < quantity) {
        throw new Error(`Insufficient combo stock. Available: ${availableStock}, Required: ${quantity}`);
      }
    }

    // Use transaction if provided, otherwise create new one
    const useTransaction = transaction || await sequelize.transaction();
    const shouldCommit = !transaction;

    try {
      // Create sale
      const sale = await Sale.create({
        tenantId,
        customerId: null, // Group purchase doesn't have a single customer
        status: 'COMPLETED',
        totalAmount,
        paymentMethod,
        notes: notes || `Group purchase - ${participants.length} participants`
      }, { transaction: useTransaction });

      // Create sale item
      await SaleItem.create({
        tenantId,
        saleId: sale.id,
        productId,
        productType: product.productType,
        quantity,
        unitPrice,
        subtotal: totalAmount
      }, { transaction: useTransaction });

      // Create inventory movements (reduce stock)
      if (product.productType === 'SIMPLE') {
        await InventoryMovement.create({
          tenantId,
          productId,
          movementType: 'OUT',
          reason: 'SALE',
          qty: quantity,
          unitCost: await InventoryMovement.getUnitCost(tenantId, productId, quantity, useTransaction),
          refType: 'SALE',
          refId: sale.id
        }, { transaction: useTransaction });
      } else {
        // For combos, create movements for each component
        await ComboService.createComboSaleMovements(
          tenantId,
          productId,
          quantity,
          sale.id,
          useTransaction
        );
      }

      // Create group purchase
      const groupPurchase = await GroupPurchase.create({
        tenantId,
        saleId: sale.id,
        productId,
        quantity,
        totalAmount,
        status: 'PENDING'
      }, { transaction: useTransaction });

      // Create participants and credits
      const createdParticipants = [];
      for (const participantData of participants) {
        const participant = await GroupPurchaseParticipant.create({
          groupPurchaseId: groupPurchase.id,
          customerId: participantData.customerId,
          amountDue: participantData.amountDue,
          amountPaid: 0,
          status: 'PENDING',
          dueDate: participantData.dueDate || null,
          interestRate: participantData.interestRate || 0,
          interestAmount: 0
        }, { transaction: useTransaction });

        // Create credit if not paid immediately
        if (participantData.amountPaid === undefined || participantData.amountPaid < participantData.amountDue) {
          const remainingAmount = participantData.amountDue - (participantData.amountPaid || 0);
          
          await CustomerCredit.create({
            tenantId,
            customerId: participantData.customerId,
            groupPurchaseParticipantId: participant.id,
            initialAmount: remainingAmount,
            currentBalance: remainingAmount,
            interestRate: participantData.interestRate || 0,
            dueDate: participantData.dueDate || null,
            status: 'ACTIVE',
            lastInterestCalculationDate: new Date().toISOString().split('T')[0]
          }, { transaction: useTransaction });
        }

        // Update participant status if partially paid
        if (participantData.amountPaid > 0) {
          participant.amountPaid = participantData.amountPaid;
          participant.status = participantData.amountPaid < participantData.amountDue ? 'PARTIAL' : 'PAID';
          if (participant.status === 'PAID') {
            participant.paidAt = new Date();
          }
          await participant.save({ transaction: useTransaction });
        }

        createdParticipants.push(participant);
      }

      // Update group purchase status
      await this.updateGroupPurchaseStatus(groupPurchase.id, useTransaction);

      if (shouldCommit) {
        await useTransaction.commit();
      }

      // Fetch complete group purchase with associations
      return await GroupPurchase.findByPk(groupPurchase.id, {
        include: [
          { association: 'sale', include: [{ association: 'items' }] },
          { association: 'product' },
          {
            association: 'participants',
            include: [
              { association: 'customer' },
              { association: 'credit' }
            ]
          }
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
   * Update group purchase status based on participants
   */
  static async updateGroupPurchaseStatus(groupPurchaseId, transaction = null) {
    const groupPurchase = await GroupPurchase.findByPk(groupPurchaseId, {
      include: [{ association: 'participants' }],
      transaction
    });

    if (!groupPurchase) {
      throw new Error('Group purchase not found');
    }

    const participants = groupPurchase.participants;
    const allPaid = participants.every(p => p.status === 'PAID');
    const somePaid = participants.some(p => p.status === 'PAID' || p.status === 'PARTIAL');

    let newStatus = 'PENDING';
    if (allPaid) {
      newStatus = 'COMPLETED';
      groupPurchase.completedAt = new Date();
    } else if (somePaid) {
      newStatus = 'PARTIAL';
    }

    groupPurchase.status = newStatus;
    await groupPurchase.save({ transaction });

    return groupPurchase;
  }

  /**
   * Cancel a group purchase and revert inventory
   */
  static async cancelGroupPurchase(groupPurchaseId, reason, transaction = null) {
    const groupPurchase = await GroupPurchase.findByPk(groupPurchaseId, {
      include: [
        { association: 'sale', include: [{ association: 'items' }] },
        { association: 'product' },
        { association: 'participants' }
      ],
      transaction
    });

    if (!groupPurchase) {
      throw new Error('Group purchase not found');
    }

    if (groupPurchase.status === 'CANCELLED') {
      throw new Error('Group purchase is already cancelled');
    }

    const useTransaction = transaction || await sequelize.transaction();
    const shouldCommit = !transaction;

    try {
      // Revert inventory
      const sale = groupPurchase.sale;
      const saleItems = sale.items;

      for (const saleItem of saleItems) {
        if (saleItem.productType === 'SIMPLE') {
          // Reverse OUT movement with IN movement
          await InventoryMovement.create({
            tenantId: groupPurchase.tenantId,
            productId: saleItem.productId,
            movementType: 'IN',
            reason: 'VOID',
            qty: saleItem.quantity,
            unitCost: await InventoryMovement.getUnitCost(
              groupPurchase.tenantId,
              saleItem.productId,
              saleItem.quantity,
              useTransaction
            ),
            refType: 'SALE',
            refId: sale.id
          }, { transaction: useTransaction });
        } else {
          // For combos, reverse component movements
          await ComboService.createComboVoidMovements(
            groupPurchase.tenantId,
            saleItem.productId,
            saleItem.quantity,
            sale.id,
            useTransaction
          );
        }
      }

      // Cancel all credits
      for (const participant of groupPurchase.participants) {
        await CustomerCredit.update(
          { status: 'CANCELLED' },
          {
            where: {
              groupPurchaseParticipantId: participant.id,
              status: 'ACTIVE'
            },
            transaction: useTransaction
          }
        );
      }

      // Update group purchase status
      groupPurchase.status = 'CANCELLED';
      await groupPurchase.save({ transaction: useTransaction });

      // Void the sale
      await sale.update({
        status: 'VOIDED',
        voidReason: reason || 'Group purchase cancelled',
        voidedAt: new Date()
      }, { transaction: useTransaction });

      if (shouldCommit) {
        await useTransaction.commit();
      }

      return groupPurchase;
    } catch (error) {
      if (shouldCommit) {
        await useTransaction.rollback();
      }
      throw error;
    }
  }

  /**
   * Validate participant amounts sum to total
   */
  static validateParticipantAmounts(participants, totalAmount) {
    const sum = participants.reduce((s, p) => s + parseFloat(p.amountDue), 0);
    return Math.abs(sum - totalAmount) < 0.01;
  }
}

module.exports = GroupPurchaseService;
