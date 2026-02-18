const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Notification = sequelize.define('Notification', {
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
    userId: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: 'user_id'
    },
    type: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: 'CASH_CONFIRMATION'
    },
    saleId: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: 'sale_id'
    },
    title: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    body: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    readAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'read_at'
    },
    metadata: {
      type: DataTypes.JSONB,
      allowNull: true
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: 'created_at'
    }
  }, {
    tableName: 'notifications',
    timestamps: false,
    indexes: [
      { fields: ['tenant_id'] },
      { fields: ['user_id'] },
      { fields: ['sale_id'] },
      { fields: ['read_at'] },
      { fields: ['created_at'] }
    ]
  });

  Notification.associate = (models) => {
    Notification.belongsTo(models.User, {
      foreignKey: 'userId',
      as: 'user'
    });
    Notification.belongsTo(models.Sale, {
      foreignKey: 'saleId',
      as: 'sale'
    });
  };

  return Notification;
};
