// Script simple para agregar columna cedula usando Sequelize sync
const { sequelize, Customer } = require('../models');

async function addCedulaColumn() {
  try {
    console.log('🔄 Conectando a la base de datos...');
    await sequelize.authenticate();
    console.log('✅ Conexión establecida');

    console.log('🔄 Agregando columna cedula...');
    
    // Usar alter: true para agregar la columna sin perder datos
    await sequelize.sync({ alter: true });
    
    console.log('✅ Columna cedula agregada (o ya existe)');
    
    // Verificar que existe
    const [results] = await sequelize.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'customers' AND column_name = 'cedula'
    `);

    if (results.length > 0) {
      console.log('✅ Columna "cedula" verificada:');
      console.log(`   Tipo: ${results[0].data_type}`);
      console.log(`   Nullable: ${results[0].is_nullable}`);
      
      // Actualizar registros existentes
      console.log('🔄 Actualizando registros existentes...');
      await sequelize.query(`
        UPDATE customers 
        SET cedula = 'TEMP-' || id::text 
        WHERE cedula IS NULL OR cedula = ''
      `);
      console.log('✅ Registros actualizados');
      
      // Crear índice único si no existe
      try {
        await sequelize.query(`
          CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_tenant_cedula 
          ON customers(tenant_id, cedula)
        `);
        console.log('✅ Índice único creado');
      } catch (err) {
        if (err.message.includes('already exists')) {
          console.log('⚠️  Índice ya existe');
        } else {
          throw err;
        }
      }
    } else {
      console.log('⚠️  Columna no encontrada después de sync');
    }

    await sequelize.close();
    console.log('\n✅ Proceso completado. Reinicia el servidor.');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.message.includes('password')) {
      console.error('\n💡 Error de autenticación. Verifica tus credenciales en .env');
      console.error('   Variables necesarias:');
      console.error('   - DB_HOST');
      console.error('   - DB_PORT');
      console.error('   - DB_NAME');
      console.error('   - DB_USER');
      console.error('   - DB_PASSWORD');
    }
    await sequelize.close();
    process.exit(1);
  }
}

addCedulaColumn();
