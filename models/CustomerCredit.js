const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const CustomerCredit = sequelize.define('CustomerCredit', {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true
    },
    tenantId: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: 'tenant_id'
    },
    customerId: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: 'customer_id'
    },
    groupPurchaseParticipantId: {
      type: DataTypes.BIGINT,
      allowNull: true,
      field: 'group_purchase_participant_id'
    },
    initialAmount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      field: 'initial_amount'
    },
    currentBalance: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      field: 'current_balance'
    },
    interestRate: {
      type: DataTypes.DECIMAL(5, 4),
      allowNull: false,
      defaultValue: 0,
      field: 'interest_rate'
    },
    dueDate: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      field: 'due_date'
    },
    status: {
      type: DataTypes.ENUM('ACTIVE', 'PAID', 'CANCELLED'),
      allowNull: false,
      defaultValue: 'ACTIVE'
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: 'created_at'
    },
    paidAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'paid_at'
    },
    lastInterestCalculationDate: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      field: 'last_interest_calculation_date'
    }
  }, {
    tableName: 'customer_credits',
    timestamps: false,
    indexes: [
      { fields: ['tenant_id'] },
      { fields: ['customer_id'] },
      { fields: ['group_purchase_participant_id'] },
      { fields: ['status'] },
      { fields: ['due_date'] },
      { fields: ['tenant_id', 'customer_id', 'status'], where: { status: 'ACTIVE' } }
    ]
  });

  CustomerCredit.associate = (models) => {
    CustomerCredit.belongsTo(models.Customer, {
      foreignKey: 'customerId',
      as: 'customer'
    });

    CustomerCredit.belongsTo(models.GroupPurchaseParticipant, {
      foreignKey: 'groupPurchaseParticipantId',
      as: 'groupPurchaseParticipant'
    });
  };

  return CustomerCredit;
};
