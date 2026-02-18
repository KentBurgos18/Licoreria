const { sequelize } = require('../models');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  try {
    console.log('🔄 Conectando a la base de datos...');
    await sequelize.authenticate();
    console.log('✅ Conexión establecida');

    console.log('🔄 Ejecutando migración de cédula...');
    
    // Leer el archivo de migración
    const migrationSQL = fs.readFileSync(
      path.join(__dirname, '../database/migrations/005_add_customer_cedula.sql'),
      'utf8'
    );

    // Ejecutar cada comando SQL
    const commands = migrationSQL
      .split(';')
      .map(cmd => cmd.trim())
      .filter(cmd => cmd.length > 0 && !cmd.startsWith('--'));

    for (const command of commands) {
      if (command.trim()) {
        try {
          await sequelize.query(command + ';');
          console.log(`✅ Ejecutado: ${command.substring(0, 50)}...`);
        } catch (error) {
          // Ignorar errores de "ya existe" o "IF NOT EXISTS"
          if (error.message.includes('already exists') || 
              error.message.includes('duplicate') ||
              error.message.includes('IF NOT EXISTS')) {
            console.log(`⚠️  Ya existe: ${command.substring(0, 50)}...`);
          } else {
            throw error;
          }
        }
      }
    }

    console.log('✅ Migración completada exitosamente');
    console.log('\n📋 Verificando que la columna existe...');
    
    const [results] = await sequelize.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'customers' AND column_name = 'cedula'
    `);

    if (results.length > 0) {
      console.log('✅ Columna "cedula" existe en la tabla customers');
      console.log(`   Tipo: ${results[0].data_type}`);
    } else {
      console.log('⚠️  Columna "cedula" no encontrada (puede que necesites reiniciar)');
    }

    await sequelize.close();
    console.log('\n✅ Proceso completado. Puedes reiniciar el servidor ahora.');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error ejecutando migración:', error.message);
    console.error(error);
    await sequelize.close();
    process.exit(1);
  }
}

runMigration();
