const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const PayphonePendingPayment = sequelize.define('PayphonePendingPayment', {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true
    },
    clientTransactionId: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true,
      field: 'client_transaction_id'
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
    itemsJson: {
      type: DataTypes.JSONB,
      allowNull: false,
      field: 'items_json'
    },
    subtotal: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      field: 'subtotal'
    },
    taxAmount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      field: 'tax_amount'
    },
    totalAmount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      field: 'total_amount'
    },
    taxRate: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: false,
      field: 'tax_rate'
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: 'created_at'
    }
  }, {
    tableName: 'payphone_pending_payments',
    timestamps: false,
    indexes: [
      { fields: ['client_transaction_id'] },
      { fields: ['tenant_id'] },
      { fields: ['created_at'] }
    ]
  });

  PayphonePendingPayment.associate = (models) => {
    PayphonePendingPayment.belongsTo(models.Customer, {
      foreignKey: 'customerId',
      as: 'customer'
    });
  };

  return PayphonePendingPayment;
};
