/**
 * Divide dashboard.html en shell + vistas SPA.
 * Uso: node scripts/split-dashboard.js
 */
const fs = require('fs');
const path = require('path');

const DASHBOARD_PATH = path.join(__dirname, '..', 'views', 'dashboard.html');
const DASHBOARD_DIR = path.join(__dirname, '..', 'views', 'dashboard');
const SHELL_PATH = path.join(__dirname, '..', 'views', 'dashboard-shell.html');

const SECTIONS = [
  { id: 'dashboard', init: 'loadDashboardData' },
  { id: 'products', init: 'loadProducts' },
  { id: 'suppliers', init: 'loadSuppliers' },
  { id: 'purchases', init: 'loadPurchases' },
  { id: 'sell', init: 'loadSellProducts' },
  { id: 'sales', init: 'loadSales' },
  { id: 'group-purchases', init: 'loadGroupPurchases' },
  { id: 'credits', init: 'loadCredits' },
  { id: 'customers', init: 'loadCustomers' },
  { id: 'users', init: 'loadUsers' },
  { id: 'audit', init: 'initAuditSection' },
  { id: 'settings', init: 'loadSettings' },
  { id: 'expenses', init: 'loadExpenses' }
];

const content = fs.readFileSync(DASHBOARD_PATH, 'utf8');

// Encontrar inicio y fin del main-content
const mainStart = content.indexOf('    <!-- Main Content -->');
const mainEnd = content.indexOf('    <!-- Modal Personalizar Dashboard -->');
if (mainStart === -1 || mainEnd === -1) {
  console.error('No se encontraron los marcadores');
  process.exit(1);
}

const beforeMain = content.substring(0, mainStart);
const mainBlock = content.substring(mainStart, mainEnd);
const afterMain = content.substring(mainEnd);

// Extraer cada sección
function extractSection(html, sectionId) {
  const startTag = `<div id="${sectionId}" class="content-section">`;
  const startIdx = html.indexOf(startTag);
  if (startIdx === -1) return null;
  let depth = 0;
  let i = startIdx + startTag.length;
  const start = i;
  while (i < html.length) {
    const openDiv = html.indexOf('<div', i);
    const closeDiv = html.indexOf('</div>', i);
    if (closeDiv === -1) break;
    if (openDiv !== -1 && openDiv < closeDiv) {
      depth++;
      i = openDiv + 4;
    } else {
      if (depth === 0) {
        return html.substring(startIdx, closeDiv + 6);
      }
      depth--;
      i = closeDiv + 6;
    }
  }
  return null;
}

if (!fs.existsSync(DASHBOARD_DIR)) {
  fs.mkdirSync(DASHBOARD_DIR, { recursive: true });
}

// Crear vistas
for (const sec of SECTIONS) {
  const sectionHtml = extractSection(mainBlock, sec.id);
  if (!sectionHtml) {
    console.warn('No se encontró sección:', sec.id);
    continue;
  }
  const initFnMap = {
    'group-purchases': 'initGroupPurchasesView',
    'dashboard': 'initDashboardView',
    'products': 'initProductsView',
    'suppliers': 'initSuppliersView',
    'purchases': 'initPurchasesView',
    'sell': 'initSellView',
    'sales': 'initSalesView',
    'credits': 'initCreditsView',
    'customers': 'initCustomersView',
    'users': 'initUsersView',
    'audit': 'initAuditView',
    'settings': 'initSettingsView',
    'expenses': 'initExpensesView'
  };
  const initFn = initFnMap[sec.id] || 'init' + sec.id.charAt(0).toUpperCase() + sec.id.slice(1) + 'View';
  const viewContent = `<div id="spa-view-content">
  ${sectionHtml.replace('class="content-section"', 'class="content-section active"')}
  <script>
    if (typeof ${sec.init} === 'function') ${sec.init}();
    window.${initFn} = function() { if (typeof ${sec.init} === 'function') ${sec.init}(); };
  </script>
</div>
`;
  const outPath = path.join(DASHBOARD_DIR, `${sec.id}.html`);
  fs.writeFileSync(outPath, viewContent, 'utf8');
  console.log('Creado:', outPath);
}

// Crear shell: reemplazar main content con loading + app-content
const newMainContent = `    <!-- Main Content -->
    <div class="main-content">
        <div id="dashboard-spa-loading" class="d-none" style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;text-align:center;">
            <div class="spinner-border" role="status"></div>
            <p class="mt-2">Cargando...</p>
        </div>
        <div id="dashboard-app-content"></div>
    </div>

`;

// Eliminar el script initSection del head (el router lo reemplaza)
const initSectionStart = beforeMain.indexOf('    <!-- Script inline para evitar parpadeo');
const initSectionEnd = beforeMain.indexOf('    </script>', initSectionStart) + 12;
const beforeMainNoInit = initSectionStart !== -1
  ? beforeMain.substring(0, initSectionStart) + beforeMain.substring(initSectionEnd)
  : beforeMain;

const shellContent = beforeMainNoInit + newMainContent + afterMain;

// El shell no necesita initSection - el router lo maneja.
// Pero el shell debe cargar el router. Buscar </body> y agregar antes el script del router.
const routerScript = '<script src="/js/dashboard-spa-router.js"></script>';
const bodyClose = shellContent.lastIndexOf('</body>');
let finalShell = shellContent;
if (bodyClose !== -1) {
  finalShell = shellContent.substring(0, bodyClose) + '\n    ' + routerScript + '\n' + shellContent.substring(bodyClose);
}

// Cambiar nav links de href="#" a href="/dashboard/xxx"
finalShell = finalShell.replace(/href="#" data-section="dashboard"/g, 'href="/dashboard" data-section="dashboard"');
finalShell = finalShell.replace(/href="#" data-section="([^"]+)"/g, 'href="/dashboard/$1" data-section="$1"');

// handleMobileNav debe usar dashboardNavigate
finalShell = finalShell.replace(/onclick="handleMobileNav\(this\); return false;"/g, 'onclick="if(window.dashboardNavigate){window.dashboardNavigate(\'/dashboard/\'+this.getAttribute(\'data-section\'));}else{handleMobileNav(this);} return false;"');

fs.writeFileSync(SHELL_PATH, finalShell, 'utf8');
console.log('Creado shell:', SHELL_PATH);

// También modificar dashboard.html para que sea el shell (reemplazar con el shell)
// O mantener dashboard.html como está y usar dashboard-shell.html para SPA
console.log('Listo. Usar dashboard-shell.html como shell para SPA.');
