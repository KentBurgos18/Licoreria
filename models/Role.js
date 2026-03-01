'use strict';
const { DataTypes } = require('sequelize');

module.exports = (sequelize) =>
  sequelize.define('Role', {
    id:          { type: DataTypes.BIGINT,       primaryKey: true, autoIncrement: true },
    tenantId:    { type: DataTypes.BIGINT,       defaultValue: 1,  field: 'tenant_id'     },
    name:        { type: DataTypes.STRING(100),  allowNull: false                         },
    permissions: { type: DataTypes.JSONB,        defaultValue: {}                         },
    createdAt:   { type: DataTypes.DATE,         field: 'created_at'                      }
  }, {
    tableName:  'roles',
    timestamps: false
  });
