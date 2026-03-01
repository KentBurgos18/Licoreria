const { DataTypes } = require('sequelize');

module.exports = (sequelize) =>
  sequelize.define('Expense', {
    id:          { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    tenantId:    { type: DataTypes.BIGINT, allowNull: false, defaultValue: 1, field: 'tenant_id' },
    categoryId:  { type: DataTypes.BIGINT, allowNull: true, field: 'category_id' },
    description: { type: DataTypes.STRING(255), allowNull: false },
    amount:      { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    expenseDate: { type: DataTypes.DATEONLY, allowNull: false, field: 'expense_date' },
    paidTo:      { type: DataTypes.STRING(150), allowNull: true, field: 'paid_to' },
    notes:       { type: DataTypes.TEXT, allowNull: true },
    createdBy:   { type: DataTypes.BIGINT, allowNull: true, field: 'created_by' },
    createdAt:   { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' }
  }, { tableName: 'expenses', timestamps: false });
