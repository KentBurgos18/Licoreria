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

app.get('/debug-emails', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'debug-emails.html'));
});

app.get('/cleanup', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'cleanup.html'));
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

// API pública: IVA (tax_rate) desde Configuración; sin valor por defecto
app.get('/api/public/tax-rate', async (req, res) => {
  try {
    const tenantId = parseInt(req.query.tenantId, 10) || 1;
    const value = await Setting.getSetting(tenantId, 'tax_rate');
    const num = value != null ? parseFloat(value) : NaN;
    const configured = !isNaN(num) && num >= 0 && num <= 100;
    res.json({ value: configured ? num : null, configured });
  } catch (err) {
    console.error('Error getting public tax-rate:', err);
    res.json({ value: null, configured: false });
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
app.use('/api/sales', authenticateAdmin, salesRouter);
app.use('/api/sales', authenticateAdmin, salesVoidRouter);
app.use('/api/purchases', authenticateAdmin, require('./routes/purchases'));
app.use('/api/users', authenticateAdmin, require('./routes/users'));
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

// View routes (continuación - rutas adicionales)
app.get('/dashboard.html', (req, res) => res.redirect(302, '/dashboard'));

// Dashboard con rutas reales (para uso online)
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

app.get('/dashboard/products', (req, res) => {
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