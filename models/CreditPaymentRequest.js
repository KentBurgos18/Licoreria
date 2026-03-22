const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const CreditPaymentRequest = sequelize.define('CreditPaymentRequest', {
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
    creditId: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: 'credit_id'
    },
    amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false
    },
    paymentMethod: {
      type: DataTypes.STRING(20),
      allowNull: false,
      field: 'payment_method'
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    status: {
      type: DataTypes.ENUM('PENDING', 'APPROVED', 'REJECTED'),
      allowNull: false,
      defaultValue: 'PENDING'
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: 'created_at'
    },
    reviewedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'reviewed_at'
    },
    reviewNotes: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'review_notes'
    }
  }, {
    tableName: 'credit_payment_requests',
    timestamps: false,
    indexes: [
      { fields: ['tenant_id'] },
      { fields: ['customer_id'] },
      { fields: ['credit_id'] },
      { fields: ['status'] }
    ]
  });

  CreditPaymentRequest.associate = (models) => {
    CreditPaymentRequest.belongsTo(models.Customer, {
      foreignKey: 'customerId',
      as: 'customer'
    });
    CreditPaymentRequest.belongsTo(models.CustomerCredit, {
      foreignKey: 'creditId',
      as: 'credit'
    });
  };

  return CreditPaymentRequest;
};
