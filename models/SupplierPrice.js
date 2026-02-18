const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const SupplierPrice = sequelize.define('SupplierPrice', {
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
      allowNull: false,
      field: 'supplier_id'
    },
    productId: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: 'product_id'
    },
    price: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false
    },
    effectiveDate: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      field: 'effective_date'
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
    tableName: 'supplier_prices',
    timestamps: false,
    indexes: [
      { fields: ['tenant_id'] },
      { fields: ['supplier_id'] },
      { fields: ['product_id'] },
      { fields: ['effective_date'] }
    ]
  });

  SupplierPrice.associate = (models) => {
    SupplierPrice.belongsTo(models.Supplier, {
      foreignKey: 'supplierId',
      as: 'supplier'
    });
    SupplierPrice.belongsTo(models.Product, {
      foreignKey: 'productId',
      as: 'product'
    });
  };

  return SupplierPrice;
};
