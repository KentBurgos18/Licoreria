require('dotenv').config();
const { Customer, User, sequelize } = require('../models');
const { Op } = require('sequelize');

async function checkEmail(email) {
  try {
    console.log(`\n🔍 Buscando el correo: ${email}\n`);
    
    // Buscar en la tabla de Customers
    console.log('📋 Buscando en la tabla "customers"...');
    const customers = await Customer.unscoped().findAll({
      where: {
        email: {
          [Op.iLike]: email // Case-insensitive search
        }
      },
      attributes: ['id', 'tenant_id', 'name', 'email', 'cedula', 'phone', 'is_active', 'created_at']
    });

    console.log(`   Encontrados ${customers.length} registro(s) en customers:`);
    if (customers.length > 0) {
      customers.forEach((customer, index) => {
        console.log(`\n   ${index + 1}. Cliente:`);
        console.log(`      ID: ${customer.id}`);
        console.log(`      Tenant ID: ${customer.tenantId}`);
        console.log(`      Nombre: ${customer.name}`);
        console.log(`      Email: ${customer.email}`);
        console.log(`      Cédula: ${customer.cedula}`);
        console.log(`      Teléfono: ${customer.phone || 'N/A'}`);
        console.log(`      Activo: ${customer.isActive ? 'Sí' : 'No'}`);
        console.log(`      Creado: ${customer.createdAt}`);
      });
    } else {
      console.log('   ❌ No se encontró el correo en la tabla customers');
    }

    // Buscar en la tabla de Users
    console.log('\n📋 Buscando en la tabla "users"...');
    const users = await User.findAll({
      where: {
        email: {
          [Op.iLike]: email // Case-insensitive search
        }
      },
      attributes: ['id', 'tenant_id', 'name', 'email', 'role', 'is_active', 'last_login', 'created_at']
    });

    console.log(`   Encontrados ${users.length} registro(s) en users:`);
    if (users.length > 0) {
      users.forEach((user, index) => {
        console.log(`\n   ${index + 1}. Usuario:`);
        console.log(`      ID: ${user.id}`);
        console.log(`      Tenant ID: ${user.tenantId}`);
        console.log(`      Nombre: ${user.name}`);
        console.log(`      Email: ${user.email}`);
        console.log(`      Rol: ${user.role}`);
        console.log(`      Activo: ${user.isActive ? 'Sí' : 'No'}`);
        console.log(`      Último login: ${user.lastLogin || 'Nunca'}`);
        console.log(`      Creado: ${user.createdAt}`);
      });
    } else {
      console.log('   ❌ No se encontró el correo en la tabla users');
    }

    // Verificación exacta (case-sensitive)
    console.log('\n🔎 Verificación exacta (case-sensitive)...');
    const exactCustomer = await Customer.unscoped().findOne({
      where: { email: email }
    });
    const exactUser = await User.findOne({
      where: { email: email }
    });

    console.log(`   Customer (exacto): ${exactCustomer ? '✅ Encontrado' : '❌ No encontrado'}`);
    console.log(`   User (exacto): ${exactUser ? '✅ Encontrado' : '❌ No encontrado'}`);

    // Resumen
    console.log('\n' + '='.repeat(60));
    console.log('📊 RESUMEN:');
    console.log('='.repeat(60));
    const totalFound = customers.length + users.length;
    if (totalFound > 0) {
      console.log(`✅ El correo "${email}" existe en la base de datos`);
      console.log(`   - En customers: ${customers.length} registro(s)`);
      console.log(`   - En users: ${users.length} registro(s)`);
    } else {
      console.log(`❌ El correo "${email}" NO existe en la base de datos`);
    }
    console.log('='.repeat(60) + '\n');

  } catch (error) {
    console.error('❌ Error al verificar el correo:', error);
  } finally {
    await sequelize.close();
  }
}

// Ejecutar la verificación
const emailToCheck = 'rogerburgos208@gmail.com';
checkEmail(emailToCheck);
