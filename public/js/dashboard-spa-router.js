/**
 * Router SPA para el dashboard: navegación sin recargar, carga de vistas on-demand.
 * Similar al cliente: cada sección se carga al navegar.
 */
(function () {
    'use strict';

    var APP_CONTENT_ID = 'dashboard-app-content';
    var LOADING_ID = 'dashboard-spa-loading';
    var VIEW_WRAPPER_ID = 'spa-view-content';

    var ROUTES = {
        '/dashboard': 'dashboard',
        '/dashboard/products': 'products',
        '/dashboard/suppliers': 'suppliers',
        '/dashboard/purchases': 'purchases',
        '/dashboard/sell': 'sell',
        '/dashboard/sales': 'sales',
        '/dashboard/group-purchases': 'group-purchases',
        '/dashboard/credits': 'credits',
        '/dashboard/customers': 'customers',
        '/dashboard/users': 'users',
        '/dashboard/audit': 'audit',
        '/dashboard/settings': 'settings',
        '/dashboard/expenses': 'expenses'
    };

    var SECTION_INIT = {
        dashboard: 'initDashboardView',
        products: 'initProductsView',
        suppliers: 'initSuppliersView',
        purchases: 'initPurchasesView',
        sell: 'initSellView',
        sales: 'initSalesView',
        'group-purchases': 'initGroupPurchasesView',
        credits: 'initCreditsView',
        customers: 'initCustomersView',
        users: 'initUsersView',
        audit: 'initAuditView',
        settings: 'initSettingsView',
        expenses: 'initExpensesView'
    };

    var SECTION_META = {
        dashboard: { label: 'Dashboard', icon: 'bi-grid' },
        products: { label: 'Productos', icon: 'bi-box-seam' },
        suppliers: { label: 'Proveedores', icon: 'bi-building' },
        purchases: { label: 'Compras', icon: 'bi-bag' },
        sell: { label: 'Punto de Venta', icon: 'bi-cart3' },
        sales: { label: 'Ventas', icon: 'bi-bar-chart-line' },
        'group-purchases': { label: 'Compras Grupales', icon: 'bi-people' },
        credits: { label: 'Créditos', icon: 'bi-wallet2' },
        customers: { label: 'Clientes', icon: 'bi-person' },
        users: { label: 'Usuarios', icon: 'bi-person-gear' },
        audit: { label: 'Auditoría', icon: 'bi-shield-check' },
        settings: { label: 'Configuración', icon: 'bi-sliders' },
        expenses: { label: 'Gastos', icon: 'bi-cash-stack' }
    };

    function getViewFromPath(pathname) {
        var normalized = (pathname || '').replace(/\/$/, '') || '/dashboard';
        return ROUTES[normalized] || (normalized.indexOf('/dashboard') === 0 ? 'dashboard' : null);
    }

    function showLoading(show) {
        var el = document.getElementById(LOADING_ID);
        if (!el) return;
        if (show) {
            el.classList.remove('d-none');
            el.setAttribute('aria-hidden', 'false');
        } else {
            el.classList.add('d-none');
            el.setAttribute('aria-hidden', 'true');
        }
    }

    function runScriptsInContainer(container) {
        if (!container) return;
        var scripts = container.querySelectorAll('script');
        scripts.forEach(function (oldScript) {
            if (oldScript.src && (oldScript.src.indexOf('jquery') !== -1 || oldScript.src.indexOf('bootstrap') !== -1 || oldScript.src.indexOf('chart') !== -1)) {
                oldScript.parentNode.removeChild(oldScript);
                return;
            }
            var newScript = document.createElement('script');
            if (oldScript.src) {
                newScript.src = oldScript.src;
            } else {
                newScript.textContent = oldScript.textContent;
            }
            if (oldScript.type) newScript.type = oldScript.type;
            oldScript.parentNode.replaceChild(newScript, oldScript);
        });
    }

    function loadView(pathname, pushState) {
        var viewName = getViewFromPath(pathname);
        if (!viewName) {
            window.location.href = pathname || '/dashboard';
            return;
        }

        var path = '/dashboard' + (viewName === 'dashboard' ? '' : '/' + viewName);
        showLoading(true);

        fetch(path, {
            method: 'GET',
            headers: { 'X-SPA-Fragment': '1' }
        })
            .then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.text();
            })
            .then(function (html) {
                var parser = new DOMParser();
                var doc = parser.parseFromString(html, 'text/html');
                var wrapper = doc.getElementById(VIEW_WRAPPER_ID);
                if (!wrapper) {
                    document.getElementById(APP_CONTENT_ID).innerHTML = '<div class="alert alert-warning">Vista no disponible.</div>';
                    return;
                }

                var oldStyles = document.querySelectorAll('[data-dash-spa-style]');
                oldStyles.forEach(function (s) { if (s.parentNode) s.parentNode.removeChild(s); });

                var styleTags = doc.head.querySelectorAll('style');
                styleTags.forEach(function (styleEl) {
                    var newStyle = document.createElement('style');
                    newStyle.setAttribute('data-dash-spa-style', '1');
                    newStyle.textContent = styleEl.textContent;
                    document.head.appendChild(newStyle);
                });

                var appContent = document.getElementById(APP_CONTENT_ID);
                appContent.innerHTML = wrapper.innerHTML;

                runScriptsInContainer(appContent);

                var initFn = SECTION_INIT[viewName];
                if (initFn && typeof window[initFn] === 'function') {
                    setTimeout(function () { window[initFn](); }, 0);
                }

                document.body.classList.toggle('section-sell', viewName === 'sell');
                if (typeof updateSellCart === 'function') updateSellCart();

                var meta = SECTION_META[viewName] || { label: viewName, icon: 'bi-circle' };
                var titleEl = document.getElementById('topbarTitle');
                var iconEl = document.getElementById('topbarIcon');
                if (titleEl) titleEl.textContent = meta.label;
                if (iconEl) iconEl.className = 'bi ' + meta.icon;

                // Actualizar enlace activo en sidebar y mobile nav
                var navLinks = document.querySelectorAll('.sidebar .nav-link, .mobile-bottom-nav .nav-link');
                navLinks.forEach(function (link) {
                    link.classList.remove('active');
                    var ds = link.getAttribute('data-section');
                    if (ds === viewName) link.classList.add('active');
                });

                if (pushState && window.history && window.history.pushState) {
                    window.history.pushState({ dashView: viewName }, '', pathname || path);
                }
            })
            .catch(function () {
                document.getElementById(APP_CONTENT_ID).innerHTML = '<div class="alert alert-danger">Error al cargar. <a href="' + (pathname || '/dashboard') + '">Recargar</a></div>';
            })
            .finally(function () {
                showLoading(false);
            });
    }

    function navigate(pathname) {
        loadView(pathname, true);
    }

    function init() {
        var pathname = window.location.pathname;
        var viewName = getViewFromPath(pathname);

        if (!viewName) {
            if (pathname.indexOf('/dashboard') === 0) {
                window.location.replace('/dashboard');
            }
            return;
        }

        loadView(pathname, false);

        window.addEventListener('popstate', function () {
            var p = window.location.pathname;
            if (getViewFromPath(p)) loadView(p, false);
        });

        function handleNav(e) {
            var a = e.target.closest('a');
            if (!a || !a.href) return;
            var hrefAttr = (a.getAttribute('href') || '').trim();
            if (hrefAttr === '#' || hrefAttr === '') return;
            try {
                var url = new URL(a.href);
            } catch (err) { return; }
            if (url.origin !== window.location.origin) return;
            var path = url.pathname;
            if (getViewFromPath(path)) {
                e.preventDefault();
                e.stopPropagation();
                navigate(path);
                return false;
            }
        }

        document.addEventListener('click', handleNav, true);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.dashboardNavigate = function (path) {
        if (getViewFromPath(path)) navigate(path);
        else window.location.href = path;
    };

    // Sobrescribir showSection para que use el router SPA
    window.showSection = function (section) {
        var path = '/dashboard' + (section === 'dashboard' ? '' : '/' + section);
        if (getViewFromPath(path)) navigate(path);
        else window.location.href = path;
    };
})();
