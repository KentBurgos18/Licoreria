const express = require('express');
const multer = require('multer');
const { Product, ProductComponent, InventoryMovement, SaleItem, GroupPurchase, ProductCategory, ProductPresentation, sequelize } = require('../models');
const { Op } = require('sequelize');
const path = require('path');
const fs = require('fs');
const { requireRole } = require('./adminAuth');
const { processProductImage } = require('../services/ImageProcessor');

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, '../uploads'));
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: function (req, file, cb) {
    // Accept images only
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Solo se permiten imágenes'), false);
    }
    cb(null, true);
  },
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB max file size
  }
});

const router = express.Router();

// POST /products - Create product (SIMPLE or COMBO) - ADMIN only
router.post('/', requireRole('ADMIN'), upload.single('image'), async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    // Parse FormData values (they come as strings)
    const tenantId = req.body.tenantId;
    const name = req.body.name;
    const sku = req.body.sku;
    const productType = req.body.productType || 'SIMPLE';
    const salePrice = parseFloat(req.body.salePrice);
    const initialStock = req.body.initialStock !== undefined ? parseFloat(req.body.initialStock) : undefined;
    const unitCost = req.body.unitCost !== undefined && req.body.unitCost !== '' ? parseFloat(req.body.unitCost) : undefined;
    const costMode = req.body.costMode || 'AVERAGE';
    const isActive = req.body.isActive === 'true' || req.body.isActive === true;
    const stockMin = req.body.stockMin !== undefined && req.body.stockMin !== '' ? parseFloat(req.body.stockMin) : undefined;
    const categoryId = req.body.categoryId && req.body.categoryId !== '' && req.body.categoryId !== 'null' ? parseInt(req.body.categoryId) : null;
    const baseProductId = req.body.baseProductId && req.body.baseProductId !== '' && req.body.baseProductId !== 'null' ? parseInt(req.body.baseProductId) : null;
    const presentationId = req.body.presentationId && req.body.presentationId !== '' && req.body.presentationId !== 'null' ? parseInt(req.body.presentationId) : null;
    const unitsPerSale = req.body.unitsPerSale !== undefined && req.body.unitsPerSale !== '' ? parseFloat(req.body.unitsPerSale) : 1;
    const taxApplies = req.body.taxApplies !== 'false' && req.body.taxApplies !== false;

    // Parse components if it's a string (from FormData)
    let components = req.body.components;
    if (components && typeof components === 'string') {
      try {
        components = JSON.parse(components);
      } catch (e) {
        return res.status(400).json({
          error: 'Invalid components format',
          code: 'INVALID_COMPONENTS'
        });
      }
    }

    // Handle image upload
    let imageUrl = null;
    if (req.file) {
      const filePath = path.join(__dirname, '..', 'uploads', req.file.filename);
      await processProductImage(filePath);
      imageUrl = '/uploads/' + req.file.filename;
    } else if (req.body && req.body.imageUrl) {
      imageUrl = req.body.imageUrl;
    }

    // Validate SKU uniqueness within tenant
    const existingProduct = await Product.findOne({
      where: { tenantId, sku }
    });

    if (existingProduct) {
      return res.status(400).json({
        error: 'SKU already exists for this tenant',
        code: 'SKU_EXISTS'
      });
    }

    // Validate combo requirements
    if (productType === 'COMBO') {
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
          id: { [Op.in]: componentIds },
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
    } else {
      // For SIMPLE products, validate stockMin
      if (stockMin !== undefined && stockMin < 0) {
        return res.status(400).json({
          error: 'stockMin cannot be negative',
          code: 'INVALID_STOCK_MIN'
        });
      }

      // For SIMPLE products, validate initialStock if provided
      if (initialStock !== undefined && initialStock !== null && Number(initialStock) < 0) {
        return res.status(400).json({
          error: 'initialStock cannot be negative',
          code: 'INVALID_INITIAL_STOCK'
        });
      }
    }

    // Create product
    const product = await Product.create({
      tenantId,
      name,
      sku,
      productType,
      salePrice,
      costMode,
      isActive,
      imageUrl,
      categoryId,
      baseProductId,
      presentationId,
      unitsPerSale,
      taxApplies,
      stockMin: productType === 'SIMPLE' ? stockMin : null,
      createdAt: new Date()
    }, { transaction });

    // Create components if it's a combo
    if (productType === 'COMBO') {
      await ProductComponent.bulkCreate(
        components.map(component => ({
          tenantId,
          comboProductId: product.id,
          componentProductId: component.componentProductId,
          qty: component.qty
        }))
      , { transaction });
    } else {
      // Create initial inventory movement (IN) if provided
      const qty = initialStock !== undefined && initialStock !== null ? Number(initialStock) : 0;
      if (qty > 0) {
        const parsedUnitCost = unitCost !== undefined && unitCost !== null && unitCost !== '' ? Number(unitCost) : null;
        await InventoryMovement.create({
          tenantId,
          productId: product.id,
          movementType: 'IN',
          reason: 'PURCHASE',
          qty,
          unitCost: parsedUnitCost,
          refType: 'PRODUCT_CREATE',
          refId: product.id
        }, { transaction });
      }
    }

    await transaction.commit();

    // Fetch complete product with associations
    const includeList = [{ association: 'category', required: false }];
    if (productType === 'COMBO') {
      includeList.push({ association: 'components', include: [{ association: 'component' }] });
    }
    const createdProduct = await Product.findByPk(product.id, { include: includeList });

    res.status(201).json(createdProduct);
  } catch (error) {
    await transaction.rollback();
    console.error('Error creating product:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// GET /products - List products with optional filtering
router.get('/', async (req, res) => {
  try {
    const {
      tenantId,
      productType,
      isActive,
      categoryId,
      presentationId,
      page = 1,
      limit = 50
    } = req.query;

    const whereClause = {};
    if (tenantId) whereClause.tenantId = tenantId;
    if (productType) whereClause.productType = productType;
    if (isActive !== undefined) whereClause.isActive = isActive === 'true';
    if (categoryId) whereClause.categoryId = categoryId;
    if (presentationId) whereClause.presentationId = presentationId;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const { count, rows } = await Product.findAndCountAll({
      where: whereClause,
      include: [
        {
          association: 'components',
          include: [{
            association: 'component'
          }],
          required: false
        },
        {
          association: 'category',
          required: false
        },
        {
          association: 'presentation',
          required: false
        },
        {
          association: 'baseProduct',
          attributes: ['id', 'name', 'sku'],
          required: false
        }
      ],
      limit: parseInt(limit),
      offset,
      order: [['name', 'ASC']]
    });

    // Calculate average purchase price for each product
    const productsWithPurchasePrice = await Promise.all(
      rows.map(async (product) => {
        const productData = product.toJSON();
        if (productData.productType === 'SIMPLE') {
          productData.purchasePrice = await InventoryMovement.getAverageCost(
            productData.tenantId,
            productData.id
          );
        } else {
          // For COMBO products, calculate from components
          productData.purchasePrice = 0;
        }
        return productData;
      })
    );

    res.json({
      products: productsWithPurchasePrice,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    console.error('Error listing products:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// GET /products/:id - Get product by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { tenantId } = req.query;

    const product = await Product.findOne({
      where: { id, tenantId },
      include: [
        {
          association: 'components',
          include: [{
            association: 'component'
          }],
          required: false
        },
        {
          association: 'category',
          required: false
        },
        {
          association: 'presentation',
          required: false
        },
        {
          association: 'baseProduct',
          attributes: ['id', 'name', 'sku'],
          required: false
        }
      ]
    });

    if (!product) {
      return res.status(404).json({
        error: 'Product not found',
        code: 'PRODUCT_NOT_FOUND'
      });
    }

    // Calculate average purchase price
    const productData = product.toJSON();
    if (productData.productType === 'SIMPLE') {
      productData.purchasePrice = await InventoryMovement.getAverageCost(
        productData.tenantId,
        productData.id
      );
    } else {
      productData.purchasePrice = 0;
    }

    res.json(productData);
  } catch (error) {
    console.error('Error getting product:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// PUT /products/:id - Update product - ADMIN only
router.put('/:id', requireRole('ADMIN'), upload.single('image'), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      tenantId,
      name,
      salePrice,
      costMode,
      isActive,
      stockMin,
      categoryId,
      baseProductId,
      presentationId,
      unitsPerSale,
      taxApplies
    } = req.body;

    const product = await Product.findOne({
      where: { id, tenantId }
    });

    if (!product) {
      return res.status(404).json({
        error: 'Product not found',
        code: 'PRODUCT_NOT_FOUND'
      });
    }

    // Handle image upload
    let imageUrl = product.imageUrl;
    if (req.file) {
      const filePath = path.join(__dirname, '..', 'uploads', req.file.filename);
      await processProductImage(filePath);
      imageUrl = '/uploads/' + req.file.filename;
    } else if (req.body && req.body.imageUrl) {
      imageUrl = req.body.imageUrl;
    }

    // Update fields
    const updates = {};
    if (name !== undefined && name !== null && name !== '') updates.name = name;
    if (salePrice !== undefined && salePrice !== null && salePrice !== '' && !isNaN(salePrice)) updates.salePrice = parseFloat(salePrice);
    if (costMode !== undefined && costMode !== null && costMode !== '') updates.costMode = costMode;
    if (isActive !== undefined) updates.isActive = isActive === 'true' || isActive === true;
    if (imageUrl !== undefined) updates.imageUrl = imageUrl;
    if (categoryId !== undefined) updates.categoryId = categoryId === '' || categoryId === 'null' || categoryId === null ? null : parseInt(categoryId);
    if (baseProductId !== undefined) updates.baseProductId = baseProductId === '' || baseProductId === 'null' || baseProductId === null ? null : parseInt(baseProductId);
    if (presentationId !== undefined) updates.presentationId = presentationId === '' || presentationId === 'null' || presentationId === null ? null : parseInt(presentationId);
    if (unitsPerSale !== undefined) updates.unitsPerSale = parseFloat(unitsPerSale) || 1;
    if (taxApplies !== undefined) updates.taxApplies = taxApplies === 'true' || taxApplies === true;
    
    // Only update stockMin for SIMPLE products
    if (stockMin !== undefined && product.productType === 'SIMPLE') {
      if (stockMin < 0) {
        return res.status(400).json({
          error: 'stockMin cannot be negative',
          code: 'INVALID_STOCK_MIN'
        });
      }
      updates.stockMin = stockMin;
    }

    await product.update(updates);

    // Fetch updated product
    const updateInclude = [
      { association: 'category', required: false },
      { association: 'presentation', required: false },
      { association: 'baseProduct', attributes: ['id', 'name', 'sku'], required: false }
    ];
    if (product.productType === 'COMBO') {
      updateInclude.push({ association: 'components', include: [{ association: 'component' }] });
    }
    const updatedProduct = await Product.findByPk(id, { include: updateInclude });

    res.json(updatedProduct);
  } catch (error) {
    console.error('Error updating product:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// POST /products/:id/add-stock - Add stock to existing product - ADMIN only
router.post('/:id/add-stock', requireRole('ADMIN'), async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { tenantId, quantity, unitCost } = req.body;

    if (!quantity || quantity <= 0) {
      await transaction.rollback();
      return res.status(400).json({
        error: 'Quantity must be greater than 0',
        code: 'INVALID_QUANTITY'
      });
    }

    const product = await Product.findOne({
      where: { id, tenantId }
    }, { transaction });

    if (!product) {
      await transaction.rollback();
      return res.status(404).json({
        error: 'Product not found',
        code: 'PRODUCT_NOT_FOUND'
      });
    }

    if (product.productType !== 'SIMPLE') {
      await transaction.rollback();
      return res.status(400).json({
        error: 'Only SIMPLE products can have stock added',
        code: 'NOT_SIMPLE_PRODUCT'
      });
    }

    // Create inventory movement
    await InventoryMovement.create({
      tenantId,
      productId: id,
      movementType: 'IN',
      reason: 'PURCHASE',
      qty: quantity,
      unitCost: unitCost || null,
      refType: 'STOCK_ADD',
      refId: id
    }, { transaction });

    await transaction.commit();

    // Get updated stock
    const currentStock = await InventoryMovement.getCurrentStock(tenantId, id);

    res.json({
      message: 'Stock added successfully',
      productId: id,
      quantityAdded: quantity,
      currentStock
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Error adding stock:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// DELETE /products/:id - Eliminar producto de la base de datos (solo si no tiene dependencias) - ADMIN only
router.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;
    const rawTenant = req.query.tenantId ?? req.body?.tenantId ?? 1;
    const tenantId = parseInt(String(rawTenant), 10) || 1;
    const productId = parseInt(id, 10);
    if (isNaN(productId)) {
      return res.status(400).json({ error: 'ID de producto inválido', code: 'INVALID_ID' });
    }

    const product = await Product.findOne({
      where: { id: productId, tenantId }
    });

    if (!product) {
      return res.status(404).json({
        error: 'Producto no encontrado',
        code: 'PRODUCT_NOT_FOUND'
      });
    }

    // No eliminar si es producto base de otros (pool)
    if (product.productType === 'SIMPLE' && !product.baseProductId) {
      const poolProducts = await Product.findAll({
        where: { baseProductId: productId }
      });
      if (poolProducts.length > 0) {
        return res.status(400).json({
          error: 'No se puede eliminar: es producto base de ' + poolProducts.map(p => p.name).join(', '),
          code: 'PRODUCT_IS_POOL_BASE'
        });
      }
    }

    // No eliminar si es componente de algún combo
    if (product.productType === 'SIMPLE') {
      const usedInCombos = await ProductComponent.findAll({
        where: { componentProductId: productId },
        include: [{ association: 'combo', attributes: ['name'] }]
      });
      if (usedInCombos.length > 0) {
        return res.status(400).json({
          error: 'No se puede eliminar: está en combos (' + usedInCombos.map(pc => pc.combo?.name || 'Combo').join(', ') + ')',
          code: 'PRODUCT_USED_IN_COMBOS'
        });
      }
    }

    // No eliminar si tiene ítems en ventas
    const saleItemsCount = await SaleItem.count({ where: { productId } });
    if (saleItemsCount > 0) {
      return res.status(400).json({
        error: 'No se puede eliminar: el producto tiene ventas registradas.',
        code: 'PRODUCT_HAS_SALES'
      });
    }

    // No eliminar si tiene compras grupales (verificar ANTES de borrar movimientos)
    try {
      const groupPurchasesCount = await GroupPurchase.count({ where: { productId } });
      if (groupPurchasesCount > 0) {
        return res.status(400).json({
          error: 'No se puede eliminar: el producto tiene compras grupales asociadas.',
          code: 'PRODUCT_HAS_GROUP_PURCHASES'
        });
      }
    } catch (e) {
      // Si la tabla no existe aún, ignorar la verificación
      if (!e.message?.includes('does not exist')) throw e;
    }

    // Eliminar movimientos de inventario y luego el producto
    await InventoryMovement.destroy({ where: { productId } });

    if (product.productType === 'COMBO') {
      await sequelize.query(
        'DELETE FROM product_components WHERE combo_product_id = :productId',
        { replacements: { productId } }
      );
    }

    await sequelize.query(
      'DELETE FROM products WHERE id = :productId AND tenant_id = :tenantId',
      { replacements: { productId, tenantId } }
    );

    res.json({ message: 'Producto eliminado correctamente' });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

module.exports = router;