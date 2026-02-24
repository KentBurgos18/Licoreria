const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const PurchaseOrder = sequelize.define('PurchaseOrder', {
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
    supplierId: {
      type: DataTypes.BIGINT,
      allowNull: true,
      field: 'supplier_id'
    },
    invoiceNumber: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: 'invoice_number'
    },
    purchaseDate: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      field: 'purchase_date'
    },
    totalAmount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
      field: 'total_amount'
    },
    creditDays: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: 'credit_days'
    },
    dueDate: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      field: 'due_date'
    },
    amountPaid: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
      field: 'amount_paid'
    },
    status: {
      type: DataTypes.ENUM('PAID', 'PENDING', 'PARTIAL', 'OVERDUE'),
      allowNull: false,
      defaultValue: 'PAID'
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    lastNotifiedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'last_notified_at'
    },
    paidAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'paid_at'
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: 'created_at'
    }
  }, {
    tableName: 'purchase_orders',
    timestamps: false,
    indexes: [
      { fields: ['tenant_id'] },
      { fields: ['supplier_id'] },
      { fields: ['status'] },
      { fields: ['due_date'] }
    ]
  });

  PurchaseOrder.associate = (models) => {
    PurchaseOrder.belongsTo(models.Supplier, {
      foreignKey: 'supplierId',
      as: 'supplier'
    });

    PurchaseOrder.hasMany(models.InventoryMovement, {
      foreignKey: 'purchaseOrderId',
      as: 'movements'
    });

    PurchaseOrder.hasMany(models.PurchaseOrderItem, {
      foreignKey: 'purchaseOrderId',
      as: 'items'
    });
  };

  return PurchaseOrder;
};
