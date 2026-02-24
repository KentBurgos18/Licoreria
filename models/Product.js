const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Product = sequelize.define('Product', {
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
    sku: {
      type: DataTypes.STRING,
      allowNull: false
    },
    productType: {
      type: DataTypes.ENUM('SIMPLE', 'COMBO'),
      allowNull: false,
      defaultValue: 'SIMPLE',
      field: 'product_type'
    },
    salePrice: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      field: 'sale_price'
    },
    costMode: {
      type: DataTypes.ENUM('FIFO', 'AVERAGE'),
      allowNull: false,
      defaultValue: 'AVERAGE',
      field: 'cost_mode'
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: 'is_active'
    },
    stockMin: {
      type: DataTypes.DECIMAL(12, 3),
      allowNull: true,
      field: 'stock_min'
    },
    imageUrl: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'image_url'
    },
    categoryId: {
      type: DataTypes.BIGINT,
      allowNull: true,
      field: 'category_id'
    },
    baseProductId: {
      type: DataTypes.BIGINT,
      allowNull: true,
      field: 'base_product_id'
    },
    presentationId: {
      type: DataTypes.BIGINT,
      allowNull: true,
      field: 'presentation_id'
    },
    unitsPerSale: {
      type: DataTypes.DECIMAL(12, 3),
      allowNull: false,
      defaultValue: 1,
      field: 'units_per_sale'
    },
    taxApplies: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: 'tax_applies'
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: 'created_at'
    }
  }, {
    tableName: 'products',
    timestamps: false,
    indexes: [
      { fields: ['tenant_id'] },
      { fields: ['sku'] },
      { fields: ['product_type'] },
      { unique: true, fields: ['tenant_id', 'sku'] }
    ]
  });

  Product.associate = (models) => {
    // Components of this combo (if product_type = COMBO)
    Product.hasMany(models.ProductComponent, {
      foreignKey: 'comboProductId',
      as: 'components'
    });

    // Combos that include this product as component (if product_type = SIMPLE)
    Product.hasMany(models.ProductComponent, {
      foreignKey: 'componentProductId',
      as: 'usedInCombos'
    });

    // Inventory movements (only for SIMPLE products)
    Product.hasMany(models.InventoryMovement, {
      foreignKey: 'productId',
      as: 'inventoryMovements'
    });

    // Group purchases
    Product.hasMany(models.GroupPurchase, {
      foreignKey: 'productId',
      as: 'groupPurchases'
    });

    // Category
    if (models.ProductCategory) {
      Product.belongsTo(models.ProductCategory, {
        foreignKey: 'categoryId',
        as: 'category'
      });
    }

    // Inventory pool: base product
    Product.belongsTo(models.Product, {
      foreignKey: 'baseProductId',
      as: 'baseProduct'
    });
    Product.hasMany(models.Product, {
      foreignKey: 'baseProductId',
      as: 'poolProducts'
    });

    // Presentation
    if (models.ProductPresentation) {
      Product.belongsTo(models.ProductPresentation, {
        foreignKey: 'presentationId',
        as: 'presentation'
      });
    }
  };

  // Instance methods
  Product.prototype.isSimple = function() {
    return this.productType === 'SIMPLE';
  };

  Product.prototype.isCombo = function() {
    return this.productType === 'COMBO';
  };

  // Class methods
  Product.findSimple = function(options) {
    return this.findAll({
      ...options,
      where: {
        ...options?.where,
        productType: 'SIMPLE'
      }
    });
  };

  Product.findCombos = function(options) {
    return this.findAll({
      ...options,
      where: {
        ...options?.where,
        productType: 'COMBO'
      },
      include: [{
        association: 'components',
        include: [{
          association: 'component'
        }]
      }]
    });
  };

  return Product;
};