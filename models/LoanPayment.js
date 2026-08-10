const { DataTypes } = require('sequelize');

module.exports = (sequelize) =>
  sequelize.define('LoanPayment', {
    id:         { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    tenantId:   { type: DataTypes.BIGINT, allowNull: false, defaultValue: 1, field: 'tenant_id' },
    loanId:     { type: DataTypes.BIGINT, allowNull: false, field: 'loan_id' },
    amount:     { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    paymentDate:{ type: DataTypes.DATEONLY, allowNull: false, field: 'payment_date' },
    // Método con el que se cobró/pagó el abono (puede diferir del préstamo original)
    paymentMethod:       { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'CASH', field: 'payment_method' },
    transferAccountInfo: { type: DataTypes.STRING(255), allowNull: true, field: 'transfer_account_info' },
    notes:      { type: DataTypes.TEXT, allowNull: true },
    createdBy:  { type: DataTypes.BIGINT, allowNull: true, field: 'created_by' },
    createdAt:  { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' }
  }, { tableName: 'loan_payments', timestamps: false });
