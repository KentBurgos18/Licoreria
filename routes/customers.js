const express = require('express');
const bcrypt = require('bcrypt');
const { Customer, sequelize } = require('../models');
const { Op } = require('sequelize');
const { requireRole } = require('./adminAuth');

const router = express.Router();

// GET /customers - List customers
router.get('/', async (req, res) => {
  try {
    const {
      tenantId = 1,
      search,
      isActive,
      page = 1,
      limit = 50
    } = req.query;

    const whereClause = { tenantId };
    
    if (isActive !== undefined) {
      whereClause.isActive = isActive === 'true';
    }

    if (search) {
      whereClause[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
        { phone: { [Op.iLike]: `%${search}%` } },
        { cedula: { [Op.iLike]: `%${search}%` } }
      ];
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Try with cedula, fallback if column doesn't exist
    let attributes = ['id', 'name', 'cedula', 'email', 'phone', 'address', 'isActive', 'createdAt'];
    
    const { count, rows } = await Customer.findAndCountAll({
      where: whereClause,
      attributes: attributes,
      limit: parseInt(limit),
      offset,
      order: [['name', 'ASC']]
    }).catch(async (error) => {
      // If error is about cedula column, retry without it
      if (error.message && error.message.includes('cedula')) {
        console.warn('Cédula column not found, retrying without it');
        attributes = ['id', 'name', 'email', 'phone', 'address', 'isActive', 'createdAt'];
        return await Customer.findAndCountAll({
          where: whereClause,
          attributes: attributes,
          limit: parseInt(limit),
          offset,
          order: [['name', 'ASC']]
        });
      }
      throw error;
    });

    res.json({
      customers: rows,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    console.error('Error listing customers:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// GET /customers/:id - Get customer by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { tenantId = 1 } = req.query;

    // Try with cedula, fallback if column doesn't exist
    let attributes = ['id', 'name', 'cedula', 'email', 'phone', 'address', 'isActive', 'createdAt'];
    
    const customer = await Customer.findOne({
      where: { id, tenantId },
      attributes: attributes
    }).catch(async (error) => {
      // If error is about cedula column, retry without it
      if (error.message && error.message.includes('cedula')) {
        console.warn('Cédula column not found, retrying without it');
        attributes = ['id', 'name', 'email', 'phone', 'address', 'isActive', 'createdAt'];
        return await Customer.findOne({
          where: { id, tenantId },
          attributes: attributes
        });
      }
      throw error;
    });

    if (!customer) {
      return res.status(404).json({
        error: 'Customer not found',
        code: 'CUSTOMER_NOT_FOUND'
      });
    }

    res.json(customer);
  } catch (error) {
    console.error('Error getting customer:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// POST /customers - Create customer
router.post('/', async (req, res) => {
  try {
    const {
      tenantId = 1,
      name,
      cedula,
      email,
      phone,
      address,
      latitude,
      longitude,
      password,
      isActive = true
    } = req.body;

    if (!name) {
      return res.status(400).json({
        error: 'Name is required',
        code: 'MISSING_NAME'
      });
    }

    if (!cedula) {
      return res.status(400).json({
        error: 'Cédula is required',
        code: 'MISSING_CEDULA'
      });
    }

    // Validate cédula format
    const cedulaRegex = /^[A-Za-z0-9-]+$/;
    if (!cedulaRegex.test(cedula.trim())) {
      return res.status(400).json({
        error: 'Cédula must contain only letters, numbers and hyphens',
        code: 'INVALID_CEDULA_FORMAT'
      });
    }

    // Check if cédula already exists
    const existingCedula = await Customer.findOne({
      where: { cedula: cedula.trim(), tenantId }
    });

    if (existingCedula) {
      return res.status(400).json({
        error: 'Esta cédula ya está registrada',
        code: 'CEDULA_EXISTS'
      });
    }

    // Check if email already exists
    if (email) {
      const existingCustomer = await Customer.findOne({
        where: { email, tenantId }
      });

      if (existingCustomer) {
        return res.status(400).json({
          error: 'Email already exists',
          code: 'EMAIL_EXISTS'
        });
      }
    }

    // Build address string with coordinates if provided
    let fullAddress = address || '';
    if (latitude && longitude) {
      fullAddress += fullAddress ? ` | Coordenadas: ${latitude}, ${longitude}` : `Coordenadas: ${latitude}, ${longitude}`;
    }

    const customerData = {
      tenantId,
      name,
      cedula: cedula.trim(),
      email: email || null,
      phone: phone || null,
      address: fullAddress || null,
      isActive
    };

    // Hash password if provided
    if (password) {
      if (password.length < 6) {
        return res.status(400).json({
          error: 'Password must be at least 6 characters',
          code: 'WEAK_PASSWORD'
        });
      }
      customerData.password = await bcrypt.hash(password, 10);
    }

    const customer = await Customer.create(customerData);

    res.status(201).json({
      id: customer.id,
      name: customer.name,
      cedula: customer.cedula,
      email: customer.email,
      phone: customer.phone,
      address: customer.address,
      isActive: customer.isActive
    });
  } catch (error) {
    console.error('Error creating customer:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// PUT /customers/:id - Update customer
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      tenantId = 1,
      name,
      cedula,
      email,
      phone,
      address,
      latitude,
      longitude,
      password,
      isActive
    } = req.body;

    const customer = await Customer.findOne({
      where: { id, tenantId }
    });

    if (!customer) {
      return res.status(404).json({
        error: 'Customer not found',
        code: 'CUSTOMER_NOT_FOUND'
      });
    }

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (phone !== undefined) updates.phone = phone;
    if (isActive !== undefined) updates.isActive = isActive;

    // Handle cédula change
    if (cedula !== undefined && cedula.trim() !== customer.cedula) {
      const cedulaRegex = /^[A-Za-z0-9-]+$/;
      if (!cedulaRegex.test(cedula.trim())) {
        return res.status(400).json({
          error: 'Cédula must contain only letters, numbers and hyphens',
          code: 'INVALID_CEDULA_FORMAT'
        });
      }

      const existingCedula = await Customer.findOne({
        where: { cedula: cedula.trim(), tenantId }
      });

      if (existingCedula) {
        return res.status(400).json({
          error: 'Esta cédula ya está registrada',
          code: 'CEDULA_EXISTS'
        });
      }
      updates.cedula = cedula.trim();
    }

    // Handle address update with coordinates
    if (address !== undefined || (latitude && longitude)) {
      let fullAddress = address || customer.address || '';
      if (latitude && longitude) {
        // Remove old coordinates if they exist
        fullAddress = fullAddress.split(' | Coordenadas:')[0].trim();
        fullAddress += fullAddress ? ` | Coordenadas: ${latitude}, ${longitude}` : `Coordenadas: ${latitude}, ${longitude}`;
      }
      updates.address = fullAddress;
    }

    // Handle email change
    if (email !== undefined && email !== customer.email) {
      const existingCustomer = await Customer.findOne({
        where: { email, tenantId }
      });

      if (existingCustomer) {
        return res.status(400).json({
          error: 'Email already exists',
          code: 'EMAIL_EXISTS'
        });
      }
      updates.email = email;
    }

    // Handle password change
    if (password) {
      if (password.length < 6) {
        return res.status(400).json({
          error: 'Password must be at least 6 characters',
          code: 'WEAK_PASSWORD'
        });
      }
      updates.password = await bcrypt.hash(password, 10);
    }

    await customer.update(updates);

    res.json({
      id: customer.id,
      name: customer.name,
      cedula: customer.cedula,
      email: customer.email,
      phone: customer.phone,
      address: customer.address,
      isActive: customer.isActive
    });
  } catch (error) {
    console.error('Error updating customer:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// DELETE /customers/:id - Delete customer (soft delete or permanent) - ADMIN only
router.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;
    const { tenantId = 1, permanent = 'false' } = req.query;

    const customer = await Customer.findOne({
      where: { id, tenantId }
    });

    if (!customer) {
      return res.status(404).json({
        error: 'Customer not found',
        code: 'CUSTOMER_NOT_FOUND'
      });
    }

    if (permanent === 'true') {
      // Verificar si el cliente tiene ventas asociadas
      const { Sale, CustomerPayment, CustomerCredit, GroupPurchaseParticipant, sequelize: db } = require('../models');
      const salesCount = await Sale.count({ where: { customerId: id } });

      if (salesCount > 0) {
        return res.status(400).json({
          error: `No se puede eliminar: el cliente tiene ${salesCount} venta(s) asociada(s). Solo se puede desactivar.`,
          code: 'CUSTOMER_HAS_SALES'
        });
      }

      // Eliminar registros relacionados antes de destruir el cliente
      await CustomerPayment.destroy({ where: { customerId: id } });
      await CustomerCredit.destroy({ where: { customerId: id } });
      try {
        await GroupPurchaseParticipant.destroy({ where: { customerId: id } });
      } catch (e) {
        if (!e.message?.includes('does not exist')) throw e;
      }

      await customer.destroy();
      res.json({ message: 'Cliente eliminado permanentemente' });
    } else {
      await customer.update({ isActive: false });
      res.json({ message: 'Cliente desactivado exitosamente' });
    }
  } catch (error) {
    console.error('Error deleting customer:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// POST /customers/cleanup - Limpiar todos los clientes excepto el de prueba y todas las ventas - ADMIN only
// ⚠️ RUTA TEMPORAL PARA LIMPIEZA - ELIMINAR EN PRODUCCIÓN
router.post('/cleanup', requireRole('ADMIN'), async (req, res) => {
  try {
    const { Op } = require('sequelize');
    const { Sale, SaleItem, CustomerPayment, CustomerCredit, GroupPurchaseParticipant } = require('../models');
    
    console.log('🧹 Iniciando limpieza de clientes y ventas...');
    
    // Obtener todos los clientes (sin transacción primero para evitar problemas)
    const allCustomers = await Customer.unscoped().findAll({
      attributes: ['id', 'name', 'email', 'cedula', 'isActive'],
      order: [['id', 'ASC']]
    });
    
    if (allCustomers.length === 0) {
      return res.json({
        success: false,
        message: 'No hay clientes en la base de datos'
      });
    }
    
    // El cliente de prueba será el primero (ID más bajo)
    const testCustomer = allCustomers[0];
    const customersToDelete = allCustomers.filter(c => c.id !== testCustomer.id);
    const customerIdsToDelete = customersToDelete.map(c => c.id);
    
    // Contar registros antes de eliminar (SIN transacción para evitar abortos)
    let allSalesCount = 0;
    let allSaleItemsCount = 0;
    let paymentsCount = 0;
    let creditsCount = 0;
    let participantsCount = 0;
    
    try {
      allSalesCount = await Sale.count();
    } catch (e) {
      console.log('Tabla sales no existe o hay error:', e.message);
    }
    
    try {
      allSaleItemsCount = await SaleItem.count();
    } catch (e) {
      console.log('Tabla sale_items no existe o hay error:', e.message);
    }
    
    try {
      paymentsCount = await CustomerPayment.count({
        where: { customerId: { [Op.in]: customerIdsToDelete } }
      });
    } catch (e) {
      console.log('Tabla customer_payments no existe o hay error:', e.message);
    }
    
    try {
      creditsCount = await CustomerCredit.count({
        where: { customerId: { [Op.in]: customerIdsToDelete } }
      });
    } catch (e) {
      console.log('Tabla customer_credits no existe o hay error:', e.message);
    }
    
    try {
      participantsCount = await GroupPurchaseParticipant.count({
        where: { customerId: { [Op.in]: customerIdsToDelete } }
      });
    } catch (e) {
      console.log('Tabla group_purchase_participants no existe o hay error:', e.message);
    }
    
    // Eliminar registros usando consultas SQL directas para evitar problemas de transacción
    let deletedSaleItems = 0;
    let deletedSales = 0;
    let deletedPayments = 0;
    let deletedCredits = 0;
    let deletedParticipants = 0;
    let deletedCustomers = 0;
    
    // PASO 1: Eliminar todos los items de ventas usando SQL directo (SIN transacción)
    try {
      await sequelize.query('DELETE FROM sale_items');
      deletedSaleItems = allSaleItemsCount; // Usar el conteo previo
    } catch (e) {
      console.log('Tabla sale_items no existe o error:', e.message);
    }
    
    // PASO 2: Eliminar todas las ventas usando SQL directo (SIN transacción)
    try {
      await sequelize.query('DELETE FROM sales');
      deletedSales = allSalesCount; // Usar el conteo previo
    } catch (e) {
      console.log('Tabla sales no existe o error:', e.message);
    }
    
    // PASO 3: Eliminar pagos relacionados usando SQL directo (SIN transacción)
    if (customerIdsToDelete.length > 0) {
      try {
        await sequelize.query(
          `DELETE FROM customer_payments WHERE customer_id IN (${customerIdsToDelete.join(',')})`
        );
        deletedPayments = paymentsCount; // Usar el conteo previo
      } catch (e) {
        console.log('Tabla customer_payments no existe o error:', e.message);
      }
    }
    
    // PASO 4: Eliminar créditos relacionados usando SQL directo (SIN transacción)
    if (customerIdsToDelete.length > 0) {
      try {
        await sequelize.query(
          `DELETE FROM customer_credits WHERE customer_id IN (${customerIdsToDelete.join(',')})`
        );
        deletedCredits = creditsCount; // Usar el conteo previo
      } catch (e) {
        console.log('Tabla customer_credits no existe o error:', e.message);
      }
    }
    
    // PASO 5: Eliminar participantes de compras grupales usando SQL directo (SIN transacción)
    if (customerIdsToDelete.length > 0) {
      try {
        await sequelize.query(
          `DELETE FROM group_purchase_participants WHERE customer_id IN (${customerIdsToDelete.join(',')})`
        );
        deletedParticipants = participantsCount; // Usar el conteo previo
      } catch (e) {
        console.log('Tabla group_purchase_participants no existe o error:', e.message);
      }
    }
    
    // PASO 6: Eliminar clientes (excepto el de prueba) - SIN transacción para evitar problemas
    if (customerIdsToDelete.length > 0) {
      deletedCustomers = await Customer.destroy({
        where: {
          id: { [Op.in]: customerIdsToDelete }
        }
      });
    }
    
    // Verificar resultado final
    const remainingCustomers = await Customer.unscoped().count();
    
    let remainingSales = 0;
    let remainingSaleItems = 0;
    try {
      remainingSales = await Sale.count();
    } catch (e) {
      console.log('Error contando sales:', e.message);
    }
    
    try {
      remainingSaleItems = await SaleItem.count();
    } catch (e) {
      console.log('Error contando sale_items:', e.message);
    }
    
    res.json({
      success: true,
      message: 'Limpieza completada exitosamente',
      summary: {
        testCustomer: {
          id: testCustomer.id,
          name: testCustomer.name,
          email: testCustomer.email
        },
        deleted: {
          customers: deletedCustomers,
          sales: deletedSales,
          saleItems: deletedSaleItems,
          payments: deletedPayments,
          credits: deletedCredits,
          participants: deletedParticipants
        },
        remaining: {
          customers: remainingCustomers,
          sales: remainingSales,
          saleItems: remainingSaleItems
        }
      }
    });
    
  } catch (error) {
    await transaction.rollback();
    console.error('Error durante la limpieza:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor',
      message: error.message
    });
  }
});

module.exports = router;
