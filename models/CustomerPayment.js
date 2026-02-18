const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const CustomerPayment = sequelize.define('CustomerPayment', {
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
    customerId: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: 'customer_id'
    },
    groupPurchaseParticipantId: {
      type: DataTypes.BIGINT,
      allowNull: true,
      field: 'group_purchase_participant_id'
    },
    amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false
    },
    paymentMethod: {
      type: DataTypes.ENUM('CASH', 'CARD', 'TRANSFER'),
      allowNull: false,
      field: 'payment_method'
    },
    paymentDate: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: 'payment_date'
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
    tableName: 'customer_payments',
    timestamps: false,
    indexes: [
      { fields: ['tenant_id'] },
      { fields: ['customer_id'] },
      { fields: ['group_purchase_participant_id'] },
      { fields: ['payment_date'] }
    ]
  });

  CustomerPayment.associate = (models) => {
    CustomerPayment.belongsTo(models.Customer, {
      foreignKey: 'customerId',
      as: 'customer'
    });

    CustomerPayment.belongsTo(models.GroupPurchaseParticipant, {
      foreignKey: 'groupPurchaseParticipantId',
      as: 'groupPurchaseParticipant'
    });
  };

  return CustomerPayment;
};
