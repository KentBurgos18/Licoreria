const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const GroupPurchase = sequelize.define('GroupPurchase', {
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
    saleId: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: 'sale_id'
    },
    productId: {
      type: DataTypes.BIGINT,
      allowNull: true,
      field: 'product_id'
    },
    quantity: {
      type: DataTypes.DECIMAL(12, 3),
      allowNull: false,
      defaultValue: 1
    },
    totalAmount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      field: 'total_amount'
    },
    status: {
      type: DataTypes.ENUM('PENDING', 'PARTIAL', 'COMPLETED', 'CANCELLED'),
      allowNull: false,
      defaultValue: 'PENDING'
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: 'created_at'
    },
    completedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'completed_at'
    }
  }, {
    tableName: 'group_purchases',
    timestamps: false,
    indexes: [
      { fields: ['tenant_id'] },
      { fields: ['sale_id'] },
      { fields: ['product_id'] },
      { fields: ['status'] }
    ]
  });

  GroupPurchase.associate = (models) => {
    GroupPurchase.belongsTo(models.Sale, {
      foreignKey: 'saleId',
      as: 'sale'
    });

    GroupPurchase.belongsTo(models.Product, {
      foreignKey: 'productId',
      as: 'product'
    });

    GroupPurchase.hasMany(models.GroupPurchaseParticipant, {
      foreignKey: 'groupPurchaseId',
      as: 'participants'
    });
  };

  return GroupPurchase;
};
