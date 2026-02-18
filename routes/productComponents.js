const express = require('express');
const { Product, ProductComponent } = require('../models');
const ComboService = require('../services/ComboService');
const { requireRole } = require('./adminAuth');

const router = express.Router();

// POST /products/:id/components - Update combo components - ADMIN only
router.post('/:id/components', requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;
    const { tenantId, components } = req.body;

    // Validate that the product exists and is a COMBO
    const product = await Product.findOne({
      where: { id, tenantId, productType: 'COMBO' }
    });

    if (!product) {
      return res.status(404).json({
        error: 'Combo product not found',
        code: 'COMBO_NOT_FOUND'
      });
    }

    // Validate components array
    if (!components || components.length === 0) {
      return res.status(400).json({
        error: 'Combo products must have at least one component',
        code: 'COMBO_NEEDS_COMPONENTS'
      });
    }

    // Validate that all components exist and are SIMPLE products
    const componentIds = components.map(c => c.componentProductId);
    const componentProducts = await Product.findAll({
      where: {
        id: { [require('sequelize').Op.in]: componentIds },
        tenantId,
        productType: 'SIMPLE'
      }
    });

    if (componentProducts.length !== componentIds.length) {
      return res.status(400).json({
        error: 'All components must exist and be SIMPLE products',
        code: 'INVALID_COMPONENTS'
      });
    }

    // Validate component quantities
    for (const component of components) {
      if (!component.qty || component.qty <= 0) {
        return res.status(400).json({
          error: 'Component quantities must be greater than 0',
          code: 'INVALID_COMPONENT_QTY'
        });
      }
    }

    // Check for duplicate components
    const uniqueComponentIds = [...new Set(componentIds)];
    if (uniqueComponentIds.length !== componentIds.length) {
      return res.status(400).json({
        error: 'Duplicate components are not allowed',
        code: 'DUPLICATE_COMPONENTS'
      });
    }

    // Update components (replaces all existing components)
    await ProductComponent.updateComboComponents(tenantId, id, components);

    // Fetch updated product with components
    const updatedProduct = await Product.findByPk(id, {
      include: [{
        association: 'components',
        include: [{
          association: 'component'
        }]
      }]
    });

    res.json(updatedProduct);
  } catch (error) {
    console.error('Error updating combo components:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// GET /products/:id/components - Get combo components
router.get('/:id/components', async (req, res) => {
  try {
    const { id } = req.params;
    const { tenantId } = req.query;

    // Validate that the product exists and is a COMBO
    const product = await Product.findOne({
      where: { id, tenantId, productType: 'COMBO' }
    });

    if (!product) {
      return res.status(404).json({
        error: 'Combo product not found',
        code: 'COMBO_NOT_FOUND'
      });
    }

    const components = await ProductComponent.findByCombo(id, {
      include: [{
        association: 'component'
      }]
    });

    res.json({
      comboId: id,
      comboName: product.name,
      components
    });
  } catch (error) {
    console.error('Error getting combo components:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// DELETE /products/:id/components/:componentId - Remove specific component - ADMIN only
router.delete('/:id/components/:componentId', requireRole('ADMIN'), async (req, res) => {
  try {
    const { id, componentId } = req.params;
    const { tenantId } = req.query;

    // Validate that the product exists and is a COMBO
    const product = await Product.findOne({
      where: { id, tenantId, productType: 'COMBO' }
    });

    if (!product) {
      return res.status(404).json({
        error: 'Combo product not found',
        code: 'COMBO_NOT_FOUND'
      });
    }

    const component = await ProductComponent.findOne({
      where: {
        comboProductId: id,
        componentProductId: componentId,
        tenantId
      }
    });

    if (!component) {
      return res.status(404).json({
        error: 'Component not found in this combo',
        code: 'COMPONENT_NOT_FOUND'
      });
    }

    await component.destroy();

    // Check if combo still has components
    const remainingComponents = await ProductComponent.findByCombo(id);
    if (remainingComponents.length === 0) {
      return res.status(400).json({
        error: 'Cannot remove last component. Combo must have at least one component.',
        code: 'CANNOT_REMOVE_LAST_COMPONENT'
      });
    }

    res.json({ message: 'Component removed successfully' });
  } catch (error) {
    console.error('Error removing component:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

module.exports = router;