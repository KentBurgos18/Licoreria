const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Sale = sequelize.define('Sale', {
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
      allowNull: true,
      field: 'customer_id'
    },
    status: {
      type: DataTypes.ENUM('PENDING', 'COMPLETED', 'VOIDED'),
      allowNull: false,
      defaultValue: 'PENDING'
    },
    totalAmount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      field: 'total_amount'
    },
    taxRate: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true,
      field: 'tax_rate'
    },
    taxAmount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
      field: 'tax_amount'
    },
    paymentMethod: {
      type: DataTypes.ENUM('CASH', 'CARD', 'TRANSFER', 'CREDIT'),
      allowNull: false,
      field: 'payment_method'
    },
    transferReference: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: 'transfer_reference'
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    voidReason: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'void_reason'
    },
    voidedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'voided_at'
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: 'created_at'
    }
  }, {
    tableName: 'sales',
    timestamps: false,
    indexes: [
      { fields: ['tenant_id'] },
      { fields: ['customer_id'] },
      { fields: ['status'] },
      { fields: ['created_at'] }
    ]
  });

  Sale.associate = (models) => {
    Sale.hasMany(models.SaleItem, {
      foreignKey: 'saleId',
      as: 'items'
    });

    Sale.belongsTo(models.Customer, {
      foreignKey: 'customerId',
      as: 'customer'
    });

    Sale.hasOne(models.GroupPurchase, {
      foreignKey: 'saleId',
      as: 'groupPurchase'
    });

    Sale.hasMany(models.Notification, {
      foreignKey: 'saleId',
      as: 'notifications'
    });
  };

  return Sale;
};