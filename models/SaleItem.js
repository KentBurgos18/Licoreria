const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const SaleItem = sequelize.define('SaleItem', {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true
    },
    saleId: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: 'sale_id'
    },
    tenantId: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: 'tenant_id'
    },
    productId: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: 'product_id'
    },
    quantity: {
      type: DataTypes.DECIMAL(12, 3),
      allowNull: false
    },
    unitPrice: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      field: 'unit_price'
    },
    totalPrice: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      field: 'total_price'
    },
    productType: {
      type: DataTypes.ENUM('SIMPLE', 'COMBO'),
      allowNull: false,
      field: 'product_type'
    }
  }, {
    tableName: 'sale_items',
    timestamps: false,
    indexes: [
      { fields: ['sale_id'] },
      { fields: ['tenant_id'] },
      { fields: ['product_id'] },
      { fields: ['product_type'] }
    ]
  });

  SaleItem.associate = (models) => {
    SaleItem.belongsTo(models.Sale, {
      foreignKey: 'saleId',
      as: 'sale'
    });

    SaleItem.belongsTo(models.Product, {
      foreignKey: 'productId',
      as: 'product'
    });
  };

  return SaleItem;
};