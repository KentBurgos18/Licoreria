const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const GroupPurchaseParticipant = sequelize.define('GroupPurchaseParticipant', {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true
    },
    groupPurchaseId: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: 'group_purchase_id'
    },
    customerId: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: 'customer_id'
    },
    amountDue: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      field: 'amount_due'
    },
    amountPaid: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
      field: 'amount_paid'
    },
    status: {
      type: DataTypes.ENUM('PENDING', 'PARTIAL', 'PAID', 'OVERDUE'),
      allowNull: false,
      defaultValue: 'PENDING'
    },
    dueDate: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      field: 'due_date'
    },
    interestRate: {
      type: DataTypes.DECIMAL(5, 4),
      allowNull: false,
      defaultValue: 0,
      field: 'interest_rate'
    },
    interestAmount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
      field: 'interest_amount'
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: 'created_at'
    },
    paymentMethod: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'CREDIT',
      field: 'payment_method'
    },
    paidAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'paid_at'
    }
  }, {
    tableName: 'group_purchase_participants',
    timestamps: false,
    indexes: [
      { fields: ['group_purchase_id'] },
      { fields: ['customer_id'] },
      { fields: ['status'] },
      { fields: ['due_date'] }
    ]
  });

  GroupPurchaseParticipant.associate = (models) => {
    GroupPurchaseParticipant.belongsTo(models.GroupPurchase, {
      foreignKey: 'groupPurchaseId',
      as: 'groupPurchase'
    });

    GroupPurchaseParticipant.belongsTo(models.Customer, {
      foreignKey: 'customerId',
      as: 'customer'
    });

    GroupPurchaseParticipant.hasMany(models.CustomerPayment, {
      foreignKey: 'groupPurchaseParticipantId',
      as: 'payments'
    });

    GroupPurchaseParticipant.hasOne(models.CustomerCredit, {
      foreignKey: 'groupPurchaseParticipantId',
      as: 'credit'
    });
  };

  return GroupPurchaseParticipant;
};
