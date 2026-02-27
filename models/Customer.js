const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Customer = sequelize.define('Customer', {
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
    firstName: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: 'first_name'
    },
    lastName: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: 'last_name'
    },
    birthDate: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      field: 'birth_date'
    },
    cedula: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: '',
      field: 'cedula'
    },
    email: {
      type: DataTypes.STRING,
      allowNull: true
    },
    password: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'password_hash'
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: true
    },
    address: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: 'is_active'
    },
    emailVerified: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: 'email_verified'
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: 'created_at'
    }
  }, {
    tableName: 'customers',
    timestamps: false,
    defaultScope: {
      attributes: { exclude: ['password'] }
    },
    indexes: [
      { fields: ['tenant_id'] },
      { fields: ['email'] },
      { fields: ['phone'] },
      { fields: ['cedula'] },
      { unique: true, fields: ['tenant_id', 'email'], where: { email: { [require('sequelize').Op.ne]: null } } },
      { unique: true, fields: ['tenant_id', 'cedula'] }
    ]
  });

  Customer.associate = (models) => {
    Customer.hasMany(models.Sale, {
      foreignKey: 'customerId',
      as: 'sales'
    });

    Customer.hasMany(models.GroupPurchaseParticipant, {
      foreignKey: 'customerId',
      as: 'groupPurchaseParticipants'
    });

    Customer.hasMany(models.CustomerPayment, {
      foreignKey: 'customerId',
      as: 'payments'
    });

    Customer.hasMany(models.CustomerCredit, {
      foreignKey: 'customerId',
      as: 'credits'
    });
  };

  return Customer;
};