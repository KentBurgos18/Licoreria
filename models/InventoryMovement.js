const { DataTypes, Op, literal } = require('sequelize');

module.exports = (sequelize) => {
  const InventoryMovement = sequelize.define('InventoryMovement', {
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
    productId: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: 'product_id'
    },
    movementType: {
      type: DataTypes.ENUM('IN', 'OUT'),
      allowNull: false,
      field: 'movement_type'
    },
    reason: {
      type: DataTypes.ENUM('SALE', 'PURCHASE', 'ADJUST', 'VOID', 'WASTE'),
      allowNull: false
    },
    qty: {
      type: DataTypes.DECIMAL(12, 3),
      allowNull: false
    },
    unitCost: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
      field: 'unit_cost'
    },
    refType: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'ref_type'
    },
    refId: {
      type: DataTypes.BIGINT,
      allowNull: true,
      field: 'ref_id'
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: 'created_at'
    }
  }, {
    tableName: 'inventory_movements',
    timestamps: false,
    indexes: [
      { fields: ['tenant_id'] },
      { fields: ['product_id'] },
      { fields: ['movement_type'] },
      { fields: ['ref_type', 'ref_id'] }
    ]
  });

  InventoryMovement.associate = (models) => {
    InventoryMovement.belongsTo(models.Product, {
      foreignKey: 'productId',
      as: 'product'
    });
  };

  // Class methods
  InventoryMovement.getCurrentStock = async function(tenantId, productId) {
    const result = await this.findOne({
      where: { tenantId, productId },
      attributes: [
        [literal("SUM(CASE WHEN movement_type = 'IN' THEN qty ELSE -qty END)"), 'currentStock']
      ],
      raw: true
    });

    return parseFloat(result?.currentStock || 0);
  };

  InventoryMovement.getAverageCost = async function(tenantId, productId) {
    const result = await this.findOne({
      where: { 
        tenantId, 
        productId, 
        movementType: 'IN',
        unitCost: { [Op.ne]: null }
      },
      attributes: [
        [literal('AVG(unit_cost)'), 'avgCost']
      ],
      raw: true
    });

    return parseFloat(result?.avgCost || 0);
  };

  InventoryMovement.getUnitCost = async function(tenantId, productId, qty, transaction = null) {
    // For FIFO, get the cost of the oldest items
    // For simplicity, using average cost here
    return await this.getAverageCost(tenantId, productId);
  };

  return InventoryMovement;
};