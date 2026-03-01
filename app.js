const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const http = require('http');
const cors = require('cors');
const jwt = require('jsonwebtoken');

// VAPID keys para Web Push (generar si no están en .env); no bloquear arranque si falla
try {
  const webpush = require('web-push');
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    const keys = webpush.generateVAPIDKeys();
    process.env.VAPID_PUBLIC_KEY = keys.publicKey;
    process.env.VAPID_PRIVATE_KEY = keys.privateKey;
    console.log('📌 VAPID keys generadas. Para producción añade a .env:');
    console.log('   VAPID_PUBLIC_KEY=' + keys.publicKey);
    console.log('   VAPID_PRIVATE_KEY=' + keys.privateKey);
  }
} catch (e) {
  console.warn('⚠️ Web Push no disponible:', e.message);
}

const { sequelize, Setting, Sale } = require('./models');
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Import routes
const productsRouter = require('./routes/products');
const productComponentsRouter = require('./routes/productComponents');
const productAvailabilityRouter = require('./routes/productAvailability');
const salesRouter = require('./routes/sales');
const salesVoidRouter = require('./routes/salesVoid');
const reportsRouter = require('./routes/reports');
const { router: authRouter } = require('./routes/auth');
const { router: adminAuthRouter, authenticateAdmin } = require('./routes/adminAuth');
const customerRouter = require('./routes/customer');
const session = require('express-session');
const { configurePassport, passport } = require('./config/passport');

const app = express();
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server, {
  cors: { origin: '*' }
});
app.set('io', io);

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Referrer-Policy requerida por Payphone SDK para evitar errores de acceso denegado
app.use((req, res, next) => {
    res.setHeader('Referrer-Policy', 'origin-when-cross-origin');
    next();
});

// Session for Passport OAuth
app.use(session({
    secret: process.env.SESSION_SECRET || 'licoreria-session-secret-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());
configurePassport();

// Create uploads directory if it doesn't exist
const fs = require('node:fs');
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// View routes (ANTES del middleware estático para que tengan prioridad)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

// API pública: cuentas bancarias para transferencia (sin auth)
app.get('/api/public/bank-accounts', async (req, res) => {
  try {
    const raw = await Setting.getSetting(1, 'bank_accounts', '[]');
    let accounts = [];
    try { accounts = JSON.parse(raw); } catch(e) { accounts = []; }
    res.json({ accounts });
  } catch (err) {
    console.error('Error getting bank-accounts:', err);
    res.json({ accounts: [] });
  }
});

// API pública: texto/eslogan y títulos de pestaña para login y páginas (sin auth)
app.get('/api/public/brand-slogan', async (req, res) => {
  try {
    const brandSlogan = await Setting.getSetting(1, 'brand_slogan', 'Sistema de Licorería');
    const pageTitleLogin = await Setting.getSetting(1, 'page_title_login', 'Iniciar Sesión - LOCOBAR');
    const pageTitleRegister = await Setting.getSetting(1, 'page_title_register', 'Registro - LOCOBAR');
    const pageTitleCatalog = await Setting.getSetting(1, 'page_title_catalog', 'Catálogo - LOCOBAR');
    const pageTitleCart = await Setting.getSetting(1, 'page_title_cart', 'Carrito - LOCOBAR');
    const pageTitleCheckout = await Setting.getSetting(1, 'page_title_checkout', 'Checkout - LOCOBAR');
    const pageTitleCredits = await Setting.getSetting(1, 'page_title_credits', 'Mis Créditos - LOCOBAR');
    const pageTitleGroupPurchases = await Setting.getSetting(1, 'page_title_group_purchases', 'Mis Compras Grupales - LOCOBAR');
    const pageTitleOrders = await Setting.getSetting(1, 'page_title_orders', 'Mis Pedidos - LOCOBAR');
    res.json({
      brandSlogan,
      pageTitleLogin,
      pageTitleRegister,
      pageTitleCatalog,
      pageTitleCart,
      pageTitleCheckout,
      pageTitleCredits,
      pageTitleGroupPurchases,
      pageTitleOrders
    });
  } catch (err) {
    console.error('Error getting brand-slogan:', err);
    res.json({
      brandSlogan: 'Sistema de Licorería',
      pageTitleLogin: 'Iniciar Sesión - LOCOBAR',
      pageTitleRegister: 'Registro - LOCOBAR',
      pageTitleCatalog: 'Catálogo - LOCOBAR',
      pageTitleCart: 'Carrito - LOCOBAR',
      pageTitleCheckout: 'Checkout - LOCOBAR',
      pageTitleCredits: 'Mis Créditos - LOCOBAR',
      pageTitleGroupPurchases: 'Mis Compras Grupales - LOCOBAR',
      pageTitleOrders: 'Mis Pedidos - LOCOBAR'
    });
  }
});

// API pública: descuento por efectivo/transferencia
app.get('/api/public/discount-rate', async (req, res) => {
  try {
    const tenantId = parseInt(req.query.tenantId, 10) || 1;
    const value = await Setting.getSetting(tenantId, 'cash_transfer_discount_rate');
    const num = value != null ? parseFloat(value) : NaN;
    const configured = !isNaN(num) && num >= 0 && num <= 100;
    res.json({ value: configured ? num : 0, configured });
  } catch (err) {
    console.error('Error getting discount-rate:', err);
    res.json({ value: 0, configured: false });
  }
});

// API pública: IVA (tax_rate) desde Configuración; sin valor por defecto
app.get('/api/public/tax-rate', async (req, res) => {
  try {
    const tenantId = parseInt(req.query.tenantId, 10) || 1;
    const value = await Setting.getSetting(tenantId, 'tax_rate');
    const num = value != null ? parseFloat(value) : NaN;
    const configured = !isNaN(num) && num >= 0 && num <= 100;
    const enabledRaw = await Setting.getSetting(tenantId, 'tax_enabled', 'true');
    const enabled = enabledRaw === 'true' || enabledRaw === true;
    res.json({ value: configured ? num : null, configured, enabled });
  } catch (err) {
    console.error('Error getting public tax-rate:', err);
    res.json({ value: null, configured: false, enabled: false });
  }
});

// API pública: clave VAPID para suscripción Web Push (frontend)
app.get('/api/public/vapid-public-key', (req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) {
    return res.status(503).json({ error: 'Web Push no configurado' });
  }
  res.json({ publicKey: key });
});

// API pública: categorías de producto (sin auth, para catálogo de clientes)
app.get('/api/public/product-categories', async (req, res) => {
  try {
    const tenantId = parseInt(req.query.tenantId, 10) || 1;
    const { ProductCategory } = require('./models');
    const categories = await ProductCategory.findAll({
      where: { tenantId },
      order: [['sortOrder', 'ASC'], ['name', 'ASC']]
    });
    res.json({ categories });
  } catch (err) {
    console.error('Error getting public categories:', err);
    res.json({ categories: [] });
  }
});

// API pública: presentaciones de producto (sin auth, para catálogo de clientes)
app.get('/api/public/product-presentations', async (req, res) => {
  try {
    const tenantId = parseInt(req.query.tenantId, 10) || 1;
    const { ProductPresentation } = require('./models');
    const presentations = await ProductPresentation.findAll({
      where: { tenantId },
      order: [['sortOrder', 'ASC'], ['name', 'ASC']]
    });
    res.json({ presentations });
  } catch (err) {
    console.error('Error getting public presentations:', err);
    res.json({ presentations: [] });
  }
});

// API pública: proxy BIN lookup (evita CORS del browser al llamar binlist.net)
app.get('/api/public/bin/:bin', async (req, res) => {
  const bin = req.params.bin.replace(/\D/g, '').substring(0, 8);
  if (bin.length < 6) return res.status(400).json({ error: 'BIN inválido' });
  try {
    const r = await fetch(`https://lookup.binlist.net/${bin}`, {
      headers: { 'Accept-Version': '3', 'Accept': 'application/json' }
    });
    if (!r.ok) return res.json({});
    const data = await r.json();
    res.json({
      bank: data.bank ? (data.bank.name || '') : '',
      type: data.type || '',   // 'debit' | 'credit' | 'prepaid'
      brand: data.brand || ''
    });
  } catch (e) {
    res.json({});
  }
});

// Service Worker para Web Push (debe estar en raíz para scope correcto)
app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});

// Rutas SPA cliente (ANTES de static para que no sirva catalog.html, cart.html, etc. como archivos)
function sendCustomerView(req, res, viewFile) {
  const wantFragment = req.get('X-SPA-Fragment') || req.xhr;
  if (wantFragment) {
    res.sendFile(path.join(__dirname, 'views', 'customer', viewFile));
  } else {
    res.sendFile(path.join(__dirname, 'views', 'customer', 'customer-app.html'));
  }
}
app.get('/customer', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'customer', 'customer-app.html'));
});
app.get('/customer/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'login.html'));
});
app.get('/customer/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'customer', 'register.html'));
});
app.get('/customer/catalog', (req, res) => sendCustomerView(req, res, 'catalog.html'));
app.get('/customer/cart', (req, res) => sendCustomerView(req, res, 'cart.html'));
app.get('/customer/checkout', (req, res) => sendCustomerView(req, res, 'checkout.html'));
app.get('/customer/checkout/resultado', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'customer', 'checkout-resultado.html'));
});
app.get('/customer/orders', (req, res) => sendCustomerView(req, res, 'orders.html'));
app.get('/customer/credits', (req, res) => sendCustomerView(req, res, 'credits.html'));
app.get('/customer/group-purchases', (req, res) => sendCustomerView(req, res, 'group-purchases.html'));
// Redirigir /customer/xxx.html -> /customer/xxx para que siempre entren al SPA
app.get('/customer/catalog.html', (req, res) => res.redirect(302, '/customer/catalog'));
app.get('/customer/cart.html', (req, res) => res.redirect(302, '/customer/cart'));
app.get('/customer/checkout.html', (req, res) => res.redirect(302, '/customer/checkout'));
app.get('/customer/checkout/resultado.html', (req, res) => res.redirect(302, '/customer/checkout/resultado'));
app.get('/customer/orders.html', (req, res) => res.redirect(302, '/customer/orders'));
app.get('/customer/credits.html', (req, res) => res.redirect(302, '/customer/credits'));
app.get('/customer/group-purchases.html', (req, res) => res.redirect(302, '/customer/group-purchases'));
app.get('/customer/oauth-callback', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'customer', 'oauth-callback.html'));
});
app.get('/customer/oauth-callback.html', (req, res) => res.redirect(302, '/customer/oauth-callback'));

// Static files (DESPUÉS de las rutas específicas)
app.use('/js', express.static(path.join(__dirname, 'public', 'js')));
app.use(express.static(path.join(__dirname, 'views')));

// Archivos estáticos públicos (logo, etc.)
app.use('/public', express.static(path.join(__dirname, 'public')));

// Favicon para navegadores que piden /favicon.ico
app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'img', 'pestana-LB.png'));
});

// Serve local libraries (Bootstrap, jQuery, etc.)
app.use('/libs', express.static(path.join(__dirname, 'public', 'libs')));

// Serve uploaded images
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// API Routes (dashboard APIs protegidas con authenticateAdmin)
app.use('/api/products', authenticateAdmin, productsRouter);
app.use('/api/products', authenticateAdmin, productComponentsRouter);
app.use('/api/products', authenticateAdmin, productAvailabilityRouter);
app.use('/api/product-categories', authenticateAdmin, require('./routes/productCategories'));
app.use('/api/product-presentations', authenticateAdmin, require('./routes/productPresentations'));
app.use('/api/sales', authenticateAdmin, salesRouter);
app.use('/api/sales', authenticateAdmin, salesVoidRouter);
app.use('/api/purchases', authenticateAdmin, require('./routes/purchases'));
app.use('/api/users', authenticateAdmin, require('./routes/users'));
app.use('/api/roles', authenticateAdmin, require('./routes/roles'));
app.use('/api/expenses', authenticateAdmin, require('./routes/expenses'));
app.use('/api/group-purchases', authenticateAdmin, require('./routes/groupPurchases'));
app.use('/api/customer-payments', authenticateAdmin, require('./routes/customerPayments'));
app.use('/api/customer-credits', authenticateAdmin, require('./routes/customerCredits'));
app.use('/api/reports', authenticateAdmin, reportsRouter);
app.use('/api/auth', authRouter);
app.use('/api/admin/auth', adminAuthRouter);
app.use('/api/customer', customerRouter);
app.use('/api/customers', authenticateAdmin, require('./routes/customers'));
app.use('/api/suppliers', authenticateAdmin, require('./routes/suppliers'));
app.use('/api/supplier-prices', authenticateAdmin, require('./routes/supplierPrices'));
app.use('/api/settings', authenticateAdmin, require('./routes/settings'));
app.use('/api/notifications', authenticateAdmin, require('./routes/notifications'));
app.use('/api/email', require('./routes/email'));
app.use('/api/backup', authenticateAdmin, require('./routes/backup'));

// View routes (continuación - rutas adicionales)
app.get('/dashboard.html', (req, res) => res.redirect(302, '/dashboard'));

// Dashboard con rutas reales (para uso online)
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

app.get('/dashboard/products', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

app.get('/dashboard/suppliers', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

app.get('/dashboard/purchases', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

app.get('/dashboard/sell', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

app.get('/dashboard/sales', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

app.get('/dashboard/group-purchases', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

app.get('/dashboard/credits', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

app.get('/dashboard/customers', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

app.get('/dashboard/users', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

app.get('/dashboard/settings', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

app.get('/dashboard/expenses', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

app.get('/products', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'create-product.html'));
});

app.get('/products/edit', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'edit-combo.html'));
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    code: 'NOT_FOUND'
  });
});

// Initialize database and start server
async function initializeApp() {
  try {
    // Test database connection
    await sequelize.authenticate();
    console.log('✅ Database connection established successfully');

    // Asegurar que la tabla users existe (migración 013)
    try {
      const [uTbl] = await sequelize.query(`
        SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users'
      `);
      if (!uTbl || uTbl.length === 0) {
        console.log('🔄 Creando tabla users...');
        await sequelize.query(`
          CREATE TABLE IF NOT EXISTS users (
            id BIGSERIAL PRIMARY KEY,
            tenant_id BIGINT NOT NULL DEFAULT 1,
            name VARCHAR(100) NOT NULL,
            email VARCHAR(150) NOT NULL,
            password VARCHAR(255) NOT NULL,
            role VARCHAR(20) NOT NULL DEFAULT 'CASHIER' CHECK (role IN ('ADMIN', 'MANAGER', 'CASHIER')),
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            last_login TIMESTAMP WITH TIME ZONE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          )
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id)`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
        await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tenant_email ON users(tenant_id, email)`);
        console.log('✅ Tabla users creada');
      }
    } catch (e) {
      console.warn('⚠️ No se pudo crear/verificar tabla users:', e.message);
    }

    // Asegurar que la tabla group_purchases existe (migración 007)
    try {
      const [gpTbl] = await sequelize.query(`
        SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'group_purchases'
      `);
      if (!gpTbl || gpTbl.length === 0) {
        console.log('🔄 Creando tabla group_purchases...');
        await sequelize.query(`
          CREATE TABLE IF NOT EXISTS group_purchases (
            id BIGSERIAL PRIMARY KEY,
            tenant_id BIGINT NOT NULL,
            sale_id BIGINT NOT NULL,
            product_id BIGINT,
            quantity DECIMAL(12, 3) NOT NULL DEFAULT 1,
            total_amount DECIMAL(12, 2) NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
              CHECK (status IN ('PENDING', 'PARTIAL', 'COMPLETED', 'CANCELLED')),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            completed_at TIMESTAMP WITH TIME ZONE,
            CONSTRAINT fk_group_purchases_sale FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE RESTRICT
          )
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_group_purchases_tenant ON group_purchases(tenant_id)`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_group_purchases_sale ON group_purchases(sale_id)`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_group_purchases_status ON group_purchases(status)`);
        console.log('✅ Tabla group_purchases creada');
      }
    } catch (e) {
      console.warn('⚠️ No se pudo crear/verificar tabla group_purchases:', e.message);
    }

    // Asegurar que la tabla group_purchase_participants existe (migración 008)
    try {
      const [gppTbl] = await sequelize.query(`
        SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'group_purchase_participants'
      `);
      if (!gppTbl || gppTbl.length === 0) {
        console.log('🔄 Creando tabla group_purchase_participants...');
        await sequelize.query(`
          CREATE TABLE IF NOT EXISTS group_purchase_participants (
            id BIGSERIAL PRIMARY KEY,
            group_purchase_id BIGINT NOT NULL,
            customer_id BIGINT NOT NULL,
            amount_due DECIMAL(12, 2) NOT NULL,
            amount_paid DECIMAL(12, 2) NOT NULL DEFAULT 0,
            status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
              CHECK (status IN ('PENDING', 'PARTIAL', 'PAID', 'OVERDUE')),
            due_date DATE,
            interest_rate DECIMAL(5, 4) NOT NULL DEFAULT 0,
            interest_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
            payment_method VARCHAR(20) NOT NULL DEFAULT 'CREDIT'
              CONSTRAINT chk_gpp_payment_method CHECK (payment_method IN ('CASH', 'TRANSFER', 'CREDIT')),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            paid_at TIMESTAMP WITH TIME ZONE,
            CONSTRAINT fk_gpp_group_purchase FOREIGN KEY (group_purchase_id) REFERENCES group_purchases(id) ON DELETE CASCADE,
            CONSTRAINT fk_gpp_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT
          )
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_gpp_group_purchase ON group_purchase_participants(group_purchase_id)`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_gpp_customer ON group_purchase_participants(customer_id)`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_gpp_status ON group_purchase_participants(status)`);
        console.log('✅ Tabla group_purchase_participants creada');
      }
    } catch (e) {
      console.warn('⚠️ No se pudo crear/verificar tabla group_purchase_participants:', e.message);
    }

    // Asegurar que la tabla notifications existe (pago efectivo pendiente de confirmar)
    try {
      const [r] = await sequelize.query(`
        SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'notifications'
      `);
      if (!r || r.length === 0) {
        console.log('🔄 Creando tabla notifications...');
        await sequelize.query(`
          CREATE TABLE IF NOT EXISTS notifications (
            id BIGSERIAL PRIMARY KEY,
            tenant_id BIGINT NOT NULL DEFAULT 1,
            user_id BIGINT NOT NULL,
            type VARCHAR(50) NOT NULL DEFAULT 'CASH_CONFIRMATION',
            sale_id BIGINT NOT NULL,
            title VARCHAR(255),
            body TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            read_at TIMESTAMP WITH TIME ZONE,
            metadata JSONB
          )
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_notifications_tenant ON notifications(tenant_id)`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id)`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_notifications_sale ON notifications(sale_id)`);
        console.log('✅ Tabla notifications creada');
      }
    } catch (e) {
      console.warn('⚠️ No se pudo crear/verificar tabla notifications:', e.message);
    }

    // Asegurar que la tabla push_subscriptions existe (Web Push)
    try {
      const [r2] = await sequelize.query(`
        SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'push_subscriptions'
      `);
      if (!r2 || r2.length === 0) {
        console.log('🔄 Creando tabla push_subscriptions...');
        await sequelize.query(`
          CREATE TABLE IF NOT EXISTS push_subscriptions (
            id BIGSERIAL PRIMARY KEY,
            user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            tenant_id BIGINT NOT NULL DEFAULT 1,
            endpoint TEXT NOT NULL,
            p256dh VARCHAR(255) NOT NULL,
            auth VARCHAR(255) NOT NULL,
            user_agent TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, endpoint)
          )
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id)`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_push_subscriptions_tenant ON push_subscriptions(tenant_id)`);
        console.log('✅ Tabla push_subscriptions creada');
      }
    } catch (e) {
      console.warn('⚠️ No se pudo crear/verificar tabla push_subscriptions:', e.message);
    }

    // Asegurar que la tabla payphone_pending_payments existe (PayPhone Cajita)
    try {
      const [r3] = await sequelize.query(`
        SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'payphone_pending_payments'
      `);
      if (!r3 || r3.length === 0) {
        console.log('🔄 Creando tabla payphone_pending_payments...');
        await sequelize.query(`
          CREATE TABLE IF NOT EXISTS payphone_pending_payments (
            id BIGSERIAL PRIMARY KEY,
            client_transaction_id VARCHAR(50) NOT NULL UNIQUE,
            tenant_id BIGINT NOT NULL,
            customer_id BIGINT NOT NULL,
            items_json JSONB NOT NULL,
            subtotal DECIMAL(12, 2) NOT NULL,
            tax_amount DECIMAL(12, 2) NOT NULL,
            total_amount DECIMAL(12, 2) NOT NULL,
            tax_rate DECIMAL(5, 2) NOT NULL,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_payphone_pending_client_tx ON payphone_pending_payments(client_transaction_id)`);
        console.log('✅ Tabla payphone_pending_payments creada');
      }
    } catch (e) {
      console.warn('⚠️ No se pudo crear/verificar tabla payphone_pending_payments:', e.message);
    }

    // Asegurar que products tiene category_id (migración 017)
    try {
      const [col] = await sequelize.query(`
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'category_id'
      `);
      if (!col || col.length === 0) {
        console.log('🔄 Aplicando migración 017 (product_categories)...');
        await sequelize.query(`
          CREATE TABLE IF NOT EXISTS product_categories (
            id BIGSERIAL PRIMARY KEY,
            tenant_id BIGINT NOT NULL DEFAULT 1,
            name VARCHAR(100) NOT NULL,
            sort_order INT NOT NULL DEFAULT 0,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          )
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_product_categories_tenant ON product_categories(tenant_id)`);
        await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_product_categories_tenant_name ON product_categories(tenant_id, LOWER(TRIM(name)))`);
        await sequelize.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS category_id BIGINT REFERENCES product_categories(id) ON DELETE SET NULL`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id)`);
        console.log('✅ Migración 017 aplicada');
      }
    } catch (e) {
      console.warn('⚠️ Migración 017 (category_id):', e.message);
    }

    // Migración 018: product_presentations y columnas pool en products
    try {
      const [ppCol] = await sequelize.query(`
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'base_product_id'
      `);
      if (!ppCol || ppCol.length === 0) {
        console.log('🔄 Aplicando migración 018 (inventory pool & presentations)...');
        await sequelize.query(`
          CREATE TABLE IF NOT EXISTS product_presentations (
            id BIGSERIAL PRIMARY KEY,
            tenant_id BIGINT NOT NULL DEFAULT 1,
            name VARCHAR(100) NOT NULL,
            units_per_sale DECIMAL(12, 3) NOT NULL DEFAULT 1,
            sort_order INT NOT NULL DEFAULT 0,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          )
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_product_presentations_tenant ON product_presentations(tenant_id)`);
        await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_product_presentations_tenant_name ON product_presentations(tenant_id, LOWER(TRIM(name)))`);
        await sequelize.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS base_product_id BIGINT REFERENCES products(id) ON DELETE SET NULL`);
        await sequelize.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS presentation_id BIGINT REFERENCES product_presentations(id) ON DELETE SET NULL`);
        await sequelize.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS units_per_sale DECIMAL(12,3) NOT NULL DEFAULT 1`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_products_base_product ON products(base_product_id)`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_products_presentation ON products(presentation_id)`);
        console.log('✅ Migración 018 aplicada');
      }
    } catch (e) {
      console.warn('⚠️ Migración 018 (inventory pool):', e.message);
    }

    // Migración 019: tax_applies en products + setting tax_enabled
    try {
      const [taxCol] = await sequelize.query(`
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'tax_applies'
      `);
      if (!taxCol || taxCol.length === 0) {
        console.log('🔄 Aplicando migración 019 (tax_applies)...');
        await sequelize.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS tax_applies BOOLEAN NOT NULL DEFAULT true`);
        console.log('✅ Migración 019 aplicada');
      }
      // Asegurar que el setting tax_enabled exista
      const [teSet] = await sequelize.query(`SELECT 1 FROM settings WHERE tenant_id = 1 AND setting_key = 'tax_enabled'`);
      if (!teSet || teSet.length === 0) {
        await sequelize.query(`INSERT INTO settings (tenant_id, setting_key, setting_value, setting_type, description, updated_at) VALUES (1, 'tax_enabled', 'true', 'string', 'IVA habilitado (true/false)', NOW())`);
        console.log('✅ Setting tax_enabled creado');
      }
    } catch (e) {
      console.warn('⚠️ Migración 019 (tax_applies):', e.message);
    }

    // Migración 020: payment_method en group_purchase_participants
    try {
      const [pmCol] = await sequelize.query(`
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'group_purchase_participants' AND column_name = 'payment_method'
      `);
      if (!pmCol || pmCol.length === 0) {
        console.log('🔄 Aplicando migración 020 (payment_method en group_purchase_participants)...');
        await sequelize.query(`
          ALTER TABLE group_purchase_participants
            ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20) NOT NULL DEFAULT 'CREDIT'
              CONSTRAINT chk_gpp_payment_method CHECK (payment_method IN ('CASH', 'TRANSFER', 'CREDIT'))
        `);
        console.log('✅ Migración 020 aplicada');
      }
    } catch (e) {
      console.warn('⚠️ Migración 020 (payment_method):', e.message);
    }

    // Migración 021: product_id nullable en group_purchases
    try {
      const [gpNullable] = await sequelize.query(`
        SELECT is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'group_purchases' AND column_name = 'product_id'
      `);
      if (gpNullable && gpNullable.length > 0 && gpNullable[0].is_nullable === 'NO') {
        console.log('🔄 Aplicando migración 021 (product_id nullable en group_purchases)...');
        await sequelize.query(`ALTER TABLE group_purchases ALTER COLUMN product_id DROP NOT NULL`);
        console.log('✅ Migración 021 aplicada');
      }
    } catch (e) {
      console.warn('⚠️ Migración 021 (product_id nullable):', e.message);
    }

    // Migración 022: ruc, supplier_code, credit_days, notes en suppliers
    try {
      const [suppCol] = await sequelize.query(`
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'suppliers' AND column_name = 'credit_days'
      `);
      if (!suppCol || suppCol.length === 0) {
        console.log('🔄 Aplicando migración 022 (ruc/credit_days en suppliers)...');
        await sequelize.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS ruc VARCHAR(20)`);
        await sequelize.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS supplier_code VARCHAR(30)`);
        await sequelize.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS credit_days INTEGER NOT NULL DEFAULT 0`);
        await sequelize.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS notes TEXT`);
        await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_code ON suppliers(tenant_id, supplier_code) WHERE supplier_code IS NOT NULL`);
        console.log('✅ Migración 022 aplicada');
      }
    } catch (e) {
      console.warn('⚠️ Migración 022 (suppliers ruc/credit_days):', e.message);
    }

    // Migración 023: tabla purchase_orders
    try {
      const [poTbl] = await sequelize.query(`
        SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'purchase_orders'
      `);
      if (!poTbl || poTbl.length === 0) {
        console.log('🔄 Aplicando migración 023 (purchase_orders)...');
        await sequelize.query(`
          CREATE TABLE IF NOT EXISTS purchase_orders (
            id BIGSERIAL PRIMARY KEY,
            tenant_id BIGINT NOT NULL,
            supplier_id BIGINT REFERENCES suppliers(id) ON DELETE SET NULL,
            invoice_number VARCHAR(100),
            purchase_date DATE NOT NULL,
            total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
            credit_days INTEGER NOT NULL DEFAULT 0,
            due_date DATE,
            amount_paid DECIMAL(12,2) NOT NULL DEFAULT 0,
            status VARCHAR(20) NOT NULL DEFAULT 'PAID'
              CHECK (status IN ('PAID', 'PENDING', 'PARTIAL', 'OVERDUE')),
            notes TEXT,
            last_notified_at TIMESTAMP WITH TIME ZONE,
            paid_at TIMESTAMP WITH TIME ZONE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          )
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_purchase_orders_tenant ON purchase_orders(tenant_id)`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON purchase_orders(supplier_id)`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status)`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_purchase_orders_due_date ON purchase_orders(due_date)`);
        console.log('✅ Migración 023 aplicada');
      }
    } catch (e) {
      console.warn('⚠️ Migración 023 (purchase_orders):', e.message);
    }

    // Migración 024: purchase_order_id en inventory_movements
    try {
      const [poImCol] = await sequelize.query(`
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'inventory_movements' AND column_name = 'purchase_order_id'
      `);
      if (!poImCol || poImCol.length === 0) {
        console.log('🔄 Aplicando migración 024 (purchase_order_id en inventory_movements)...');
        await sequelize.query(`ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS purchase_order_id BIGINT REFERENCES purchase_orders(id) ON DELETE SET NULL`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_inventory_movements_purchase_order ON inventory_movements(purchase_order_id)`);
        console.log('✅ Migración 024 aplicada');
      }
    } catch (e) {
      console.warn('⚠️ Migración 024 (purchase_order_id):', e.message);
    }

    // Migración 025: tabla purchase_order_items
    try {
      const [poiTbl] = await sequelize.query(`
        SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'purchase_order_items'
      `);
      if (!poiTbl || poiTbl.length === 0) {
        console.log('🔄 Aplicando migración 025 (purchase_order_items)...');
        await sequelize.query(`
          CREATE TABLE IF NOT EXISTS purchase_order_items (
            id            BIGSERIAL PRIMARY KEY,
            purchase_order_id BIGINT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
            product_id    BIGINT NOT NULL,
            quantity      DECIMAL(12, 3) NOT NULL,
            unit_cost     DECIMAL(12, 2) NOT NULL DEFAULT 0,
            created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          )
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_poi_order ON purchase_order_items(purchase_order_id)`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_poi_product ON purchase_order_items(product_id)`);
        console.log('✅ Migración 025 aplicada');
      }
    } catch (e) {
      console.warn('⚠️ Migración 025 (purchase_order_items):', e.message);
    }

    // Migración 026: setting cash_transfer_discount_rate
    try {
      const [discSet] = await sequelize.query(`SELECT 1 FROM settings WHERE tenant_id = 1 AND setting_key = 'cash_transfer_discount_rate'`);
      if (!discSet || discSet.length === 0) {
        await sequelize.query(`INSERT INTO settings (tenant_id, setting_key, setting_value, setting_type, description, updated_at) VALUES (1, 'cash_transfer_discount_rate', '5.75', 'number', 'Descuento (%) aplicado al pagar en efectivo o transferencia', NOW())`);
        console.log('✅ Setting cash_transfer_discount_rate creado (default 5.75%)');
      }
    } catch (e) {
      console.warn('⚠️ Migración 026 (discount_rate):', e.message);
    }

    // ── Seed primer despliegue ────────────────────────────────────────────────
    // Se ejecuta automáticamente solo cuando no existe ningún usuario admin
    // (indica BD recién creada). Crea admin por defecto + datos iniciales.
    try {
      const bcrypt = require('bcrypt');
      const [adminRows] = await sequelize.query(
        `SELECT COUNT(*) AS count FROM users WHERE role = 'ADMIN' AND tenant_id = 1`
      );
      const adminCount = parseInt(adminRows[0].count, 10);

      if (adminCount === 0) {
        console.log('🌱 Primer despliegue detectado — ejecutando seed inicial...');

        // Usuario administrador por defecto
        const passwordHash = await bcrypt.hash('admin123', 10);
        await sequelize.query(
          `INSERT INTO users (tenant_id, name, email, password, role, is_active, created_at)
           VALUES (1, 'Administrador', 'admin@locobar.com', :hash, 'ADMIN', true, NOW())
           ON CONFLICT DO NOTHING`,
          { replacements: { hash: passwordHash } }
        );
        console.log('  ✅ Usuario admin: admin@locobar.com / admin123');

        // Categorías de producto (si la tabla está vacía)
        const [catRows] = await sequelize.query(
          `SELECT COUNT(*) AS count FROM product_categories WHERE tenant_id = 1`
        );
        if (parseInt(catRows[0].count, 10) === 0) {
          await sequelize.query(
            `INSERT INTO product_categories (tenant_id, name, sort_order) VALUES
             (1,'Whisky',1),(1,'Vodka',2),(1,'Tequila',3),
             (1,'Ron',4),(1,'Cerveza',5),(1,'Accesorios',6)
             ON CONFLICT DO NOTHING`
          );
          console.log('  ✅ Categorías de producto creadas');
        }

        // Presentaciones de producto (si la tabla está vacía)
        const [presRows] = await sequelize.query(
          `SELECT COUNT(*) AS count FROM product_presentations WHERE tenant_id = 1`
        );
        if (parseInt(presRows[0].count, 10) === 0) {
          await sequelize.query(
            `INSERT INTO product_presentations (tenant_id, name, units_per_sale, sort_order) VALUES
             (1,'Individual',1,1),(1,'Six Pack',6,2),
             (1,'Caja (24)',24,3),(1,'Cajetilla',20,4),(1,'Media Cajetilla',10,5)
             ON CONFLICT DO NOTHING`
          );
          console.log('  ✅ Presentaciones de producto creadas');
        }

        console.log('🌱 Seed completado — accede con admin@locobar.com / admin123');
      }
    } catch (e) {
      console.warn('⚠️ Seed primer despliegue:', e.message);
    }

    // Agregar columna email_verified a customers si no existe (migración inline — corre en todos los entornos)
    try {
      const [evResults] = await sequelize.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'email_verified'
      `);
      if (evResults.length === 0) {
        console.log('🔄 Agregando columna email_verified a la tabla customers...');
        await sequelize.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT TRUE`);
        console.log('✅ Columna email_verified agregada exitosamente');
      }
    } catch (e) {
      console.warn('⚠️ No se pudo agregar columna email_verified:', e.message);
    }

    // Migración: first_name, last_name, birth_date en customers
    try {
      await sequelize.query(`
        ALTER TABLE customers
          ADD COLUMN IF NOT EXISTS first_name VARCHAR(100),
          ADD COLUMN IF NOT EXISTS last_name  VARCHAR(100),
          ADD COLUMN IF NOT EXISTS birth_date DATE;
      `);
      // Rellenar first_name/last_name desde name si están vacíos
      await sequelize.query(`
        UPDATE customers
        SET first_name = TRIM(split_part(name, ' ', 1)),
            last_name  = TRIM(NULLIF(substring(name FROM position(' ' IN name) + 1), ''))
        WHERE first_name IS NULL AND name IS NOT NULL AND name <> '';
      `);
    } catch (e) {
      console.warn('⚠️ Migración first_name/last_name/birth_date:', e.message);
    }

    // Migración: theme_id, theme_mode en users
    try {
      await sequelize.query(`
        ALTER TABLE users
          ADD COLUMN IF NOT EXISTS theme_id SMALLINT NOT NULL DEFAULT 1,
          ADD COLUMN IF NOT EXISTS theme_mode VARCHAR(10) NOT NULL DEFAULT 'auto';
      `);
    } catch (e) {
      console.warn('⚠️ Migración theme_id/theme_mode en users:', e.message);
    }

    // Migración: sistema de roles personalizados
    try {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS roles (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NOT NULL DEFAULT 1,
          name VARCHAR(100) NOT NULL,
          permissions JSONB NOT NULL DEFAULT '{}',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          UNIQUE(tenant_id, name)
        );
      `);
      await sequelize.query(`
        ALTER TABLE users
          ADD COLUMN IF NOT EXISTS custom_role_id BIGINT REFERENCES roles(id) ON DELETE SET NULL;
      `);
      // Rol "Cajero" por defecto si no existe ninguno en el tenant
      await sequelize.query(`
        INSERT INTO roles (tenant_id, name, permissions)
        SELECT 1, 'Cajero', '{"dashboard":"full","products":"read","suppliers":"none","purchases":"none","sell":"full","sales":"read","group-purchases":"none","credits":"none","customers":"read","expenses":"none","users":"none","settings":"none"}'::jsonb
        WHERE NOT EXISTS (SELECT 1 FROM roles WHERE tenant_id = 1);
      `);
      console.log('✅ Migración roles completada');
    } catch (e) {
      console.warn('⚠️ Migración roles:', e.message);
    }

    // Migración gastos (expense_categories + expenses)
    try {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS expense_categories (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NOT NULL DEFAULT 1,
          name VARCHAR(100) NOT NULL,
          UNIQUE(tenant_id, name)
        );
      `);
      await sequelize.query(`
        INSERT INTO expense_categories (tenant_id, name)
        VALUES (1,'Alquiler'),(1,'Servicios'),(1,'Personal'),
               (1,'Mantenimiento'),(1,'Insumos'),(1,'Otros')
        ON CONFLICT DO NOTHING;
      `);
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS expenses (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NOT NULL DEFAULT 1,
          category_id BIGINT REFERENCES expense_categories(id) ON DELETE SET NULL,
          description VARCHAR(255) NOT NULL,
          amount DECIMAL(12,2) NOT NULL CHECK (amount > 0),
          expense_date DATE NOT NULL,
          paid_to VARCHAR(150),
          notes TEXT,
          created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);
      await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_expenses_tenant   ON expenses(tenant_id)`);
      await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_expenses_date     ON expenses(expense_date)`);
      await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category_id)`);
      console.log('✅ Migración expenses completada');
    } catch (e) {
      console.warn('⚠️ Migración expenses:', e.message);
    }

    // Sync models (create tables if they don't exist)
    if (process.env.NODE_ENV === 'development') {
      await sequelize.sync({ alter: true });
      console.log('✅ Database synchronized');
      
      // Agregar columna cedula si no existe
      try {
        const [results] = await sequelize.query(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = 'customers' AND column_name = 'cedula'
        `);
        
        if (results.length === 0) {
          console.log('🔄 Agregando columna cedula a la tabla customers...');
          await sequelize.query(`
            ALTER TABLE customers 
            ADD COLUMN IF NOT EXISTS cedula VARCHAR(50) NOT NULL DEFAULT ''
          `);
          
          await sequelize.query(`
            UPDATE customers 
            SET cedula = 'TEMP-' || id::text 
            WHERE cedula IS NULL OR cedula = ''
          `);
          
          await sequelize.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_tenant_cedula 
            ON customers(tenant_id, cedula)
          `);
          
          console.log('✅ Columna cedula agregada exitosamente');
        } else {
          console.log('✅ Columna cedula ya existe');
        }
      } catch (error) {
        console.warn('⚠️  No se pudo agregar columna cedula automáticamente:', error.message);
        console.warn('   Ejecuta manualmente la migración: database/migrations/005_add_customer_cedula.sql');
      }

    }

    // Socket.IO: auth and rooms (staff, sale:id)
    io.on('connection', (socket) => {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      const saleId = socket.handshake.query?.saleId;

      if (!token) {
        socket.disconnect(true);
        return;
      }

      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.type === 'admin') {
          socket.join(`user:${decoded.userId}`);
          socket.join('staff');
          return;
        }
        if (decoded.customerId != null && saleId) {
          const sid = parseInt(saleId, 10);
          if (!isNaN(sid)) {
            Sale.findOne({ where: { id: sid, customerId: decoded.customerId } })
              .then((sale) => {
                if (sale) socket.join(`sale:${sid}`);
              })
              .catch(() => {});
          }
          return;
        }
      } catch (e) {
        // invalid token
      }
      socket.disconnect(true);
    });

    // ─── Scheduler: calcular intereses diariamente a medianoche ─────────────
    const CreditService = require('./services/CreditService');
    const { CustomerCredit } = require('./models');

    async function runDailyInterestCalculation() {
      try {
        const credits = await CustomerCredit.findAll({ where: { status: 'ACTIVE' } });
        for (const credit of credits) {
          await CreditService.updateCreditBalance(credit.id);
        }
        if (credits.length > 0) {
          console.log(`💰 Intereses diarios calculados: ${credits.length} crédito(s) [${new Date().toLocaleString('es-EC')}]`);
        }
      } catch (err) {
        console.error('❌ Error en cálculo de intereses diarios:', err.message);
      }
    }

    function scheduleMidnightInterest() {
      const now = new Date();
      const nextRun = new Date(now);
      nextRun.setDate(nextRun.getDate() + 1);
      nextRun.setHours(0, 0, 30, 0); // 00:00:30 AM del día siguiente
      const msUntil = nextRun - now;
      setTimeout(async () => {
        await runDailyInterestCalculation();
        scheduleMidnightInterest(); // reprogramar para el día siguiente
      }, msUntil);
      console.log(`⏰ Próximo cálculo de intereses: ${nextRun.toLocaleString('es-EC')}`);
    }

    // Calcular al iniciar (por si el servidor estuvo caído) y luego a medianoche
    await runDailyInterestCalculation();
    scheduleMidnightInterest();
    // ─────────────────────────────────────────────────────────────────────────

    // Start server
    server.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
      console.log(`📊 Dashboard (Admin) available at http://localhost:${PORT}`);
      console.log(`🛒 Customer Portal: http://localhost:${PORT}/customer/catalog`);
      console.log(`🔐 Customer Login: http://localhost:${PORT}/customer/login`);
      console.log(`🛠️  API health at http://localhost:${PORT}/api/health`);
      if (process.env.PAYPHONE_TOKEN && process.env.PAYPHONE_STORE_ID) {
        console.log(`💳 PayPhone (pago con tarjeta) configurado`);
      } else {
        console.log(`⚠️  PayPhone NO configurado: añade PAYPHONE_TOKEN y PAYPHONE_STORE_ID en .env`);
      }
    });

  } catch (error) {
    console.error('❌ Failed to initialize application:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🔄 Shutting down gracefully...');
  await sequelize.close();
  console.log('✅ Database connection closed');
  process.exit(0);
});

// Start the application
initializeApp();