/**
 * Router SPA para la zona de cliente: navegación sin recargar la página.
 * Al cambiar de sección se muestra un indicador de carga y se inyecta el contenido.
 */
(function () {
    'use strict';

    var APP_CONTENT_ID = 'app-content';
    var LOADING_ID = 'spa-loading';
    var VIEW_WRAPPER_ID = 'spa-view-content';

    var ROUTES = {
        '/customer': '/customer/catalog',
        '/customer/catalog': 'catalog',
        '/customer/cart': 'cart',
        '/customer/orders': 'orders',
        '/customer/checkout': 'checkout',
        '/customer/credits': 'credits',
        '/customer/group-purchases': 'group-purchases'
    };

    var PATH_TO_FILE = {
        'catalog': '/customer/catalog',
        'cart': '/customer/cart',
        'orders': '/customer/orders',
        'checkout': '/customer/checkout',
        'credits': '/customer/credits',
        'group-purchases': '/customer/group-purchases'
    };

    function getViewFromPath(pathname) {
        var normalized = pathname.replace(/\/$/, '') || '/customer';
        var viewPath = ROUTES[normalized];
        if (viewPath === undefined) return null;
        if (viewPath === '/customer/catalog') return 'catalog';
        return typeof viewPath === 'string' ? viewPath : null;
    }

    function getPathForView(viewName) {
        return PATH_TO_FILE[viewName] || '/customer/catalog';
    }

    function showLoading(show) {
        var el = document.getElementById(LOADING_ID);
        if (!el) return;
        if (show) {
            el.classList.remove('hidden');
            el.setAttribute('aria-hidden', 'false');
        } else {
            el.classList.add('hidden');
            el.setAttribute('aria-hidden', 'true');
        }
    }

    function runScriptsInContainer(container) {
        if (!container) return;
        var scripts = container.querySelectorAll('script');
        scripts.forEach(function (oldScript) {
            if (oldScript.src && (oldScript.src.indexOf('jquery') !== -1 || oldScript.src.indexOf('bootstrap') !== -1)) {
                oldScript.parentNode.removeChild(oldScript);
                return;
            }
            var newScript = document.createElement('script');
            if (oldScript.src) {
                newScript.src = oldScript.src;
            } else {
                var code = oldScript.textContent;
                code = code.replace(/\blet\s+customer\b/g, 'var customer');
                code = code.replace(/\bconst\s+customer\b/g, 'var customer');
                code = code.replace(/\blet\s+customerGroupPurchases\b/g, 'var customerGroupPurchases');
                code = code.replace(/\bconst\s+customerGroupPurchases\b/g, 'var customerGroupPurchases');
                code = code.replace(/\blet\s+cart\b/g, 'var cart');
                code = code.replace(/\bconst\s+cart\b/g, 'var cart');
                code = code.replace(/\blet\s+currentTaxRate\b/g, 'var currentTaxRate');
                code = code.replace(/\bconst\s+currentTaxRate\b/g, 'var currentTaxRate');
                newScript.textContent = code;
            }
            if (oldScript.type) newScript.type = oldScript.type;
            oldScript.parentNode.replaceChild(newScript, oldScript);
        });
    }

    function loadView(pathname, pushState) {
        var viewName = getViewFromPath(pathname);
        if (!viewName) {
            window.location.href = pathname;
            return;
        }

        var path = getPathForView(viewName);
        showLoading(true);

        var fetchOpts = {
            method: 'GET',
            headers: { 'X-SPA-Fragment': '1' }
        };

        fetch(path, fetchOpts)
            .then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.text();
            })
            .then(function (html) {
                var parser = new DOMParser();
                var doc = parser.parseFromString(html, 'text/html');
                var wrapper = doc.getElementById(VIEW_WRAPPER_ID);
                if (!wrapper) {
                    document.getElementById(APP_CONTENT_ID).innerHTML = '<div class="container mt-4"><div class="alert alert-warning">Vista no disponible.</div></div>';
                    return;
                }

                // Quitar estilos y recursos de la vista anterior (inyectados por SPA)
                var oldStyles = document.querySelectorAll('[data-spa-view-style]');
                oldStyles.forEach(function (s) { s.parentNode.removeChild(s); });

                // Inyectar estilos de esta vista
                var styleTags = doc.head.querySelectorAll('style');
                styleTags.forEach(function (styleEl) {
                    var newStyle = document.createElement('style');
                    newStyle.setAttribute('data-spa-view-style', '1');
                    newStyle.textContent = styleEl.textContent;
                    document.head.appendChild(newStyle);
                });

                // Inyectar <link rel="stylesheet"> externos del <head> de la vista
                var linkTags = doc.head.querySelectorAll('link[rel="stylesheet"]');
                linkTags.forEach(function (linkEl) {
                    var href = linkEl.getAttribute('href');
                    if (!href) return;
                    // No duplicar si ya existe en el documento
                    if (document.querySelector('link[href="' + href + '"]')) return;
                    var newLink = document.createElement('link');
                    newLink.rel = 'stylesheet';
                    newLink.href = href;
                    newLink.setAttribute('data-spa-view-style', '1');
                    document.head.appendChild(newLink);
                });

                // Inyectar <script type="module"> del <head> de la vista
                var scriptTags = doc.head.querySelectorAll('script[type="module"]');
                scriptTags.forEach(function (scriptEl) {
                    var src = scriptEl.getAttribute('src');
                    if (!src) return;
                    // No duplicar si ya existe
                    if (document.querySelector('script[src="' + src + '"]')) return;
                    var newScript = document.createElement('script');
                    newScript.type = 'module';
                    newScript.src = src;
                    newScript.setAttribute('data-spa-view-style', '1');
                    document.head.appendChild(newScript);
                });

                var appContent = document.getElementById(APP_CONTENT_ID);
                appContent.innerHTML = wrapper.innerHTML;

                var titleEl = doc.querySelector('title');
                if (titleEl && titleEl.textContent) {
                    document.title = titleEl.textContent;
                }

                runScriptsInContainer(appContent);

                if (pushState && window.history && window.history.pushState) {
                    window.history.pushState({ spaView: viewName }, '', pathname);
                }
            })
            .catch(function () {
                document.getElementById(APP_CONTENT_ID).innerHTML = '<div class="container mt-4"><div class="alert alert-danger">Error al cargar. <a href="' + pathname + '">Recargar</a></div></div>';
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
            if (pathname.indexOf('/customer') === 0 && pathname !== '/customer/login' && pathname !== '/customer/register') {
                window.location.replace('/customer/catalog');
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
            if (path === '/customer/login' || path === '/customer/register') return;
            if (getViewFromPath(path)) {
                e.preventDefault();
                e.stopPropagation();
                navigate(path);
                return false;
            }
        }

        document.addEventListener('click', handleNav, true);
        document.addEventListener('touchstart', handleNav, { passive: false, capture: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.spaNavigate = function (path) {
        if (getViewFromPath(path)) navigate(path);
        else window.location.href = path;
    };
})();
