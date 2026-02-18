-- Estructura básica de la base de datos
-- Este script se ejecuta primero para crear las tablas base

-- Crear tabla products
CREATE TABLE IF NOT EXISTS products (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    name VARCHAR(255) NOT NULL,
    sku VARCHAR(100) NOT NULL,
    product_type VARCHAR(10) NOT NULL DEFAULT 'SIMPLE' 
        CHECK (product_type IN ('SIMPLE', 'COMBO')),
    sale_price DECIMAL(12, 2) NOT NULL,
    cost_mode VARCHAR(10) NOT NULL DEFAULT 'AVERAGE' 
        CHECK (cost_mode IN ('FIFO', 'AVERAGE')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    stock_min DECIMAL(12, 3),
    image_url VARCHAR(500),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Crear índices para products
CREATE INDEX IF NOT EXISTS idx_products_tenant ON products(tenant_id);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_type ON products(product_type);
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_tenant_sku ON products(tenant_id, sku);

-- Crear tabla customers
CREATE TABLE IF NOT EXISTS customers (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    name VARCHAR(255) NOT NULL,
    cedula VARCHAR(50) NOT NULL,
    email VARCHAR(255),
    password_hash VARCHAR(255),
    phone VARCHAR(50),
    address TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Crear índices para customers
CREATE INDEX IF NOT EXISTS idx_customers_tenant ON customers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_cedula ON customers(cedula);
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_tenant_cedula ON customers(tenant_id, cedula);

-- Crear tabla sales
CREATE TABLE IF NOT EXISTS sales (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    customer_id BIGINT,
    status VARCHAR(10) NOT NULL DEFAULT 'PENDING' 
        CHECK (status IN ('PENDING', 'COMPLETED', 'VOIDED')),
    total_amount DECIMAL(12, 2) NOT NULL,
    payment_method VARCHAR(10) NOT NULL 
        CHECK (payment_method IN ('CASH', 'CARD', 'TRANSFER')),
    transfer_reference VARCHAR(100),
    notes TEXT,
    void_reason TEXT,
    voided_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Crear índices para sales
CREATE INDEX IF NOT EXISTS idx_sales_tenant ON sales(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(status);
CREATE INDEX IF NOT EXISTS idx_sales_created ON sales(created_at);

-- Crear tabla sale_items
CREATE TABLE IF NOT EXISTS sale_items (
    id BIGSERIAL PRIMARY KEY,
    sale_id BIGINT NOT NULL,
    tenant_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    quantity DECIMAL(12, 3) NOT NULL,
    unit_price DECIMAL(12, 2) NOT NULL,
    total_price DECIMAL(12, 2) NOT NULL,
    product_type VARCHAR(10) NOT NULL 
        CHECK (product_type IN ('SIMPLE', 'COMBO'))
);

-- Crear índices para sale_items
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_tenant ON sale_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items(product_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_type ON sale_items(product_type);

-- Crear tabla inventory_movements
CREATE TABLE IF NOT EXISTS inventory_movements (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    movement_type VARCHAR(5) NOT NULL 
        CHECK (movement_type IN ('IN', 'OUT')),
    reason VARCHAR(10) NOT NULL 
        CHECK (reason IN ('SALE', 'PURCHASE', 'ADJUST', 'VOID', 'WASTE')),
    qty DECIMAL(12, 3) NOT NULL,
    unit_cost DECIMAL(12, 2),
    ref_type VARCHAR(50),
    ref_id BIGINT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Crear índices para inventory_movements
CREATE INDEX IF NOT EXISTS idx_inventory_tenant ON inventory_movements(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_product ON inventory_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_type ON inventory_movements(movement_type);
CREATE INDEX IF NOT EXISTS idx_inventory_ref ON inventory_movements(ref_type, ref_id);

-- Crear tabla product_components
CREATE TABLE IF NOT EXISTS product_components (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    combo_product_id BIGINT NOT NULL,
    component_product_id BIGINT NOT NULL,
    qty DECIMAL(12, 3) NOT NULL CHECK (qty > 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Foreign keys
    CONSTRAINT fk_product_components_combo 
        FOREIGN KEY (combo_product_id) REFERENCES products(id) ON DELETE CASCADE,
    CONSTRAINT fk_product_components_component 
        FOREIGN KEY (component_product_id) REFERENCES products(id) ON DELETE RESTRICT,
    -- Unique constraint
    CONSTRAINT uq_product_components 
        UNIQUE (tenant_id, combo_product_id, component_product_id)
);

-- Crear índices para product_components
CREATE INDEX IF NOT EXISTS idx_product_components_tenant ON product_components(tenant_id);
CREATE INDEX IF NOT EXISTS idx_product_components_combo ON product_components(combo_product_id);
CREATE INDEX IF NOT EXISTS idx_product_components_component ON product_components(component_product_id);

-- Crear foreign keys adicionales
ALTER TABLE sales ADD CONSTRAINT fk_sales_customer 
    FOREIGN KEY (customer_id) REFERENCES customers(id);

ALTER TABLE sale_items ADD CONSTRAINT fk_sale_items_sale 
    FOREIGN KEY (sale_id) REFERENCES sales(id);

ALTER TABLE sale_items ADD CONSTRAINT fk_sale_items_product 
    FOREIGN KEY (product_id) REFERENCES products(id);

ALTER TABLE inventory_movements ADD CONSTRAINT fk_inventory_product 
    FOREIGN KEY (product_id) REFERENCES products(id);

-- Crear trigger para validar que inventory_movements solo use productos SIMPLE
-- Esto se implementará a nivel de aplicación ya que PostgreSQL no permite subqueries en CHECK constraints

-- Crear tabla suppliers (Proveedores)
CREATE TABLE IF NOT EXISTS suppliers (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    name VARCHAR(255) NOT NULL,
    contact_name VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(50),
    address TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Crear índices para suppliers
CREATE INDEX IF NOT EXISTS idx_suppliers_tenant ON suppliers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_active ON suppliers(is_active);

-- Crear tabla supplier_prices (Precios Históricos de Proveedores)
CREATE TABLE IF NOT EXISTS supplier_prices (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    supplier_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    price DECIMAL(12, 2) NOT NULL,
    effective_date DATE NOT NULL,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- Crear índices para supplier_prices
CREATE INDEX IF NOT EXISTS idx_supplier_prices_tenant ON supplier_prices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_supplier_prices_supplier ON supplier_prices(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_prices_product ON supplier_prices(product_id);
CREATE INDEX IF NOT EXISTS idx_supplier_prices_date ON supplier_prices(effective_date);

-- Crear tabla settings (Configuraciones del Sistema)
CREATE TABLE IF NOT EXISTS settings (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    setting_key VARCHAR(100) NOT NULL,
    setting_value TEXT,
    setting_type VARCHAR(50) DEFAULT 'string',
    description TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, setting_key)
);

-- Crear índices para settings
CREATE INDEX IF NOT EXISTS idx_settings_tenant ON settings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_settings_key ON settings(setting_key);

-- Modificar tabla sales para agregar IVA histórico
ALTER TABLE sales ADD COLUMN IF NOT EXISTS tax_rate DECIMAL(5, 2) DEFAULT 16.00;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS tax_amount DECIMAL(12, 2);

-- Comentarios para documentación
COMMENT ON TABLE products IS 'Productos simples y combos virtuales';
COMMENT ON COLUMN products.product_type IS 'SIMPLE para productos con inventario, COMBO para productos virtuales';
COMMENT ON TABLE product_components IS 'Bill of materials para combos virtuales';
COMMENT ON TABLE inventory_movements IS 'Kardex de movimientos de inventario (solo productos SIMPLE)';
COMMENT ON TABLE suppliers IS 'Proveedores de productos';
COMMENT ON TABLE supplier_prices IS 'Precios históricos de productos por proveedor y fecha';
COMMENT ON TABLE settings IS 'Configuraciones del sistema (IVA, SMTP, etc.)';
COMMENT ON COLUMN sales.tax_rate IS 'Porcentaje de IVA usado en esta venta (histórico)';
COMMENT ON COLUMN sales.tax_amount IS 'Monto de IVA calculado en esta venta (histórico)';