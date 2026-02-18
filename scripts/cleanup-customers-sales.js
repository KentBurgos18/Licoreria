const { sequelize, Customer, Sale, SaleItem, CustomerPayment, CustomerCredit, GroupPurchaseParticipant } = require('../models');
require('dotenv').config();

async function cleanupCustomersAndSales() {
  const transaction = await sequelize.transaction();
  
  try {
    console.log('🧹 Iniciando limpieza de clientes y ventas...\n');
    
    // Obtener todos los clientes
    const allCustomers = await Customer.unscoped().findAll({
      attributes: ['id', 'name', 'email', 'cedula', 'isActive'],
      order: [['id', 'ASC']],
      transaction
    });
    
    console.log(`📋 Total de clientes encontrados: ${allCustomers.length}\n`);
    
    if (allCustomers.length === 0) {
      console.log('⚠️  No hay clientes en la base de datos.');
      await transaction.rollback();
      return;
    }
    
    // Mostrar todos los clientes
    console.log('📋 Clientes actuales:');
    allCustomers.forEach((customer, index) => {
      console.log(`   ${index + 1}. ID: ${customer.id} | Nombre: ${customer.name} | Email: ${customer.email || 'N/A'} | Cédula: ${customer.cedula}`);
    });
    
    // El cliente de prueba será el primero (ID más bajo)
    const testCustomer = allCustomers[0];
    console.log(`\n✅ Cliente de prueba que se conservará: ID ${testCustomer.id} - ${testCustomer.name}\n`);
    
    // Obtener IDs de clientes a eliminar
    const customersToDelete = allCustomers.filter(c => c.id !== testCustomer.id);
    const customerIdsToDelete = customersToDelete.map(c => c.id);
    
    console.log(`🗑️  Clientes a eliminar: ${customersToDelete.length}`);
    customersToDelete.forEach(c => {
      console.log(`   - ID: ${c.id} | ${c.name}`);
    });
    
    // Contar registros relacionados antes de eliminar
    console.log('\n📊 Contando registros relacionados...');
    
    const salesCount = await Sale.count({
      where: {
        customerId: { [require('sequelize').Op.in]: customerIdsToDelete }
      },
      transaction
    });
    
    const allSalesCount = await Sale.count({ transaction });
    
    const saleItemsCount = await SaleItem.count({
      include: [{
        model: Sale(sequelize),
        as: 'sale',
        where: {
          customerId: { [require('sequelize').Op.in]: customerIdsToDelete }
        }
      }],
      transaction
    });
    
    const allSaleItemsCount = await SaleItem.count({ transaction });
    
    const paymentsCount = await CustomerPayment.count({
      where: {
        customerId: { [require('sequelize').Op.in]: customerIdsToDelete }
      },
      transaction
    });
    
    const creditsCount = await CustomerCredit.count({
      where: {
        customerId: { [require('sequelize').Op.in]: customerIdsToDelete }
      },
      transaction
    });
    
    const participantsCount = await GroupPurchaseParticipant.count({
      where: {
        customerId: { [require('sequelize').Op.in]: customerIdsToDelete }
      },
      transaction
    });
    
    console.log(`   Ventas relacionadas con clientes a eliminar: ${salesCount}`);
    console.log(`   Total de ventas en el sistema: ${allSalesCount}`);
    console.log(`   Items de ventas relacionadas: ${saleItemsCount}`);
    console.log(`   Total de items de ventas: ${allSaleItemsCount}`);
    console.log(`   Pagos relacionados: ${paymentsCount}`);
    console.log(`   Créditos relacionados: ${creditsCount}`);
    console.log(`   Participantes de compras grupales: ${participantsCount}\n`);
    
    // Confirmar eliminación
    console.log('⚠️  ADVERTENCIA: Se eliminarán:');
    console.log(`   - ${customersToDelete.length} clientes`);
    console.log(`   - ${allSalesCount} ventas (todas las ventas)`);
    console.log(`   - ${allSaleItemsCount} items de ventas (todos los items)`);
    console.log(`   - ${paymentsCount} pagos relacionados`);
    console.log(`   - ${creditsCount} créditos relacionados`);
    console.log(`   - ${participantsCount} participantes de compras grupales\n`);
    
    // PASO 1: Eliminar todos los items de ventas primero (porque tienen FK a sales)
    console.log('🗑️  Paso 1: Eliminando todos los items de ventas...');
    const deletedSaleItems = await SaleItem.destroy({
      where: {},
      transaction
    });
    console.log(`   ✅ Eliminados ${deletedSaleItems} items de ventas\n`);
    
    // PASO 2: Eliminar todas las ventas
    console.log('🗑️  Paso 2: Eliminando todas las ventas...');
    const deletedSales = await Sale.destroy({
      where: {},
      transaction
    });
    console.log(`   ✅ Eliminadas ${deletedSales} ventas\n`);
    
    // PASO 3: Eliminar pagos relacionados con clientes a eliminar
    console.log('🗑️  Paso 3: Eliminando pagos relacionados...');
    const deletedPayments = await CustomerPayment.destroy({
      where: {
        customerId: { [require('sequelize').Op.in]: customerIdsToDelete }
      },
      transaction
    });
    console.log(`   ✅ Eliminados ${deletedPayments} pagos\n`);
    
    // PASO 4: Eliminar créditos relacionados con clientes a eliminar
    console.log('🗑️  Paso 4: Eliminando créditos relacionados...');
    const deletedCredits = await CustomerCredit.destroy({
      where: {
        customerId: { [require('sequelize').Op.in]: customerIdsToDelete }
      },
      transaction
    });
    console.log(`   ✅ Eliminados ${deletedCredits} créditos\n`);
    
    // PASO 5: Eliminar participantes de compras grupales relacionados
    console.log('🗑️  Paso 5: Eliminando participantes de compras grupales...');
    const deletedParticipants = await GroupPurchaseParticipant.destroy({
      where: {
        customerId: { [require('sequelize').Op.in]: customerIdsToDelete }
      },
      transaction
    });
    console.log(`   ✅ Eliminados ${deletedParticipants} participantes\n`);
    
    // PASO 6: Eliminar clientes (excepto el de prueba)
    console.log('🗑️  Paso 6: Eliminando clientes (excepto el de prueba)...');
    const deletedCustomers = await Customer.destroy({
      where: {
        id: { [require('sequelize').Op.in]: customerIdsToDelete }
      },
      transaction
    });
    console.log(`   ✅ Eliminados ${deletedCustomers} clientes\n`);
    
    // Confirmar transacción
    await transaction.commit();
    
    console.log('═'.repeat(60));
    console.log('✅ LIMPIEZA COMPLETADA EXITOSAMENTE');
    console.log('═'.repeat(60));
    console.log(`\n📊 Resumen:`);
    console.log(`   - Clientes eliminados: ${deletedCustomers}`);
    console.log(`   - Cliente conservado: ID ${testCustomer.id} - ${testCustomer.name}`);
    console.log(`   - Ventas eliminadas: ${deletedSales}`);
    console.log(`   - Items de ventas eliminados: ${deletedSaleItems}`);
    console.log(`   - Pagos eliminados: ${deletedPayments}`);
    console.log(`   - Créditos eliminados: ${deletedCredits}`);
    console.log(`   - Participantes eliminados: ${deletedParticipants}\n`);
    
    // Verificar resultado final
    const remainingCustomers = await Customer.unscoped().count();
    const remainingSales = await Sale.count();
    const remainingSaleItems = await SaleItem.count();
    
    console.log('📊 Estado final:');
    console.log(`   - Clientes restantes: ${remainingCustomers}`);
    console.log(`   - Ventas restantes: ${remainingSales}`);
    console.log(`   - Items de ventas restantes: ${remainingSaleItems}\n`);
    
  } catch (error) {
    await transaction.rollback();
    console.error('❌ Error durante la limpieza:', error);
    throw error;
  } finally {
    await sequelize.close();
  }
}

// Ejecutar limpieza
cleanupCustomersAndSales()
  .then(() => {
    console.log('✅ Proceso completado');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
