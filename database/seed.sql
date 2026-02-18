-- =============================================================================
-- SEED PARA EL PRIMER DESPLIEGUE - Sistema de Licorería
-- =============================================================================
-- Ejecutar después de init.sql y de las migraciones (001 a 015).
-- Configuración inicial del tenant_id = 1 y datos de ejemplo opcionales.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. CONFIGURACIÓN INICIAL (settings) - tenant_id = 1
-- -----------------------------------------------------------------------------
-- Si ya existen las claves, no se sobrescriben (idempotente).
INSERT INTO settings (tenant_id, setting_key, setting_value, setting_type, description, updated_at)
VALUES
  (1, 'tax_rate', '16', 'number', 'Porcentaje de IVA (0-100)', NOW()),
  (1, 'brand_slogan', 'Sistema de Licorería', 'string', 'Nombre o eslogan del negocio', NOW()),
  (1, 'page_title_login', 'Iniciar Sesión - LOCOBAR', 'string', 'Título pestaña login', NOW()),
  (1, 'page_title_register', 'Registro - LOCOBAR', 'string', 'Título pestaña registro', NOW()),
  (1, 'page_title_catalog', 'Catálogo - LOCOBAR', 'string', 'Título pestaña catálogo', NOW()),
  (1, 'page_title_cart', 'Carrito - LOCOBAR', 'string', 'Título pestaña carrito', NOW()),
  (1, 'page_title_checkout', 'Checkout - LOCOBAR', 'string', 'Título pestaña checkout', NOW()),
  (1, 'page_title_credits', 'Mis Créditos - LOCOBAR', 'string', 'Título pestaña créditos', NOW()),
  (1, 'page_title_group_purchases', 'Mis Compras Grupales - LOCOBAR', 'string', 'Título pestaña compras grupales', NOW()),
  (1, 'page_title_orders', 'Mis Pedidos - LOCOBAR', 'string', 'Título pestaña pedidos', NOW()),
  (1, 'smtp_from_email', 'noreply@licoreria.com', 'string', 'Email remitente (SMTP)', NOW()),
  (1, 'smtp_from_name', 'Sistema de Licorería', 'string', 'Nombre remitente (SMTP)', NOW()),
  (1, 'email_subject_verification_code', 'Código de Verificación', 'string', 'Asunto email código verificación', NOW()),
  (1, 'email_subject_welcome', 'Bienvenido', 'string', 'Asunto email bienvenida', NOW()),
  (1, 'email_subject_password_reset', 'Código de Recuperación de Contraseña', 'string', 'Asunto email recuperación', NOW()),
  (1, 'email_subject_temporary_password', 'Clave Temporal', 'string', 'Asunto email clave temporal', NOW())
ON CONFLICT (tenant_id, setting_key) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. DATOS DE EJEMPLO (ejecutar una sola vez en primer despliegue)
-- -----------------------------------------------------------------------------
-- Si ya tienes datos, comenta o elimina esta sección para evitar duplicados.

-- Productos simples
INSERT INTO products (tenant_id, name, sku, product_type, sale_price, cost_mode, is_active, stock_min, created_at) VALUES
(1, 'Whisky Johnnie Walker Red Label', 'WJ-001', 'SIMPLE', 45.99, 'AVERAGE', true, 5, NOW()),
(1, 'Vodka Smirnoff', 'VK-001', 'SIMPLE', 25.99, 'AVERAGE', true, 10, NOW()),
(1, 'Tequila Jose Cuervo Especial', 'TQ-001', 'SIMPLE', 35.99, 'AVERAGE', true, 8, NOW()),
(1, 'Ron Bacardi Superior', 'RN-001', 'SIMPLE', 28.99, 'AVERAGE', true, 12, NOW()),
(1, 'Cerveza Heineken 6pack', 'CV-001', 'SIMPLE', 12.99, 'AVERAGE', true, 20, NOW()),
(1, 'Hielos 2kg', 'HL-001', 'SIMPLE', 3.99, 'AVERAGE', true, 50, NOW()),
(1, 'Vasos Plásticos 20un', 'VS-001', 'SIMPLE', 5.99, 'AVERAGE', true, 30, NOW());

-- Movimientos de inventario iniciales
INSERT INTO inventory_movements (tenant_id, product_id, movement_type, reason, qty, unit_cost, created_at) VALUES
(1, 1, 'IN', 'PURCHASE', 50, 35.00, NOW()),
(1, 2, 'IN', 'PURCHASE', 100, 20.00, NOW()),
(1, 3, 'IN', 'PURCHASE', 40, 28.00, NOW()),
(1, 4, 'IN', 'PURCHASE', 60, 22.00, NOW()),
(1, 5, 'IN', 'PURCHASE', 200, 10.00, NOW()),
(1, 6, 'IN', 'PURCHASE', 100, 2.50, NOW()),
(1, 7, 'IN', 'PURCHASE', 150, 4.00, NOW());

-- Combos
INSERT INTO products (tenant_id, name, sku, product_type, sale_price, cost_mode, is_active, created_at) VALUES
(1, 'Pack Fiesta Completo', 'PK-001', 'COMBO', 89.99, 'AVERAGE', true, NOW()),
(1, 'Pack Noche de Juegos', 'PK-002', 'COMBO', 65.99, 'AVERAGE', true, NOW()),
(1, 'Pack Clásico Licor', 'PK-003', 'COMBO', 125.99, 'AVERAGE', true, NOW());

-- Componentes de los combos (IDs 8, 9, 10 = combos recién insertados)
INSERT INTO product_components (tenant_id, combo_product_id, component_product_id, qty, created_at) VALUES
(1, 8, 1, 1, NOW()),
(1, 8, 5, 2, NOW()),
(1, 8, 6, 1, NOW()),
(1, 8, 7, 1, NOW()),
(1, 9, 2, 1, NOW()),
(1, 9, 3, 1, NOW()),
(1, 9, 5, 2, NOW()),
(1, 9, 6, 1, NOW()),
(1, 10, 1, 1, NOW()),
(1, 10, 4, 1, NOW()),
(1, 10, 3, 1, NOW()),
(1, 10, 6, 2, NOW()),
(1, 10, 7, 2, NOW());

-- Cliente de prueba
INSERT INTO customers (tenant_id, name, cedula, email, phone, is_active, created_at) VALUES
(1, 'Cliente Prueba', 'V-12345678', 'cliente@ejemplo.com', '555-1234', true, NOW());
