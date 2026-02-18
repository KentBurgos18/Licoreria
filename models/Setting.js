const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Setting = sequelize.define('Setting', {
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
    settingKey: {
      type: DataTypes.STRING(100),
      allowNull: false,
      field: 'setting_key'
    },
    settingValue: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'setting_value'
    },
    settingType: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: 'string',
      field: 'setting_type'
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    updatedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: 'updated_at'
    }
  }, {
    tableName: 'settings',
    timestamps: false,
    indexes: [
      { fields: ['tenant_id'] },
      { fields: ['setting_key'] },
      { unique: true, fields: ['tenant_id', 'setting_key'] }
    ]
  });

  // Método estático para obtener un setting
  Setting.getSetting = async function(tenantId, key, defaultValue = null) {
    const setting = await this.findOne({
      where: { tenantId, settingKey: key }
    });
    
    if (!setting) return defaultValue;
    
    // Convertir según el tipo
    switch (setting.settingType) {
      case 'number':
        const parsed = parseFloat(setting.settingValue);
        return isNaN(parsed) ? defaultValue : parsed;
      case 'boolean':
        return setting.settingValue === 'true';
      case 'json':
        try {
          return JSON.parse(setting.settingValue);
        } catch {
          return defaultValue;
        }
      default:
        return setting.settingValue || defaultValue;
    }
  };

  // Método estático para guardar un setting
  Setting.setSetting = async function(tenantId, key, value, type = 'string', description = null) {
    let stringValue = value;
    
    if (type === 'json') {
      stringValue = JSON.stringify(value);
    } else if (type === 'boolean') {
      stringValue = value ? 'true' : 'false';
    } else if (type === 'number') {
      stringValue = String(value);
    }
    
    const [setting, created] = await this.findOrCreate({
      where: { tenantId, settingKey: key },
      defaults: {
        tenantId,
        settingKey: key,
        settingValue: stringValue,
        settingType: type,
        description,
        updatedAt: new Date()
      }
    });
    
    if (!created) {
      setting.settingValue = stringValue;
      setting.settingType = type;
      if (description) setting.description = description;
      setting.updatedAt = new Date();
      await setting.save();
    }
    
    return setting;
  };

  return Setting;
};
