'use strict';
const { DataTypes } = require('sequelize');

module.exports = (sequelize) =>
  sequelize.define('AuditLog', {
    id:          { type: DataTypes.BIGINT,       primaryKey: true, autoIncrement: true },
    tenantId:    { type: DataTypes.BIGINT,       allowNull: false, field: 'tenant_id'  },
    userId:      { type: DataTypes.BIGINT,       allowNull: true,  field: 'user_id'    },
    userName:    { type: DataTypes.STRING(100),  allowNull: true,  field: 'user_name'  },
    userEmail:   { type: DataTypes.STRING(150),  allowNull: true,  field: 'user_email' },
    action:      { type: DataTypes.STRING(20),   allowNull: false                      },
    entity:      { type: DataTypes.STRING(50),   allowNull: false                      },
    entityId:    { type: DataTypes.STRING(50),   allowNull: true,  field: 'entity_id'  },
    description: { type: DataTypes.TEXT,         allowNull: false                      },
    metadata:    { type: DataTypes.JSONB,        allowNull: true                       },
    ipAddress:   { type: DataTypes.STRING(50),   allowNull: true,  field: 'ip_address' },
    createdAt:   { type: DataTypes.DATE,         allowNull: false, field: 'created_at' }
  }, {
    tableName:  'audit_logs',
    timestamps: false
  });
