const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const PushSubscription = sequelize.define('PushSubscription', {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true
    },
    userId: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: 'user_id'
    },
    tenantId: {
      type: DataTypes.BIGINT,
      allowNull: false,
      defaultValue: 1,
      field: 'tenant_id'
    },
    endpoint: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    p256dh: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    auth: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    userAgent: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'user_agent'
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: 'created_at'
    }
  }, {
    tableName: 'push_subscriptions',
    timestamps: false,
    indexes: [
      { fields: ['user_id'] },
      { fields: ['tenant_id'] },
      { unique: true, fields: ['user_id', 'endpoint'] }
    ]
  });

  PushSubscription.associate = (models) => {
    PushSubscription.belongsTo(models.User, {
      foreignKey: 'userId',
      as: 'user'
    });
  };

  return PushSubscription;
};
