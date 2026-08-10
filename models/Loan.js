const { DataTypes } = require('sequelize');

module.exports = (sequelize) =>
  sequelize.define('Loan', {
    id:         { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    tenantId:   { type: DataTypes.BIGINT, allowNull: false, defaultValue: 1, field: 'tenant_id' },
    // Nombre libre de la persona. Si además es cliente del sistema, customerId lo enlaza.
    personName: { type: DataTypes.STRING(150), allowNull: false, field: 'person_name' },
    customerId: { type: DataTypes.BIGINT, allowNull: true, field: 'customer_id' },
    // LENT = nosotros prestamos (nos deben) · BORROWED = nos prestaron (debemos)
    direction:  { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'LENT' },
    amount:     { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    balance:    { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    loanDate:   { type: DataTypes.DATEONLY, allowNull: false, field: 'loan_date' },
    // Método con el que se entregó/recibió el dinero del préstamo
    paymentMethod:       { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'CASH', field: 'payment_method' },
    transferAccountInfo: { type: DataTypes.STRING(255), allowNull: true, field: 'transfer_account_info' },
    status:     { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'ACTIVE' }, // ACTIVE | PAID | VOIDED
    notes:      { type: DataTypes.TEXT, allowNull: true },
    createdBy:  { type: DataTypes.BIGINT, allowNull: true, field: 'created_by' },
    createdAt:  { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' }
  }, { tableName: 'loans', timestamps: false });
