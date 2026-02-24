const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ProductPresentation = sequelize.define('ProductPresentation', {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true
    },
    tenantId: {
      type: DataTypes.BIGINT,
      allowNull: false,
      defaultValue: 1,
      field: 'tenant_id'
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    unitsPerSale: {
      type: DataTypes.DECIMAL(12, 3),
      allowNull: false,
      defaultValue: 1,
      field: 'units_per_sale'
    },
    sortOrder: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: 'sort_order'
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: 'created_at'
    }
  }, {
    tableName: 'product_presentations',
    timestamps: false,
    indexes: [
      { fields: ['tenant_id'] }
    ]
  });

  return ProductPresentation;
};
