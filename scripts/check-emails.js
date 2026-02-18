const { sequelize, Customer, User } = require('../models');
require('dotenv').config();

async function checkEmails() {
  try {
    console.log('🔍 Verificando correos en la base de datos...\n');
    
    // Buscar el correo específico
    const searchEmail = 'rogerburgos208@gmail.com';
    const searchEmailTrimmed = searchEmail.trim();
    
    console.log('📧 Correo buscado:', searchEmail);
    console.log('📧 Correo normalizado (trim):', searchEmailTrimmed);
    console.log('─'.repeat(60));
    
    // Buscar en tabla Customer
    console.log('\n📋 TABLA CUSTOMERS:');
    console.log('─'.repeat(60));
    
    const customers = await Customer.unscoped().findAll({
      attributes: ['id', 'name', 'email', 'cedula', 'isActive', 'tenantId'],
      order: [['email', 'ASC']]
    });
    
    console.log(`Total de clientes encontrados: ${customers.length}\n`);
    
    if (customers.length > 0) {
      console.log('Correos en tabla customers:');
      customers.forEach((customer, index) => {
        const email = customer.email || '(sin correo)';
        const match = email.toLowerCase() === searchEmailTrimmed.toLowerCase() ? ' ⭐ COINCIDE' : '';
        const exactMatch = email === searchEmailTrimmed ? ' ✅ EXACTO' : '';
        const trimmedMatch = email.trim() === searchEmailTrimmed ? ' 🔄 CON TRIM' : '';
        
        console.log(`${index + 1}. ID: ${customer.id} | Email: "${email}" | Nombre: ${customer.name} | Activo: ${customer.isActive}${match}${exactMatch}${trimmedMatch}`);
        console.log(`   Longitud email: ${email.length} | Con espacios: ${email !== email.trim() ? 'SÍ' : 'NO'}`);
      });
    } else {
      console.log('No se encontraron clientes en la base de datos.');
    }
    
    // Buscar específicamente el correo en Customer
    console.log('\n🔎 BÚSQUEDA ESPECÍFICA EN CUSTOMERS:');
    console.log('─'.repeat(60));
    
    const customerExact = await Customer.unscoped().findOne({
      where: { email: searchEmail }
    });
    
    const customerTrimmed = await Customer.unscoped().findOne({
      where: { email: searchEmailTrimmed }
    });
    
    const customerCaseInsensitive = await Customer.unscoped().findOne({
      where: sequelize.where(
        sequelize.fn('LOWER', sequelize.col('email')),
        searchEmailTrimmed.toLowerCase()
      )
    });
    
    console.log(`Búsqueda exacta ("${searchEmail}"): ${customerExact ? '✅ ENCONTRADO' : '❌ NO ENCONTRADO'}`);
    if (customerExact) {
      console.log(`   ID: ${customerExact.id} | Nombre: ${customerExact.name} | Email guardado: "${customerExact.email}"`);
    }
    
    console.log(`Búsqueda con trim ("${searchEmailTrimmed}"): ${customerTrimmed ? '✅ ENCONTRADO' : '❌ NO ENCONTRADO'}`);
    if (customerTrimmed) {
      console.log(`   ID: ${customerTrimmed.id} | Nombre: ${customerTrimmed.name} | Email guardado: "${customerTrimmed.email}"`);
    }
    
    console.log(`Búsqueda case-insensitive: ${customerCaseInsensitive ? '✅ ENCONTRADO' : '❌ NO ENCONTRADO'}`);
    if (customerCaseInsensitive) {
      console.log(`   ID: ${customerCaseInsensitive.id} | Nombre: ${customerCaseInsensitive.name} | Email guardado: "${customerCaseInsensitive.email}"`);
    }
    
    // Buscar en tabla User
    console.log('\n📋 TABLA USERS:');
    console.log('─'.repeat(60));
    
    const users = await User.findAll({
      attributes: ['id', 'name', 'email', 'role', 'isActive', 'tenantId'],
      order: [['email', 'ASC']]
    });
    
    console.log(`Total de usuarios encontrados: ${users.length}\n`);
    
    if (users.length > 0) {
      console.log('Correos en tabla users:');
      users.forEach((user, index) => {
        const email = user.email || '(sin correo)';
        const match = email.toLowerCase() === searchEmailTrimmed.toLowerCase() ? ' ⭐ COINCIDE' : '';
        const exactMatch = email === searchEmailTrimmed ? ' ✅ EXACTO' : '';
        
        console.log(`${index + 1}. ID: ${user.id} | Email: "${email}" | Nombre: ${user.name} | Rol: ${user.role} | Activo: ${user.isActive}${match}${exactMatch}`);
      });
    } else {
      console.log('No se encontraron usuarios en la base de datos.');
    }
    
    // Buscar específicamente el correo en User
    console.log('\n🔎 BÚSQUEDA ESPECÍFICA EN USERS:');
    console.log('─'.repeat(60));
    
    const userExact = await User.findOne({
      where: { email: searchEmail }
    });
    
    const userTrimmed = await User.findOne({
      where: { email: searchEmailTrimmed }
    });
    
    console.log(`Búsqueda exacta ("${searchEmail}"): ${userExact ? '✅ ENCONTRADO' : '❌ NO ENCONTRADO'}`);
    if (userExact) {
      console.log(`   ID: ${userExact.id} | Nombre: ${userExact.name} | Email guardado: "${userExact.email}"`);
    }
    
    console.log(`Búsqueda con trim ("${searchEmailTrimmed}"): ${userTrimmed ? '✅ ENCONTRADO' : '❌ NO ENCONTRADO'}`);
    if (userTrimmed) {
      console.log(`   ID: ${userTrimmed.id} | Nombre: ${userTrimmed.name} | Email guardado: "${userTrimmed.email}"`);
    }
    
    // Resumen final
    console.log('\n' + '═'.repeat(60));
    console.log('📊 RESUMEN:');
    console.log('═'.repeat(60));
    
    const foundInCustomers = customerExact || customerTrimmed || customerCaseInsensitive;
    const foundInUsers = userExact || userTrimmed;
    
    if (foundInCustomers) {
      console.log(`✅ El correo "${searchEmail}" SÍ existe en la tabla CUSTOMERS`);
      const foundCustomer = customerExact || customerTrimmed || customerCaseInsensitive;
      console.log(`   ID: ${foundCustomer.id} | Nombre: ${foundCustomer.name}`);
      console.log(`   Email guardado exactamente como: "${foundCustomer.email}"`);
      console.log(`   ¿Coincide exactamente?: ${foundCustomer.email === searchEmailTrimmed ? 'SÍ' : 'NO'}`);
      console.log(`   ¿Coincide con trim?: ${foundCustomer.email.trim() === searchEmailTrimmed ? 'SÍ' : 'NO'}`);
    } else {
      console.log(`❌ El correo "${searchEmail}" NO existe en la tabla CUSTOMERS`);
    }
    
    if (foundInUsers) {
      console.log(`✅ El correo "${searchEmail}" SÍ existe en la tabla USERS`);
      const foundUser = userExact || userTrimmed;
      console.log(`   ID: ${foundUser.id} | Nombre: ${foundUser.name}`);
      console.log(`   Email guardado exactamente como: "${foundUser.email}"`);
    } else {
      console.log(`❌ El correo "${searchEmail}" NO existe en la tabla USERS`);
    }
    
    if (!foundInCustomers && !foundInUsers) {
      console.log('\n⚠️  El correo no se encontró en ninguna tabla.');
      console.log('   Posibles causas:');
      console.log('   1. El correo tiene espacios al inicio o final');
      console.log('   2. El correo tiene diferencias en mayúsculas/minúsculas');
      console.log('   3. El correo realmente no está registrado');
    }
    
  } catch (error) {
    console.error('❌ Error al verificar correos:', error);
  } finally {
    await sequelize.close();
  }
}

checkEmails();
