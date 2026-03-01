const { DataTypes } = require('sequelize');

module.exports = (sequelize) =>
  sequelize.define('ExpenseCategory', {
    id:       { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    tenantId: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 1, field: 'tenant_id' },
    name:     { type: DataTypes.STRING(100), allowNull: false }
  }, { tableName: 'expense_categories', timestamps: false });
