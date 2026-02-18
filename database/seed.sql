-- Datos de prueba para el sistema de combos

-- Insertar productos simples
INSERT INTO products (tenant_id, name, sku, product_type, sale_price, cost_mode, is_active, stock_min, created_at) VALUES
(1, 'Whisky Johnnie Walker Red Label', 'WJ-001', 'SIMPLE', 45.99, 'AVERAGE', true, 5, NOW()),
(1, 'Vodka Smirnoff', 'VK-001', 'SIMPLE', 25.99, 'AVERAGE', true, 10, NOW()),
(1, 'Tequila Jose Cuervo Especial', 'TQ-001', 'SIMPLE', 35.99, 'AVERAGE', true, 8, NOW()),
(1, 'Ron Bacardi Superior', 'RN-001', 'SIMPLE', 28.99, 'AVERAGE', true, 12, NOW()),
(1, 'Cerveza Heineken 6pack', 'CV-001', 'SIMPLE', 12.99, 'AVERAGE', true, 20, NOW()),
(1, 'Hielos 2kg', 'HL-001', 'SIMPLE', 3.99, 'AVERAGE', true, 50, NOW()),
(1, 'Vasos Plásticos 20un', 'VS-001', 'SIMPLE', 5.99, 'AVERAGE', true, 30, NOW());

-- Insertar movimientos de inventario iniciales
INSERT INTO inventory_movements (tenant_id, product_id, movement_type, reason, qty, unit_cost, created_at) VALUES
(1, 1, 'IN', 'PURCHASE', 50, 35.00, NOW()),
(1, 2, 'IN', 'PURCHASE', 100, 20.00, NOW()),
(1, 3, 'IN', 'PURCHASE', 40, 28.00, NOW()),
(1, 4, 'IN', 'PURCHASE', 60, 22.00, NOW()),
(1, 5, 'IN', 'PURCHASE', 200, 10.00, NOW()),
(1, 6, 'IN', 'PURCHASE', 100, 2.50, NOW()),
(1, 7, 'IN', 'PURCHASE', 150, 4.00, NOW());

-- Insertar combos
INSERT INTO products (tenant_id, name, sku, product_type, sale_price, cost_mode, is_active, created_at) VALUES
(1, 'Pack Fiesta Completo', 'PK-001', 'COMBO', 89.99, 'AVERAGE', true, NOW()),
(1, 'Pack Noche de Juegos', 'PK-002', 'COMBO', 65.99, 'AVERAGE', true, NOW()),
(1, 'Pack Clásico Licor', 'PK-003', 'COMBO', 125.99, 'AVERAGE', true, NOW());

-- Insertar componentes de los combos
INSERT INTO product_components (tenant_id, combo_product_id, component_product_id, qty, created_at) VALUES
-- Pack Fiesta Completo (Whisky + 2 Cervezas + Hielo + Vasos)
(1, 8, 1, 1, NOW()),
(1, 8, 5, 2, NOW()),
(1, 8, 6, 1, NOW()),
(1, 8, 7, 1, NOW()),

-- Pack Noche de Juegos (Vodka + Tequila + 2 Cervezas + Hielo)
(1, 9, 2, 1, NOW()),
(1, 9, 3, 1, NOW()),
(1, 9, 5, 2, NOW()),
(1, 9, 6, 1, NOW()),

-- Pack Clásico Licor (Whisky + Ron + Tequila + Hielo + Vasos)
(1, 10, 1, 1, NOW()),
(1, 10, 4, 1, NOW()),
(1, 10, 3, 1, NOW()),
(1, 10, 6, 2, NOW()),
(1, 10, 7, 2, NOW());

-- Insertar cliente de prueba
INSERT INTO customers (tenant_id, name, cedula, email, phone, is_active, created_at) VALUES
(1, 'Cliente Prueba', 'V-12345678', 'cliente@ejemplo.com', '555-1234', true, NOW());