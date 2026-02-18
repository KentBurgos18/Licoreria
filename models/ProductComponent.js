const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ProductComponent = sequelize.define('ProductComponent', {
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
    comboProductId: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: 'combo_product_id'
    },
    componentProductId: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: 'component_product_id'
    },
    qty: {
      type: DataTypes.DECIMAL(12, 3),
      allowNull: false
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: 'created_at'
    }
  }, {
    tableName: 'product_components',
    timestamps: false,
    indexes: [
      { fields: ['tenant_id'] },
      { fields: ['combo_product_id'] },
      { fields: ['component_product_id'] },
      { unique: true, fields: ['tenant_id', 'combo_product_id', 'component_product_id'] }
    ]
  });

  ProductComponent.associate = (models) => {
    // The combo product
    ProductComponent.belongsTo(models.Product, {
      foreignKey: 'comboProductId',
      as: 'combo'
    });

    // The component product
    ProductComponent.belongsTo(models.Product, {
      foreignKey: 'componentProductId',
      as: 'component'
    });
  };

  // Instance methods
  ProductComponent.prototype.getComponentStock = async function() {
    const InventoryMovement = sequelize.models.InventoryMovement;
    const currentStock = await InventoryMovement.getCurrentStock(
      this.tenantId,
      this.componentProductId
    );
    return currentStock;
  };

  ProductComponent.prototype.getMaxCombosFromStock = async function() {
    const stock = await this.getComponentStock();
    return Math.floor(stock / this.qty);
  };

  // Class methods
  ProductComponent.findByCombo = function(comboProductId, options = {}) {
    return this.findAll({
      ...options,
      where: {
        ...options.where,
        comboProductId
      },
      include: [{
        association: 'component'
      }]
    });
  };

  ProductComponent.findByComponent = function(componentProductId, options = {}) {
    return this.findAll({
      ...options,
      where: {
        ...options.where,
        componentProductId
      },
      include: [{
        association: 'combo'
      }]
    });
  };

  // Update components for a combo (replaces all existing components)
  ProductComponent.updateComboComponents = async function(tenantId, comboProductId, components) {
    const transaction = await sequelize.transaction();
    
    try {
      // Delete existing components
      await this.destroy({
        where: { tenantId, comboProductId },
        transaction
      });

      // Create new components
      const newComponents = await this.bulkCreate(
        components.map(comp => ({
          tenantId,
          comboProductId,
          componentProductId: comp.componentProductId,
          qty: comp.qty
        })),
        { transaction }
      );

      await transaction.commit();
      return newComponents;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  };

  return ProductComponent;
};