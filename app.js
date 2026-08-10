const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');

// VAPID keys para Web Push (generar si no están en .env); no bloquear arranque si falla
try {
  const webpush = require('web-push');
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    const keys = webpush.generateVAPIDKeys();
    process.env.VAPID_PUBLIC_KEY = keys.publicKey;
    process.env.VAPID_PRIVATE_KEY = keys.privateKey;
    console.log('📌 VAPID keys generadas automáticamente (para producción definir en .env)');
  }
} catch (e) {
  console.warn('⚠️ Web Push no disponible:', e.message);
}

const { sequelize, Setting, Sale } = require('./models');
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('⛔ FATAL: JWT_SECRET no está definido en las variables de entorno');
  process.exit(1);
}

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
// Confiar en 1 proxy delante (Nginx Proxy Manager) para leer la IP real del
// cliente vía X-Forwarded-For. Necesario para que el rate-limiting cuente por
// usuario real y no por la IP del proxy (que sería la misma para todos).
app.set('trust proxy', 1);
const server = http.createServer(app);
const { Server } = require('socket.io');
// Orígenes permitidos (configurar en .env separados por coma, ej: ALLOWED_ORIGINS=https://midominio.com,https://admin.midominio.com)
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : undefined; // undefined = permitir todo en desarrollo

const corsOptions = allowedOrigins
  ? { origin: allowedOrigins, credentials: true }
  : { origin: true, credentials: true };

const io = new Server(server, { cors: corsOptions });
app.set('io', io);

const PORT = process.env.PORT || 3000;

// Helmet: headers de seguridad (desactivar CSP para no romper scripts inline del frontend)
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// Compresión gzip para respuestas (reduce ~70% el tamaño de JSON/HTML)
app.use(compression());

// Referrer-Policy requerida por Payphone SDK (sobreescribe la de Helmet)
app.use((req, res, next) => {
    res.setHeader('Referrer-Policy', 'origin-when-cross-origin');
    next();
});

// CORS
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Session for Passport OAuth
app.use(session({
    secret: process.env.SESSION_SECRET || process.env.JWT_SECRET,
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

// API pública: comisión PayPhone (%) para pago con tarjeta
app.get('/api/public/payphone-commission', async (req, res) => {
  try {
    const tenantId = 1;
    const value = await Setting.getSetting(tenantId, 'payphone_commission_rate');
    const num = value != null ? parseFloat(value) : NaN;
    const rate = (!isNaN(num) && num >= 0 && num <= 100) ? num : 5.75;
    res.json({ rate });
  } catch (err) {
    console.error('Error getting payphone-commission:', err);
    res.json({ rate: 5.75 });
  }
});

// API admin: tasas de interés de créditos por defecto
app.get('/api/settings/credit_interest_rates', async (req, res) => {
  try {
    const tenantId = 1;
    const normalRate  = await Setting.getSetting(tenantId, 'credit_default_interest_rate',  '0.005');
    const overdueRate = await Setting.getSetting(tenantId, 'credit_default_overdue_rate',   '0.02');
    res.json({ normalRate: parseFloat(normalRate), overdueRate: parseFloat(overdueRate) });
  } catch (err) {
    res.json({ normalRate: 0.005, overdueRate: 0.02 });
  }
});

// API pública: tiempo de reserva del carrito en minutos
app.get('/api/public/cart-reservation-minutes', async (req, res) => {
  try {
    const tenantId = 1;
    const value = await Setting.getSetting(tenantId, 'cart_reservation_minutes');
    const num = value != null ? parseInt(value, 10) : NaN;
    const minutes = (!isNaN(num) && num >= 1 && num <= 120) ? num : 15;
    res.json({ minutes });
  } catch (err) {
    console.error('Error getting cart-reservation-minutes:', err);
    res.json({ minutes: 15 });
  }
});

// API pública: IVA (tax_rate) desde Configuración; sin valor por defecto
app.get('/api/public/tax-rate', async (req, res) => {
  try {
    const tenantId = 1;
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

// Caché en memoria para categorías y presentaciones (datos que cambian poco)
const _publicCache = { categories: null, categoriesAt: 0, presentations: null, presentationsAt: 0 };
const PUBLIC_CACHE_TTL = 5 * 60 * 1000; // 5 minutos

// API pública: categorías de producto (sin auth, para catálogo de clientes)
app.get('/api/public/product-categories', async (req, res) => {
  try {
    const now = Date.now();
    if (_publicCache.categories && (now - _publicCache.categoriesAt) < PUBLIC_CACHE_TTL) {
      return res.json({ categories: _publicCache.categories });
    }
    const tenantId = 1;
    const { ProductCategory } = require('./models');
    const categories = await ProductCategory.findAll({
      where: { tenantId },
      order: [['sortOrder', 'ASC'], ['name', 'ASC']]
    });
    _publicCache.categories = categories;
    _publicCache.categoriesAt = now;
    res.json({ categories });
  } catch (err) {
    console.error('Error getting public categories:', err);
    res.json({ categories: [] });
  }
});

// API pública: presentaciones de producto (sin auth, para catálogo de clientes)
app.get('/api/public/product-presentations', async (req, res) => {
  try {
    const now = Date.now();
    if (_publicCache.presentations && (now - _publicCache.presentationsAt) < PUBLIC_CACHE_TTL) {
      return res.json({ presentations: _publicCache.presentations });
    }
    const tenantId = 1;
    const { ProductPresentation } = require('./models');
    const presentations = await ProductPresentation.findAll({
      where: { tenantId },
      order: [['sortOrder', 'ASC'], ['name', 'ASC']]
    });
    _publicCache.presentations = presentations;
    _publicCache.presentationsAt = now;
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
      headers: { 'Accept-Version': '3', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000) // 5s timeout
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
// Cache largo (7 días) para CSS/JS/imágenes — acelera carga en móvil
const staticCacheOptions     = { maxAge: '7d', etag: true, lastModified: true };
const staticNoCacheOptions   = { maxAge: 0,    etag: true, lastModified: true }; // HTML sin cache

app.use('/js',     express.static(path.join(__dirname, 'public', 'js'),   staticCacheOptions));
app.use(express.static(path.join(__dirname, 'views'), staticNoCacheOptions));

// Archivos estáticos públicos (logo, imágenes, CSS)
app.use('/public', express.static(path.join(__dirname, 'public'), staticCacheOptions));

// Favicon para navegadores que piden /favicon.ico
app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'img', 'pestana-LB.png'));
});

// Serve local libraries (Bootstrap, jQuery, etc.) — cache largo
app.use('/libs', express.static(path.join(__dirname, 'public', 'libs'), staticCacheOptions));

// Serve uploaded images
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Rate limiters para endpoints sensibles
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 15, // máximo 15 intentos por ventana
  message: { error: 'Demasiados intentos. Intenta de nuevo en 15 minutos.', code: 'RATE_LIMIT' },
  standardHeaders: true,
  legacyHeaders: false
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 100, // 100 peticiones por minuto
  message: { error: 'Demasiadas peticiones. Intenta de nuevo en un momento.', code: 'RATE_LIMIT' },
  standardHeaders: true,
  legacyHeaders: false
});

// Rate limiting global para APIs
app.use('/api/', apiLimiter);
// Rate limiting estricto para autenticación
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/admin/auth/login', authLimiter);

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
app.use('/api/loans', authenticateAdmin, require('./routes/loans'));
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
app.use('/api/audit',   authenticateAdmin, require('./routes/audit'));
app.use('/api/notifications', authenticateAdmin, require('./routes/notifications'));
app.use('/api/email', authenticateAdmin, require('./routes/email'));
app.use('/api/backup', authenticateAdmin, require('./routes/backup'));

// API: Tesorería — resumen de ingresos por método de pago y cuenta bancaria
app.get('/api/treasury', authenticateAdmin, async (req, res) => {
  try {
    const tenantId = req.tenantId || 1;

    // Obtener cuentas bancarias registradas en settings
    const raw = await Setting.getSetting(tenantId, 'bank_accounts', '[]');
    let bankAccounts = [];
    try { bankAccounts = JSON.parse(raw); } catch(e) { bankAccounts = []; }

    // Ventas agrupadas por método de pago y transfer_account_info
    const [salesRows] = await sequelize.query(`
      SELECT
        payment_method,
        COALESCE(transfer_account_info, '') AS transfer_account_info,
        SUM(total_amount) AS total
      FROM sales
      WHERE tenant_id = :tenantId
        AND status != 'VOIDED'
      GROUP BY payment_method, transfer_account_info
    `, { replacements: { tenantId } });

    // Cobros de crédito agrupados por método de pago y transfer_account_info
    const [paymentsRows] = await sequelize.query(`
      SELECT
        payment_method,
        COALESCE(transfer_account_info, '') AS transfer_account_info,
        SUM(amount) AS total
      FROM customer_payments
      WHERE tenant_id = :tenantId
      GROUP BY payment_method, transfer_account_info
    `, { replacements: { tenantId } });

    // Pagos inmediatos (efectivo/transferencia) de participantes en ventas grupales MIXTAS.
    // Estas ventas quedan marcadas como CREDIT (por la mezcla), por lo que la venta en sí
    // NO se cuenta arriba; pero la parte que se pagó al contado/transferencia SÍ entró y vive
    // solo en group_purchase_participants.amount_paid. Se suma aquí para no perder ese ingreso.
    // No hay doble conteo: las ventas 100% CASH/TRANSFER se cuentan por la venta (no son CREDIT).
    const [groupImmediateRows] = await sequelize.query(`
      SELECT
        gpp.payment_method,
        COALESCE(gpp.transfer_account_info, '') AS transfer_account_info,
        SUM(gpp.amount_paid) AS total
      FROM group_purchase_participants gpp
      JOIN group_purchases gp ON gp.id = gpp.group_purchase_id
      JOIN sales s ON s.id = gp.sale_id
      WHERE s.tenant_id = :tenantId
        AND s.payment_method = 'CREDIT'
        AND s.status != 'VOIDED'
        AND gpp.payment_method IN ('CASH', 'TRANSFER')
        AND gpp.amount_paid > 0
      GROUP BY gpp.payment_method, gpp.transfer_account_info
    `, { replacements: { tenantId } });

    // Préstamos de dinero. NO son ventas ni gastos (no afectan ganancia), pero sí mueven
    // caja/banco, así que se reportan en su propia línea "Préstamos".
    //   LENT (prestamos nosotros): entrega = SALIDA · abonos que nos devuelven = ENTRADA
    //   BORROWED (nos prestaron):  recepción = ENTRADA · abonos que devolvemos = SALIDA
    const [loanPrincipalRows] = await sequelize.query(`
      SELECT direction, payment_method, COALESCE(transfer_account_info, '') AS transfer_account_info,
             SUM(amount) AS total
      FROM loans
      WHERE tenant_id = :tenantId AND status != 'VOIDED'
      GROUP BY direction, payment_method, transfer_account_info
    `, { replacements: { tenantId } });

    const [loanPaymentRows] = await sequelize.query(`
      SELECT l.direction, lp.payment_method, COALESCE(lp.transfer_account_info, '') AS transfer_account_info,
             SUM(lp.amount) AS total
      FROM loan_payments lp
      JOIN loans l ON l.id = lp.loan_id
      WHERE l.tenant_id = :tenantId AND l.status != 'VOIDED'
      GROUP BY l.direction, lp.payment_method, lp.transfer_account_info
    `, { replacements: { tenantId } });

    // Salidas: compras pagadas directamente (no crédito proveedor)
    const [purchaseOutflowRows] = await sequelize.query(`
      SELECT
        COALESCE(payment_method, 'CASH') AS payment_method,
        COALESCE(transfer_account_info, '') AS transfer_account_info,
        SUM(total_amount) AS total
      FROM purchase_orders
      WHERE tenant_id = :tenantId
        AND status NOT IN ('PENDING', 'OVERDUE', 'VOIDED')
        AND payment_method NOT IN ('SUPPLIER_CREDIT', 'MIXED')
        AND (payment_method IS NOT NULL)
      GROUP BY payment_method, transfer_account_info

      UNION ALL

      SELECT
        'CASH' AS payment_method,
        '' AS transfer_account_info,
        SUM(COALESCE(cash_amount, 0)) AS total
      FROM purchase_orders
      WHERE tenant_id = :tenantId
        AND status NOT IN ('PENDING', 'OVERDUE', 'VOIDED')
        AND payment_method = 'MIXED'

      UNION ALL

      SELECT
        'TRANSFER' AS payment_method,
        COALESCE(transfer_account_info, 'unassigned') AS transfer_account_info,
        SUM(total_amount - COALESCE(cash_amount, 0)) AS total
      FROM purchase_orders
      WHERE tenant_id = :tenantId
        AND status NOT IN ('PENDING', 'OVERDUE', 'VOIDED')
        AND payment_method = 'MIXED'
      GROUP BY transfer_account_info
    `, { replacements: { tenantId } });

    // Salidas: gastos
    const [expenseOutflowRows] = await sequelize.query(`
      SELECT
        COALESCE(payment_method, 'CASH') AS payment_method,
        COALESCE(transfer_account_info, '') AS transfer_account_info,
        SUM(amount) AS total
      FROM expenses
      WHERE tenant_id = :tenantId
      GROUP BY payment_method, transfer_account_info
    `, { replacements: { tenantId } });

    // Construir resumen
    const summary = {
      cash:     { salesTotal: 0, creditsTotal: 0, loansTotal: 0, total: 0 },
      card:     { salesTotal: 0, creditsTotal: 0, loansTotal: 0, total: 0 },
      transfer: {},
      grandTotal: 0
    };

    // Outflows structure mirrors inflows
    const outflows = {
      cash:     { purchasesTotal: 0, expensesTotal: 0, loansTotal: 0, total: 0 },
      card:     { purchasesTotal: 0, expensesTotal: 0, loansTotal: 0, total: 0 },
      transfer: {},
      grandTotal: 0
    };

    for (const row of salesRows) {
      const amt = parseFloat(row.total) || 0;
      const method = (row.payment_method || '').toUpperCase();
      if (method === 'CASH') {
        summary.cash.salesTotal += amt;
      } else if (method === 'CARD') {
        summary.card.salesTotal += amt;
      } else if (method === 'TRANSFER') {
        const key = row.transfer_account_info || 'unassigned';
        if (!summary.transfer[key]) summary.transfer[key] = { salesTotal: 0, creditsTotal: 0, loansTotal: 0, total: 0 };
        summary.transfer[key].salesTotal += amt;
      }
    }

    for (const row of paymentsRows) {
      const amt = parseFloat(row.total) || 0;
      const method = (row.payment_method || '').toUpperCase();
      if (method === 'CASH') {
        summary.cash.creditsTotal += amt;
      } else if (method === 'CARD') {
        summary.card.creditsTotal += amt;
      } else if (method === 'TRANSFER') {
        const key = row.transfer_account_info || 'unassigned';
        if (!summary.transfer[key]) summary.transfer[key] = { salesTotal: 0, creditsTotal: 0, loansTotal: 0, total: 0 };
        summary.transfer[key].creditsTotal += amt;
      }
    }

    // Pagos inmediatos de participantes en ventas grupales mixtas (ver query arriba).
    // Cuentan como ingreso por venta (salesTotal) en su método/cuenta correspondiente.
    for (const row of groupImmediateRows) {
      const amt = parseFloat(row.total) || 0;
      const method = (row.payment_method || '').toUpperCase();
      if (method === 'CASH') {
        summary.cash.salesTotal += amt;
      } else if (method === 'TRANSFER') {
        const key = row.transfer_account_info || 'unassigned';
        if (!summary.transfer[key]) summary.transfer[key] = { salesTotal: 0, creditsTotal: 0, loansTotal: 0, total: 0 };
        summary.transfer[key].salesTotal += amt;
      }
    }

    for (const row of purchaseOutflowRows) {
      const amt = parseFloat(row.total) || 0;
      const method = (row.payment_method || '').toUpperCase();
      if (method === 'CASH') {
        outflows.cash.purchasesTotal += amt;
      } else if (method === 'CARD') {
        outflows.card.purchasesTotal += amt;
      } else if (method === 'TRANSFER') {
        const key = row.transfer_account_info || 'unassigned';
        if (!outflows.transfer[key]) outflows.transfer[key] = { purchasesTotal: 0, expensesTotal: 0, loansTotal: 0, total: 0 };
        outflows.transfer[key].purchasesTotal += amt;
      }
    }

    for (const row of expenseOutflowRows) {
      const amt = parseFloat(row.total) || 0;
      const method = (row.payment_method || '').toUpperCase();
      if (method === 'CASH') {
        outflows.cash.expensesTotal += amt;
      } else if (method === 'CARD') {
        outflows.card.expensesTotal += amt;
      } else if (method === 'TRANSFER') {
        const key = row.transfer_account_info || 'unassigned';
        if (!outflows.transfer[key]) outflows.transfer[key] = { purchasesTotal: 0, expensesTotal: 0, loansTotal: 0, total: 0 };
        outflows.transfer[key].expensesTotal += amt;
      }
    }

    // Distribuir préstamos en su línea propia (loansTotal), como entrada o salida según el caso.
    const addLoan = (isInflow, method, accountKey, amt) => {
      const bucket = isInflow ? summary : outflows;
      if (method === 'CASH') {
        bucket.cash.loansTotal += amt;
      } else if (method === 'CARD') {
        bucket.card.loansTotal += amt;
      } else if (method === 'TRANSFER') {
        const key = accountKey || 'unassigned';
        if (isInflow) {
          if (!summary.transfer[key]) summary.transfer[key] = { salesTotal: 0, creditsTotal: 0, loansTotal: 0, total: 0 };
          summary.transfer[key].loansTotal += amt;
        } else {
          if (!outflows.transfer[key]) outflows.transfer[key] = { purchasesTotal: 0, expensesTotal: 0, loansTotal: 0, total: 0 };
          outflows.transfer[key].loansTotal += amt;
        }
      }
    };

    // Entrega/recepción del préstamo: LENT = salida (dimos plata) · BORROWED = entrada (recibimos)
    for (const row of loanPrincipalRows) {
      const amt = parseFloat(row.total) || 0;
      addLoan(row.direction === 'BORROWED', (row.payment_method || '').toUpperCase(), row.transfer_account_info, amt);
    }
    // Abonos: sobre LENT nos devuelven (entrada) · sobre BORROWED devolvemos (salida)
    for (const row of loanPaymentRows) {
      const amt = parseFloat(row.total) || 0;
      addLoan(row.direction === 'LENT', (row.payment_method || '').toUpperCase(), row.transfer_account_info, amt);
    }

    // Calcular totales de ingresos
    summary.cash.total = summary.cash.salesTotal + summary.cash.creditsTotal + summary.cash.loansTotal;
    summary.card.total = summary.card.salesTotal + summary.card.creditsTotal + summary.card.loansTotal;
    let transferGrand = 0;
    for (const key of Object.keys(summary.transfer)) {
      summary.transfer[key].total = summary.transfer[key].salesTotal + summary.transfer[key].creditsTotal + (summary.transfer[key].loansTotal || 0);
      transferGrand += summary.transfer[key].total;
    }
    summary.grandTotal = summary.cash.total + summary.card.total + transferGrand;

    // Calcular totales de egresos
    outflows.cash.total = outflows.cash.purchasesTotal + outflows.cash.expensesTotal + outflows.cash.loansTotal;
    outflows.card.total = outflows.card.purchasesTotal + outflows.card.expensesTotal + outflows.card.loansTotal;
    let outflowTransferGrand = 0;
    for (const key of Object.keys(outflows.transfer)) {
      outflows.transfer[key].total = outflows.transfer[key].purchasesTotal + outflows.transfer[key].expensesTotal + (outflows.transfer[key].loansTotal || 0);
      outflowTransferGrand += outflows.transfer[key].total;
    }
    outflows.grandTotal = outflows.cash.total + outflows.card.total + outflowTransferGrand;

    // Movimientos internos entre cuentas (account_transfers)
    const [transfersOut] = await sequelize.query(`
      SELECT from_account, SUM(amount) AS total
      FROM account_transfers
      WHERE tenant_id = :tenantId
      GROUP BY from_account
    `, { replacements: { tenantId } });

    const [transfersIn] = await sequelize.query(`
      SELECT to_account, SUM(amount) AS total
      FROM account_transfers
      WHERE tenant_id = :tenantId
      GROUP BY to_account
    `, { replacements: { tenantId } });

    // Incluir movimientos en el balance por cuenta
    for (const row of transfersOut) {
      const key = row.from_account;
      const amt = parseFloat(row.total) || 0;
      if (key === 'CASH') {
        outflows.cash.expensesTotal += amt; // salida de efectivo
      } else if (key === 'CARD') {
        outflows.card.expensesTotal += amt;
      } else {
        if (!outflows.transfer[key]) outflows.transfer[key] = { purchasesTotal: 0, expensesTotal: 0, loansTotal: 0, total: 0 };
        outflows.transfer[key].expensesTotal += amt;
      }
    }

    for (const row of transfersIn) {
      const key = row.to_account;
      const amt = parseFloat(row.total) || 0;
      if (key === 'CASH') {
        summary.cash.creditsTotal += amt;
      } else if (key === 'CARD') {
        summary.card.creditsTotal += amt;
      } else {
        if (!summary.transfer[key]) summary.transfer[key] = { salesTotal: 0, creditsTotal: 0, loansTotal: 0, total: 0 };
        summary.transfer[key].creditsTotal += amt;
      }
    }

    // Recalcular totales después de agregar transferencias (incluye la línea de préstamos)
    summary.cash.total = summary.cash.salesTotal + summary.cash.creditsTotal + summary.cash.loansTotal;
    summary.card.total = summary.card.salesTotal + summary.card.creditsTotal + summary.card.loansTotal;
    transferGrand = 0;
    for (const key of Object.keys(summary.transfer)) {
      summary.transfer[key].total = summary.transfer[key].salesTotal + summary.transfer[key].creditsTotal + (summary.transfer[key].loansTotal || 0);
      transferGrand += summary.transfer[key].total;
    }
    summary.grandTotal = summary.cash.total + summary.card.total + transferGrand;

    outflows.cash.total = outflows.cash.purchasesTotal + outflows.cash.expensesTotal + outflows.cash.loansTotal;
    outflows.card.total = outflows.card.purchasesTotal + outflows.card.expensesTotal + outflows.card.loansTotal;
    outflowTransferGrand = 0;
    for (const key of Object.keys(outflows.transfer)) {
      outflows.transfer[key].total = outflows.transfer[key].purchasesTotal + outflows.transfer[key].expensesTotal + (outflows.transfer[key].loansTotal || 0);
      outflowTransferGrand += outflows.transfer[key].total;
    }
    outflows.grandTotal = outflows.cash.total + outflows.card.total + outflowTransferGrand;

    res.json({ bankAccounts, summary, outflows });
  } catch (err) {
    console.error('Error en /api/treasury:', err);
    res.status(500).json({ error: 'Error al cargar tesorería' });
  }
});

// POST /api/treasury/transfers — registrar movimiento entre cuentas
app.post('/api/treasury/transfers', authenticateAdmin, async (req, res) => {
  try {
    const { tenantId, fromAccount, toAccount, amount, commission, transferDate, notes } = req.body;

    if (!tenantId || !fromAccount || !toAccount || !amount || !transferDate) {
      return res.status(400).json({ error: 'Campos requeridos: fromAccount, toAccount, amount, transferDate' });
    }
    if (fromAccount === toAccount) {
      return res.status(400).json({ error: 'La cuenta origen y destino no pueden ser la misma' });
    }

    const amt  = parseFloat(amount)     || 0;
    const comm = parseFloat(commission) || 0;

    if (amt <= 0) return res.status(400).json({ error: 'El monto debe ser mayor a 0' });

    let expenseId = null;

    // Si hay comisión, crear un gasto automáticamente en la cuenta origen
    if (comm > 0) {
      const { Expense } = require('./models'); // models ya inicializados, require es cached
      const payMethod = fromAccount === 'CASH' ? 'CASH' : fromAccount === 'CARD' ? 'CARD' : 'TRANSFER';
      const transferInfo = (payMethod === 'TRANSFER') ? fromAccount : null;
      const expense = await Expense.create({
        tenantId,
        description: `Comisión transferencia: ${fromAccount} → ${toAccount}`,
        amount: comm,
        expenseDate: transferDate,
        paymentMethod: payMethod,
        transferAccountInfo: transferInfo,
        notes: notes || null
      });
      expenseId = expense.id;
    }

    const [result] = await sequelize.query(`
      INSERT INTO account_transfers (tenant_id, from_account, to_account, amount, commission, transfer_date, notes, expense_id)
      VALUES (:tenantId, :fromAccount, :toAccount, :amount, :commission, :transferDate, :notes, :expenseId)
      RETURNING *
    `, { replacements: { tenantId, fromAccount, toAccount, amount: amt, commission: comm, transferDate, notes: notes || null, expenseId } });

    res.json({ transfer: result[0], message: 'Movimiento registrado correctamente' });
  } catch (err) {
    console.error('Error en POST /api/treasury/transfers:', err);
    res.status(500).json({ error: 'Error al registrar movimiento' });
  }
});

// GET /api/treasury/transfers — listar movimientos recientes
app.get('/api/treasury/transfers', authenticateAdmin, async (req, res) => {
  try {
    const tenantId = req.tenantId || 1;
    const limit    = parseInt(req.query.limit)    || 50;

    const [transfers] = await sequelize.query(`
      SELECT * FROM account_transfers
      WHERE tenant_id = :tenantId
      ORDER BY transfer_date DESC, created_at DESC
      LIMIT :limit
    `, { replacements: { tenantId, limit } });

    res.json({ transfers });
  } catch (err) {
    console.error('Error en GET /api/treasury/transfers:', err);
    res.status(500).json({ error: 'Error al cargar movimientos' });
  }
});

// View routes (continuación - rutas adicionales)
app.get('/dashboard.html', (req, res) => res.redirect(302, '/dashboard'));

// Dashboard SPA: shell para carga inicial, fragmentos para navegación on-demand (como cliente)
function sendDashboardView(req, res, viewFile) {
  const wantFragment = req.get('X-SPA-Fragment') || req.xhr || req.query._f === '1';
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'X-SPA-Fragment');
  if (wantFragment) {
    res.sendFile(path.join(__dirname, 'views', 'dashboard', viewFile));
  } else {
    res.sendFile(path.join(__dirname, 'views', 'dashboard-shell.html'));
  }
}

app.get('/dashboard', (req, res) => sendDashboardView(req, res, 'dashboard.html'));
app.get('/dashboard/products', (req, res) => sendDashboardView(req, res, 'products.html'));
app.get('/dashboard/suppliers', (req, res) => sendDashboardView(req, res, 'suppliers.html'));
app.get('/dashboard/purchases', (req, res) => sendDashboardView(req, res, 'purchases.html'));
app.get('/dashboard/sell', (req, res) => sendDashboardView(req, res, 'sell.html'));
app.get('/dashboard/sales', (req, res) => sendDashboardView(req, res, 'sales.html'));
app.get('/dashboard/group-purchases', (req, res) => sendDashboardView(req, res, 'group-purchases.html'));
app.get('/dashboard/credits', (req, res) => sendDashboardView(req, res, 'credits.html'));
app.get('/dashboard/customers', (req, res) => sendDashboardView(req, res, 'customers.html'));
app.get('/dashboard/users', (req, res) => sendDashboardView(req, res, 'users.html'));
app.get('/dashboard/audit', (req, res) => sendDashboardView(req, res, 'audit.html'));
app.get('/dashboard/settings', (req, res) => sendDashboardView(req, res, 'settings.html'));
app.get('/dashboard/expenses', (req, res) => sendDashboardView(req, res, 'expenses.html'));
app.get('/dashboard/loans', (req, res) => sendDashboardView(req, res, 'loans.html'));
app.get('/dashboard/sell/pos', (req, res) => sendDashboardView(req, res, 'pos.html'));
app.get('/dashboard/profitability', (req, res) => sendDashboardView(req, res, 'profitability.html'));
app.get('/dashboard/treasury', (req, res) => sendDashboardView(req, res, 'treasury.html'));

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

    // Migración 027: unit_cost en products (costo manual por producto)
    try {
      const [ucCol] = await sequelize.query(`
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'unit_cost'
      `);
      if (!ucCol || ucCol.length === 0) {
        console.log('🔄 Aplicando migración 027 (unit_cost en products)...');
        await sequelize.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS unit_cost DECIMAL(14, 4) DEFAULT NULL`);
        console.log('✅ Migración 027 aplicada');
      }
    } catch (e) {
      console.warn('⚠️ Migración 027 (unit_cost en products):', e.message);
    }

    // Migración 028: credit_payment_requests
    try {
      const [cprTbl] = await sequelize.query(`
        SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'credit_payment_requests'
      `);
      if (!cprTbl || cprTbl.length === 0) {
        console.log('🔄 Aplicando migración 028 (credit_payment_requests)...');
        await sequelize.query(`
          CREATE TABLE IF NOT EXISTS credit_payment_requests (
            id BIGSERIAL PRIMARY KEY,
            tenant_id BIGINT NOT NULL,
            customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
            credit_id BIGINT NOT NULL REFERENCES customer_credits(id) ON DELETE CASCADE,
            amount NUMERIC(12,2) NOT NULL,
            payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('CASH', 'TRANSFER')),
            notes TEXT,
            status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
            created_at TIMESTAMPTZ DEFAULT NOW(),
            reviewed_at TIMESTAMPTZ,
            review_notes TEXT
          )
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_cpr_tenant   ON credit_payment_requests(tenant_id)`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_cpr_customer ON credit_payment_requests(customer_id)`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_cpr_credit   ON credit_payment_requests(credit_id)`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_cpr_status   ON credit_payment_requests(status)`);
        console.log('✅ Migración 028 aplicada');
      }
    } catch (e) {
      console.warn('⚠️ Migración 028 (credit_payment_requests):', e.message);
    }

    // Migración 029: currentBalance DECIMAL(12,4) para precisión de interés
    try {
      await sequelize.query(`
        ALTER TABLE customer_credits
          ALTER COLUMN current_balance TYPE NUMERIC(12,4)
      `);
      console.log('✅ Migración 029 aplicada (current_balance NUMERIC 12,4)');
    } catch (e) {
      if (!e.message.includes('numeric(12,4)') && !e.message.includes('no change')) {
        console.warn('⚠️ Migración 029 (current_balance precision):', e.message);
      }
    }

    // Migración 030: Índices compuestos para rendimiento
    try {
      const indexes = [
        `CREATE INDEX IF NOT EXISTS idx_inv_mov_tenant_product ON inventory_movements(tenant_id, product_id, movement_type)`,
        `CREATE INDEX IF NOT EXISTS idx_sales_customer_status ON sales(customer_id, status)`,
        `CREATE INDEX IF NOT EXISTS idx_sales_tenant_created ON sales(tenant_id, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_audit_tenant_created ON audit_logs(tenant_id, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_audit_tenant_action ON audit_logs(tenant_id, action)`,
        `CREATE INDEX IF NOT EXISTS idx_settings_tenant_key ON settings(tenant_id, setting_key)`,
        `CREATE INDEX IF NOT EXISTS idx_credits_customer_status ON customer_credits(customer_id, status)`,
        `CREATE INDEX IF NOT EXISTS idx_payments_customer ON customer_payments(customer_id)`,
        `CREATE INDEX IF NOT EXISTS idx_prod_components_combo ON product_components(combo_product_id)`,
        `CREATE INDEX IF NOT EXISTS idx_prod_components_component ON product_components(component_product_id)`,
        `CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id)`,
        `CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items(product_id)`
      ];
      for (const sql of indexes) {
        try { await sequelize.query(sql); } catch (e) { /* índice ya existe o tabla no existe */ }
      }
      console.log('✅ Migración 030 aplicada (índices de rendimiento)');
    } catch (e) {
      console.warn('⚠️ Migración 030 (índices):', e.message);
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
        const passwordHash = await bcrypt.hash('Pigmen_1820', 10);
        await sequelize.query(
          `INSERT INTO users (tenant_id, name, email, password, role, is_active, created_at)
           VALUES (1, 'Administrador', 'admin@locobar.com', :hash, 'ADMIN', true, NOW())
           ON CONFLICT DO NOTHING`,
          { replacements: { hash: passwordHash } }
        );
        console.log('  ✅ Usuario admin: admin@locobar.com / Pigmen_1820');

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

        console.log('🌱 Seed completado — accede con admin@locobar.com / Pigmen_1820');
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

    // Migración: customer_credits y customer_payments (producción sin sync automático)
    try {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS customer_credits (
          id                              BIGSERIAL PRIMARY KEY,
          tenant_id                       BIGINT NOT NULL DEFAULT 1,
          customer_id                     BIGINT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
          group_purchase_participant_id   BIGINT REFERENCES group_purchase_participants(id) ON DELETE SET NULL,
          initial_amount                  DECIMAL(12,2) NOT NULL,
          current_balance                 DECIMAL(12,2) NOT NULL,
          interest_rate                   DECIMAL(5,4)  NOT NULL DEFAULT 0,
          interest_amount                 DECIMAL(12,2) NOT NULL DEFAULT 0,
          due_date                        DATE,
          status                          VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
                                            CHECK (status IN ('ACTIVE','PAID','CANCELLED')),
          created_at                      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          paid_at                         TIMESTAMP WITH TIME ZONE,
          last_interest_calculation_date  DATE
        )
      `);
      await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_customer_credits_tenant    ON customer_credits(tenant_id)`);
      await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_customer_credits_customer  ON customer_credits(customer_id)`);
      await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_customer_credits_status    ON customer_credits(status)`);
      await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_customer_credits_due_date  ON customer_credits(due_date)`);
      await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_customer_credits_participant ON customer_credits(group_purchase_participant_id)`);

      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS customer_payments (
          id                              BIGSERIAL PRIMARY KEY,
          tenant_id                       BIGINT NOT NULL DEFAULT 1,
          customer_id                     BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
          group_purchase_participant_id   BIGINT REFERENCES group_purchase_participants(id) ON DELETE SET NULL,
          amount                          DECIMAL(12,2) NOT NULL,
          payment_method                  VARCHAR(20) NOT NULL DEFAULT 'CASH',
          payment_date                    DATE NOT NULL,
          notes                           TEXT,
          created_at                      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_customer_payments_tenant      ON customer_payments(tenant_id)`);
      await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_customer_payments_customer    ON customer_payments(customer_id)`);
      await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_customer_payments_participant ON customer_payments(group_purchase_participant_id)`);
      await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_customer_payments_date        ON customer_payments(payment_date)`);
      console.log('✅ Migración customer_credits/customer_payments completada');
    } catch (e) {
      console.warn('⚠️ Migración customer_credits/customer_payments:', e.message);
    }

    // Migración: account_transfers (movimientos entre cuentas de tesorería)
    try {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS account_transfers (
          id                BIGSERIAL PRIMARY KEY,
          tenant_id         BIGINT NOT NULL DEFAULT 1,
          from_account      VARCHAR(255) NOT NULL,
          to_account        VARCHAR(255) NOT NULL,
          amount            DECIMAL(12,2) NOT NULL,
          commission        DECIMAL(12,2) NOT NULL DEFAULT 0,
          transfer_date     DATE NOT NULL,
          notes             TEXT,
          expense_id        BIGINT,
          created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_account_transfers_tenant ON account_transfers(tenant_id)`);
      await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_account_transfers_date   ON account_transfers(transfer_date)`);
      console.log('✅ Migración account_transfers completada');
    } catch (e) {
      console.warn('⚠️ Migración account_transfers:', e.message);
    }

    // Migración: overdue_interest_rate y last_notified_at en customer_credits
    try {
      await sequelize.query(`ALTER TABLE customer_credits ADD COLUMN IF NOT EXISTS overdue_interest_rate DECIMAL(5,4) NOT NULL DEFAULT 0`);
      await sequelize.query(`ALTER TABLE customer_credits ADD COLUMN IF NOT EXISTS last_notified_at TIMESTAMP WITH TIME ZONE`);
      console.log('✅ Migración customer_credits mora completada');
    } catch (e) {
      console.warn('⚠️ Migración customer_credits mora:', e.message);
    }

    // Migración: dashboard_config en users
    try {
      await sequelize.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS dashboard_config JSONB DEFAULT '{}'
      `);
      console.log('✅ Migración dashboard_config completada');
    } catch (e) {
      console.warn('⚠️ Migración dashboard_config:', e.message);
    }

    // Migración: audit_logs
    try {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS audit_logs (
          id          BIGSERIAL PRIMARY KEY,
          tenant_id   BIGINT NOT NULL,
          user_id     BIGINT,
          user_name   VARCHAR(100),
          user_email  VARCHAR(150),
          action      VARCHAR(20) NOT NULL,
          entity      VARCHAR(50) NOT NULL,
          entity_id   VARCHAR(50),
          description TEXT NOT NULL,
          metadata    JSONB,
          ip_address  VARCHAR(50),
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_audit_tenant  ON audit_logs(tenant_id)`);
      await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_audit_user    ON audit_logs(user_id)`);
      await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_audit_entity  ON audit_logs(entity, entity_id)`);
      await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC)`);
      console.log('✅ Migración audit_logs completada');
    } catch (e) {
      console.warn('⚠️ Migración audit_logs:', e.message);
    }

    // Migración: transfer_account en sales (para filtrar por cuenta bancaria)
    try {
      await sequelize.query(`ALTER TABLE sales ADD COLUMN IF NOT EXISTS transfer_account_index INTEGER`);
      await sequelize.query(`ALTER TABLE sales ADD COLUMN IF NOT EXISTS transfer_account_info VARCHAR(150)`);
    } catch (e) {
      console.warn('⚠️ Migración transfer_account:', e.message);
    }

    // Migración: product_id y product_qty en expenses (gasto con consumo de inventario)
    try {
      await sequelize.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS product_id BIGINT REFERENCES products(id) ON DELETE SET NULL`);
      await sequelize.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS product_qty DECIMAL(12,3) DEFAULT 1`);
    } catch (e) {
      console.warn('⚠️ Migración expenses product_id/product_qty:', e.message);
    }

    // Migración: payment_method y transfer_account_info en purchase_orders y expenses
    try {
      await sequelize.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS payment_method VARCHAR(30) DEFAULT 'SUPPLIER_CREDIT'`);
      await sequelize.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS transfer_account_info VARCHAR(255)`);
      await sequelize.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS payment_method VARCHAR(30) DEFAULT 'CASH'`);
      await sequelize.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS transfer_account_info VARCHAR(255)`);
      console.log('✅ Migración payment_method/transfer_account_info en purchase_orders y expenses completada');
    } catch (e) {
      console.warn('⚠️ Migración payment_method/transfer_account_info:', e.message);
    }

    // Migración: cash_amount en purchase_orders para pagos mixtos (Efectivo + Transferencia)
    try {
      await sequelize.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS cash_amount DECIMAL(12,2) DEFAULT 0`);
      console.log('✅ Migración cash_amount en purchase_orders completada');
    } catch (e) {
      console.warn('⚠️ Migración cash_amount en purchase_orders:', e.message);
    }

    // Migración: agregar valor VOIDED al ENUM status de purchase_orders
    try {
      await sequelize.query(`ALTER TYPE "enum_purchase_orders_status" ADD VALUE IF NOT EXISTS 'VOIDED'`);
      console.log('✅ Migración VOIDED en enum purchase_orders status completada');
    } catch (e) {
      console.warn('⚠️ Migración VOIDED enum purchase_orders:', e.message);
    }

    // Índices de rendimiento
    try {
      // Sales: consultas de rentabilidad y estadísticas
      await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_sales_tenant_status_created   ON sales(tenant_id, status, created_at)`);
      await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_sale_items_product            ON sale_items(product_id, tenant_id)`);
      // Purchase orders: cálculo de COGS
      await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_purchase_orders_tenant_date   ON purchase_orders(tenant_id, purchase_date)`);
      await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_purchase_orders_tenant_status ON purchase_orders(tenant_id, status)`);
      // Expenses: resumen mensual/anual
      await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_expenses_tenant_date          ON expenses(tenant_id, expense_date)`);
      // Products: filtros de lista
      await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_products_tenant_type_active   ON products(tenant_id, product_type, is_active)`);
      // Inventory movements: cálculo de costos promedio y stock
      await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_inv_mov_tenant_product_type   ON inventory_movements(tenant_id, product_id, movement_type)`);
      console.log('✅ Índices de rendimiento verificados');
    } catch (e) {
      console.warn('⚠️ Índices de rendimiento:', e.message);
    }

    // Migración: asegurar que el check constraint de sales.payment_method incluye CREDIT
    try {
      await sequelize.query(`ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_payment_method_check`);
      await sequelize.query(`ALTER TABLE sales ADD CONSTRAINT sales_payment_method_check CHECK (payment_method IN ('CASH', 'CARD', 'TRANSFER', 'CREDIT'))`);
      console.log('✅ Constraint sales_payment_method_check actualizado');
    } catch (e) {
      console.warn('⚠️ Constraint sales_payment_method_check:', e.message);
    }

    // Migración: agregar transfer_account_info a group_purchase_participants
    try {
      await sequelize.query(`ALTER TABLE group_purchase_participants ADD COLUMN IF NOT EXISTS transfer_account_info VARCHAR(255)`);
      console.log('✅ Migración group_purchase_participants.transfer_account_info completada');
    } catch (e) {
      console.warn('⚠️ Migración transfer_account_info:', e.message);
    }

    // Migración: agregar transfer_account_info a customer_payments
    try {
      await sequelize.query(`ALTER TABLE customer_payments ADD COLUMN IF NOT EXISTS transfer_account_info VARCHAR(255)`);
      console.log('✅ Migración customer_payments.transfer_account_info completada');
    } catch (e) {
      console.warn('⚠️ Migración customer_payments.transfer_account_info:', e.message);
    }

    // Migración: agregar credit_id a customer_payments (vincular pagos con créditos individuales)
    try {
      await sequelize.query(`ALTER TABLE customer_payments ADD COLUMN IF NOT EXISTS credit_id BIGINT`);
      await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_customer_payments_credit ON customer_payments (credit_id)`);
      console.log('✅ Migración customer_payments.credit_id completada');
    } catch (e) {
      console.warn('⚠️ Migración customer_payments.credit_id:', e.message);
    }

    // Migración: préstamos de dinero (LENT = nos deben · BORROWED = debemos) + abonos
    try {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS loans (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NOT NULL DEFAULT 1,
          person_name VARCHAR(150) NOT NULL,
          customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
          direction VARCHAR(10) NOT NULL CHECK (direction IN ('LENT','BORROWED')),
          amount DECIMAL(12,2) NOT NULL CHECK (amount > 0),
          balance DECIMAL(12,2) NOT NULL DEFAULT 0,
          loan_date DATE NOT NULL,
          payment_method VARCHAR(30) NOT NULL DEFAULT 'CASH',
          transfer_account_info VARCHAR(255),
          status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAID','VOIDED')),
          notes TEXT,
          created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS loan_payments (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NOT NULL DEFAULT 1,
          loan_id BIGINT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
          amount DECIMAL(12,2) NOT NULL CHECK (amount > 0),
          payment_date DATE NOT NULL,
          payment_method VARCHAR(30) NOT NULL DEFAULT 'CASH',
          transfer_account_info VARCHAR(255),
          notes TEXT,
          created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);
      await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_loans_tenant    ON loans(tenant_id)`);
      await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_loans_status    ON loans(status)`);
      await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_loans_direction ON loans(direction)`);
      await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_loan_payments_loan ON loan_payments(loan_id)`);
      console.log('✅ Migración loans / loan_payments completada');
    } catch (e) {
      console.warn('⚠️ Migración loans:', e.message);
    }

    // Migración: ampliar inventory_movements.reason a VARCHAR(30)
    // (VOID_PURCHASE tiene 13 chars y antes la columna era VARCHAR(10))
    try {
      await sequelize.query(`ALTER TABLE inventory_movements ALTER COLUMN reason TYPE VARCHAR(30)`);
      console.log('✅ Migración inventory_movements.reason VARCHAR(30) completada');
    } catch (e) {
      console.warn('⚠️ Migración inventory_movements.reason:', e.message);
    }

    // Migración: permitir VOIDED en purchase_orders.status
    try {
      await sequelize.query(`ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check`);
      await sequelize.query(`ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_status_check CHECK (status IN ('PAID','PENDING','PARTIAL','OVERDUE','VOIDED'))`);
      console.log('✅ Migración purchase_orders.status (+VOIDED) completada');
    } catch (e) {
      console.warn('⚠️ Migración purchase_orders.status:', e.message);
    }

    // Migración: agregar is_returnable a products
    try {
      await sequelize.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS is_returnable BOOLEAN NOT NULL DEFAULT false`);
      console.log('✅ Migración products.is_returnable completada');
    } catch (e) {
      console.warn('⚠️ Migración is_returnable:', e.message);
    }

    // Migración: sale_id en customer_credits (para vincular crédito con venta)
    try {
      await sequelize.query(`ALTER TABLE customer_credits ADD COLUMN IF NOT EXISTS sale_id BIGINT REFERENCES sales(id) ON DELETE SET NULL`);
      await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_customer_credits_sale ON customer_credits(sale_id)`);
      console.log('✅ Migración customer_credits.sale_id completada');
    } catch (e) {
      console.warn('⚠️ Migración customer_credits.sale_id:', e.message);
    }

    // Migración de datos: ventas a crédito existentes → status PENDING si el crédito está ACTIVE
    try {
      await sequelize.query(`
        UPDATE sales s
        SET status = 'PENDING'
        FROM customer_credits cc
        WHERE cc.sale_id = s.id
          AND s.payment_method = 'CREDIT'
          AND s.status = 'COMPLETED'
          AND cc.status = 'ACTIVE'
      `);
      // Para registros existentes sin sale_id: actualizar por customer_id + fecha (heurístico)
      await sequelize.query(`
        UPDATE sales s
        SET status = 'PENDING'
        WHERE s.payment_method = 'CREDIT'
          AND s.status = 'COMPLETED'
          AND EXISTS (
            SELECT 1 FROM customer_credits cc
            WHERE cc.customer_id = s.customer_id
              AND cc.status = 'ACTIVE'
              AND cc.sale_id IS NULL
              AND DATE(cc.created_at) = DATE(s.created_at)
          )
      `);
      console.log('✅ Migración datos: ventas a crédito ACTIVE → PENDING completada');
    } catch (e) {
      console.warn('⚠️ Migración datos ventas crédito:', e.message);
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
        if (decoded.customerId != null) {
          socket.join(`customer:${decoded.customerId}`);
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
    const EmailService  = require('./services/EmailService');
    const { CustomerCredit, Customer } = require('./models');

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

    // ─── Scheduler: recordatorios de créditos a las 8:00 AM hora Guayaquil ──
    // Guayaquil = UTC-5 (sin horario de verano), 8:00 AM GYE = 13:00 UTC
    async function runCreditReminders() {
      try {
        const tenantId = 1;
        const now = new Date();
        const threshold24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        // Todos los créditos activos con saldo pendiente (envío diario mientras
        // tenga deudas, no solo cuando estén próximos a vencer). El throttle
        // de 24h impide que se envíe más de una vez por día.
        const credits = await CustomerCredit.findAll({
          where: {
            tenantId,
            status: 'ACTIVE',
            currentBalance: { [require('sequelize').Op.gt]: 0.01 },
            [require('sequelize').Op.or]: [
              { lastNotifiedAt: null },
              { lastNotifiedAt: { [require('sequelize').Op.lt]: threshold24h } }
            ]
          },
          include: [
            { model: Customer, as: 'customer', attributes: ['id', 'name', 'email'] },
            {
              association: 'groupPurchaseParticipant',
              include: [{
                association: 'groupPurchase',
                include: [{
                  association: 'sale',
                  include: [{ association: 'items', include: [{ association: 'product', attributes: ['id', 'name'] }] }]
                }]
              }]
            }
          ]
        });

        if (credits.length === 0) return;

        let emailConfigured = false;
        try {
          await EmailService.initialize(tenantId);
          emailConfigured = true;
        } catch (e) { /* SMTP no configurado */ }

        if (!emailConfigured) return;

        const brandName = await Setting.getSetting(tenantId, 'brand_slogan', 'Licorería');
        const { buildCustomerDetailedSummaryHtml } = require('./routes/customerCredits');
        let sent = 0;

        // Cargar items de ventas individuales
        for (const credit of credits) {
          if (credit.saleId && !credit.groupPurchaseParticipantId) {
            const sale = await Sale.findOne({
              where: { id: credit.saleId },
              include: [{ association: 'items', include: [{ association: 'product', attributes: ['id', 'name'] }] }]
            });
            credit._saleData = sale;
          }
        }

        // Agrupar créditos por cliente para enviar un solo correo por persona
        const byCustomer = new Map();
        for (const credit of credits) {
          if (!credit.customer || !credit.customer.email) continue;
          const cid = credit.customer.id;
          if (!byCustomer.has(cid)) byCustomer.set(cid, { customer: credit.customer, credits: [] });
          byCustomer.get(cid).credits.push(credit);
        }

        for (const { customer, credits: customerCredits } of byCustomer.values()) {
          try {
            const totalDebt = customerCredits.reduce((s, c) => s + parseFloat(c.currentBalance || 0), 0);
            const subject = `[${brandName}] Detalle de tus créditos pendientes — $${totalDebt.toFixed(2)}`;
            const html = buildCustomerDetailedSummaryHtml(customer, customerCredits, brandName);
            await EmailService.sendEmail(customer.email, subject, html);
            for (const credit of customerCredits) {
              await credit.update({ lastNotifiedAt: now });
            }
            sent++;
          } catch (err) {
            console.error(`❌ Recordatorio cliente ${customer.id}:`, err.message);
          }
        }

        if (sent > 0) {
          console.log(`📧 Recordatorios de crédito enviados: ${sent} [${now.toLocaleString('es-EC')}]`);
        }
      } catch (err) {
        console.error('❌ Error en recordatorios de créditos:', err.message);
      }
    }

    function schedule7amGuayaquil() {
      const now = new Date();
      // 7:00 AM Guayaquil (UTC-5) = 12:00:00 UTC
      const nextRun = new Date();
      nextRun.setUTCHours(13, 0, 30, 0);
      if (now >= nextRun) nextRun.setUTCDate(nextRun.getUTCDate() + 1);
      const msUntil = nextRun - now;
      setTimeout(async () => {
        await runCreditReminders();
        schedule7amGuayaquil();
      }, msUntil);
      console.log(`⏰ Próximos recordatorios de crédito: ${nextRun.toLocaleString('es-EC')} (8:00 AM Guayaquil)`);
    }

    schedule7amGuayaquil();
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