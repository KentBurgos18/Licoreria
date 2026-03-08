/**
 * Script para crear el usuario administrador inicial
 * Uso: node scripts/create-admin-user.js
 */

const bcrypt = require('bcrypt');
const { sequelize, User } = require('../models');

async function createAdminUser() {
    try {
        console.log('🔄 Conectando a la base de datos...');
        await sequelize.authenticate();
        console.log('✅ Conexión establecida');

        // Sincronizar modelo User (crea la tabla si no existe)
        console.log('🔄 Sincronizando modelo User...');
        await User.sync();
        console.log('✅ Modelo sincronizado');

        // Datos del administrador
        const adminData = {
            tenantId: 1,
            name: 'Administrador',
            email: 'admin@locobar.com',
            password: 'Pigmen_1820',
            role: 'ADMIN',
            isActive: true
        };

        // Verificar si ya existe
        const existingAdmin = await User.findOne({
            where: { email: adminData.email, tenantId: adminData.tenantId }
        });

        if (existingAdmin) {
            console.log('⚠️  El usuario administrador ya existe');
            console.log(`   Email: ${existingAdmin.email}`);
            console.log(`   Rol: ${existingAdmin.role}`);
            
            // Preguntar si desea actualizar la contraseña
            const readline = require('readline');
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });

            rl.question('¿Deseas resetear la contraseña a "Pigmen_1820"? (s/n): ', async (answer) => {
                if (answer.toLowerCase() === 's') {
                    const passwordHash = await bcrypt.hash('Pigmen_1820', 10);
                    await existingAdmin.update({ password: passwordHash });
                    console.log('✅ Contraseña actualizada a: Pigmen_1820');
                }
                rl.close();
                process.exit(0);
            });
        } else {
            // Hash de la contraseña
            const passwordHash = await bcrypt.hash(adminData.password, 10);

            // Crear usuario
            const admin = await User.create({
                ...adminData,
                password: passwordHash
            });

            console.log('✅ Usuario administrador creado exitosamente');
            console.log('');
            console.log('📋 Credenciales de acceso:');
            console.log('   Email: admin@locobar.com');
            console.log('   Contraseña: Pigmen_1820');
            console.log('');
            console.log('⚠️  IMPORTANTE: Cambia la contraseña después del primer login');
            
            process.exit(0);
        }
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

createAdminUser();
