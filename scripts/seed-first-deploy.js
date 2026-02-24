/**
 * Script para el primer despliegue: ejecuta migraciones, seed y crea el usuario admin.
 * Uso: node scripts/seed-first-deploy.js
 *
 * Requiere: .env con DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
 * Orden: init (solo si se indica) → migraciones 001-015 → seed.sql → create-admin-user
 */

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { sequelize } = require('../models');

const ROOT = path.join(__dirname, '..');
const DB_DIR = path.join(ROOT, 'database');
const MIGRATIONS_DIR = path.join(DB_DIR, 'migrations');

// Orden exacto de migraciones (algunos números se repiten)
const MIGRATION_ORDER = [
  '001_add_product_type_to_products.sql',
  '002_create_product_components.sql',
  '003_add_simple_product_constraint.sql',
  '004_add_customer_password.sql',
  '005_add_customer_cedula.sql',
  '006_add_image_url_to_products.sql',
  '006_create_group_purchases.sql',
  '007_create_group_purchase_participants.sql',
  '008_create_customer_payments.sql',
  '009_add_transfer_reference_to_sales.sql',
  '009_create_customer_credits.sql',
  '011_add_oauth_to_customers.sql',
  '012_create_users.sql',
  '013_create_notifications.sql',
  '014_create_push_subscriptions.sql',
  '015_create_payphone_pending_payments.sql',
  '016_create_payphone_pending_payments.sql',
  '017_create_product_categories.sql',
  '018_inventory_pool_and_presentations.sql',
  '019_add_tax_applies_to_products.sql',
  '020_add_payment_method_group_purchase_participants.sql',
  '021_allow_null_product_id_group_purchases.sql',
  '022_add_ruc_creditdays_to_suppliers.sql',
  '023_create_purchase_orders.sql',
  '024_add_purchase_order_id_to_movements.sql',
  '025_create_purchase_order_items.sql'
];

async function runSqlFile(filePath) {
  const sql = fs.readFileSync(filePath, 'utf8');
  await sequelize.query(sql);
}

async function main() {
  console.log('=== Seed primer despliegue - Sistema de Licorería ===\n');

  try {
    console.log('🔄 Conectando a la base de datos...');
    await sequelize.authenticate();
    console.log('✅ Conexión OK\n');

    console.log('🔄 Ejecutando migraciones...');
    for (const name of MIGRATION_ORDER) {
      const filePath = path.join(MIGRATIONS_DIR, name);
      if (!fs.existsSync(filePath)) {
        console.warn(`   ⚠️  No encontrado: ${name}`);
        continue;
      }
      try {
        await runSqlFile(filePath);
        console.log(`   ✅ ${name}`);
      } catch (err) {
        if (err.message && (err.message.includes('already exists') || err.message.includes('duplicate'))) {
          console.log(`   ⏭️  ${name} (ya aplicada)`);
        } else {
          throw err;
        }
      }
    }

    console.log('\n🔄 Ejecutando seed.sql...');
    const seedPath = path.join(DB_DIR, 'seed.sql');
    if (fs.existsSync(seedPath)) {
      try {
        await runSqlFile(seedPath);
        console.log('   ✅ seed.sql');
      } catch (err) {
        if (err.message && (err.message.includes('duplicate key') || err.message.includes('unique constraint'))) {
          console.log('   ⏭️  seed.sql (datos de ejemplo ya existían; configuración aplicada si correspondía)');
        } else {
          throw err;
        }
      }
    } else {
      console.warn('   ⚠️  database/seed.sql no encontrado');
    }

    console.log('\n🔄 Creando usuario administrador...');
    const result = spawnSync('node', [path.join(__dirname, 'create-admin-user.js')], {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, SEED_FIRST_DEPLOY: '1' }
    });
    if (result.status !== 0) {
      console.warn('   ⚠️  create-admin-user terminó con código', result.status);
      console.log('   Puedes ejecutar después: node scripts/create-admin-user.js');
    }

    console.log('\n=== Primer despliegue completado ===');
    console.log('   - Configuración inicial (settings) cargada.');
    console.log('   - Datos de ejemplo cargados (productos, combos, cliente).');
    console.log('   - Acceso admin: node scripts/create-admin-user.js si no se creó el usuario.');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    if (process.env.NODE_ENV === 'development') console.error(err);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

main();
