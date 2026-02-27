const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const User = sequelize.define('User', {
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
      type: DataTypes.STRING(100),
      allowNull: false
    },
    email: {
      type: DataTypes.STRING(150),
      allowNull: false
    },
    password: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    role: {
      type: DataTypes.ENUM('ADMIN', 'MANAGER', 'CASHIER'),
      allowNull: false,
      defaultValue: 'CASHIER'
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: 'is_active'
    },
    themeId: {
      type: DataTypes.SMALLINT,
      allowNull: false,
      defaultValue: 1,
      field: 'theme_id'
    },
    themeMode: {
      type: DataTypes.STRING(10),
      allowNull: false,
      defaultValue: 'auto',
      field: 'theme_mode'
    },
    lastLogin: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'last_login'
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: 'created_at'
    }
  }, {
    tableName: 'users',
    timestamps: false,
    indexes: [
      { fields: ['tenant_id'] },
      { fields: ['email'] },
      { unique: true, fields: ['tenant_id', 'email'] }
    ]
  });

  User.associate = (models) => {
    User.hasMany(models.Notification, {
      foreignKey: 'userId',
      as: 'notifications'
    });
    User.hasMany(models.PushSubscription, {
      foreignKey: 'userId',
      as: 'pushSubscriptions'
    });
  };

  return User;
};
