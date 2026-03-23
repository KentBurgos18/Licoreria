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

  // ── Caché en memoria para settings (TTL 5 minutos) ──
  const _cache = new Map();
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

  function cacheKey(tenantId, key) { return `${tenantId}:${key}`; }

  Setting.clearCache = function(tenantId, key) {
    if (key) {
      _cache.delete(cacheKey(tenantId, key));
    } else {
      // Invalidar todo el tenant
      for (const k of _cache.keys()) {
        if (k.startsWith(`${tenantId}:`)) _cache.delete(k);
      }
    }
  };

  // Método estático para obtener un setting (con caché)
  Setting.getSetting = async function(tenantId, key, defaultValue = null) {
    const ck = cacheKey(tenantId, key);
    const cached = _cache.get(ck);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      return cached.val !== undefined ? cached.val : defaultValue;
    }

    const setting = await this.findOne({
      where: { tenantId, settingKey: key }
    });

    let result;
    if (!setting) {
      result = defaultValue;
    } else {
      switch (setting.settingType) {
        case 'number':
          const parsed = parseFloat(setting.settingValue);
          result = isNaN(parsed) ? defaultValue : parsed;
          break;
        case 'boolean':
          result = setting.settingValue === 'true';
          break;
        case 'json':
          try { result = JSON.parse(setting.settingValue); } catch { result = defaultValue; }
          break;
        default:
          result = setting.settingValue || defaultValue;
      }
    }

    _cache.set(ck, { val: result, ts: Date.now() });
    return result;
  };

  // Método estático para guardar un setting (invalida caché)
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

    // Invalidar caché de esta key
    Setting.clearCache(tenantId, key);

    return setting;
  };

  return Setting;
};
