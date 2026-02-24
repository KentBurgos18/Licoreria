const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Supplier = sequelize.define('Supplier', {
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
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    contactName: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'contact_name'
    },
    email: {
      type: DataTypes.STRING,
      allowNull: true
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: true
    },
    address: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    ruc: {
      type: DataTypes.STRING(20),
      allowNull: true
    },
    supplierCode: {
      type: DataTypes.STRING(30),
      allowNull: true,
      field: 'supplier_code'
    },
    creditDays: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: 'credit_days'
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: 'is_active'
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: 'created_at'
    }
  }, {
    tableName: 'suppliers',
    timestamps: false,
    indexes: [
      { fields: ['tenant_id'] },
      { fields: ['is_active'] }
    ]
  });

  Supplier.associate = (models) => {
    Supplier.hasMany(models.SupplierPrice, {
      foreignKey: 'supplierId',
      as: 'prices'
    });

    Supplier.hasMany(models.PurchaseOrder, {
      foreignKey: 'supplierId',
      as: 'purchaseOrders'
    });
  };

  return Supplier;
};
