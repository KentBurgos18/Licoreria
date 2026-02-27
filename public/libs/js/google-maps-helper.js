/**
 * Google Maps Helper - Funciones compartidas para selección de ubicación
 * 
 * Uso:
 * 1. Incluir este archivo en tu HTML
 * 2. Configurar las opciones antes de usar:
 *    GoogleMapsHelper.config({
 *      addressFieldId: '#address',
 *      latitudeFieldId: '#latitude',
 *      longitudeFieldId: '#longitude',
 *      mapId: 'MY_MAP_ID',
 *      defaultLocation: { lat: 19.4326, lng: -99.1332 },
 *      countryRestriction: 'ec' // opcional
 *    });
 * 3. Llamar GoogleMapsHelper.openMapModal() para abrir el modal
 */

const GoogleMapsHelper = (function() {
    // Variables privadas
    let config = {
        addressFieldId: '#address',
        latitudeFieldId: '#latitude',
        longitudeFieldId: '#longitude',
        mapId: 'DEFAULT_MAP_ID',
        defaultLocation: { lat: 19.4326, lng: -99.1332 },
        countryRestriction: null,
        onLocationSelected: null // Callback cuando se confirma la ubicación
    };

    let googleMap = null;
    let googleMarker = null;
    let geocoder = null;
    let selectedMapLocation = { latitude: null, longitude: null, address: '' };
    let mapsLibrariesLoaded = false;

    /**
     * Configurar opciones del helper
     */
    function configure(options) {
        config = { ...config, ...options };
    }

    /**
     * Precargar librerías de Google Maps
     */
    async function preloadLibraries() {
        try {
            if (typeof google !== 'undefined' && typeof google.maps !== 'undefined') {
                await Promise.all([
                    google.maps.importLibrary("maps"),
                    google.maps.importLibrary("places"),
                    google.maps.importLibrary("marker")
                ]);
                mapsLibrariesLoaded = true;
                console.log('Google Maps libraries precargadas');
            }
        } catch (err) {
            console.warn('No se pudieron precargar las librerías de Google Maps:', err);
        }
    }

    function isMobileOrTouch() {
        return typeof window.orientation !== 'undefined' ||
            /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
            (navigator.maxTouchPoints && navigator.maxTouchPoints > 0);
    }

    /**
     * Destruir mapa anterior para evitar errores al reabrir el modal
     */
    function destroyMapIfExists() {
        if (googleMarker) {
            if (googleMarker.setMap) googleMarker.setMap(null);
            googleMarker = null;
        }
        if (googleMap) {
            googleMap = null;
        }
        var mapContainer = document.getElementById('googleMap');
        if (mapContainer) {
            mapContainer.innerHTML = '';
        }
    }

    /**
     * Abrir modal del mapa
     */
    async function openMapModal() {
        try {
            if (typeof google === 'undefined' || typeof google.maps === 'undefined') {
                if (typeof showAlert === 'function') {
                    showAlert('Google Maps no está cargado. Espera un momento y vuelve a intentar.', 'warning');
                } else {
                    alert('Google Maps no está cargado. Espera un momento y vuelve a intentar.');
                }
                return;
            }
            // Asegurar que las librerías estén cargadas
            if (!mapsLibrariesLoaded) {
                await Promise.all([
                    google.maps.importLibrary("maps"),
                    google.maps.importLibrary("places"),
                    google.maps.importLibrary("marker")
                ]);
                mapsLibrariesLoaded = true;
            }

            destroyMapIfExists();

            // Resetear ubicación seleccionada
            selectedMapLocation = { latitude: null, longitude: null, address: '' };
            $('#selectedAddress').val('');
            $('#selectedLatitude').val('');
            $('#selectedLongitude').val('');

            // Limpiar input de búsqueda si existe
            const fallbackInput = document.getElementById('mapSearchInputFallback');
            if (fallbackInput) fallbackInput.value = '';

            // Mostrar modal inmediatamente
            const mapModalElement = document.getElementById('mapModal');
            const modal = new bootstrap.Modal(mapModalElement, {
                backdrop: 'static',
                keyboard: true  // Permitir cerrar con Escape
            });
            modal.show();

            // En móvil el contenedor puede tener tamaño 0 hasta que el modal termine de mostrarse.
            // Esperar más en móvil para que el layout tenga dimensiones reales (evita error de Google Maps).
            mapModalElement.addEventListener('shown.bs.modal', function() {
                var delay = isMobileOrTouch() ? 400 : 80;
                setTimeout(function() { initializeMap(); }, delay);
            }, { once: true });
        } catch (err) {
            console.error('Error cargando Google Maps:', err);
            if (typeof showAlert === 'function') {
                showAlert('Error al cargar el mapa. Intenta de nuevo.', 'danger');
            } else {
                alert('Error al cargar el mapa. Intenta de nuevo.');
            }
        }
    }

    /**
     * Inicializar el mapa
     */
    async function initializeMap() {
        const mapContainer = document.getElementById('googleMap');
        if (!mapContainer) {
            console.error('Contenedor del mapa no encontrado');
            return;
        }

        // Verificar si Google Maps está disponible
        if (typeof google === 'undefined' || typeof google.maps === 'undefined') {
            console.error('Google Maps no está cargado.');
            if (typeof showAlert === 'function') {
                showAlert('Error: Google Maps no está disponible. Verifica tu conexión a internet.', 'danger');
            }
            return;
        }

        // Determinar ubicación inicial
        let initialLocation = config.defaultLocation;
        
        // Intentar obtener ubicación guardada
        const savedLat = $(config.latitudeFieldId).val();
        const savedLng = $(config.longitudeFieldId).val();
        if (savedLat && savedLng) {
            initialLocation = { lat: parseFloat(savedLat), lng: parseFloat(savedLng) };
        } else if (navigator.geolocation) {
            // Intentar obtener ubicación actual al cargar
            $('#selectedAddress').val('Obteniendo tu ubicación...');
            navigator.geolocation.getCurrentPosition(
                function(position) {
                    initialLocation = {
                        lat: position.coords.latitude,
                        lng: position.coords.longitude
                    };
                    initMapWithLocation(initialLocation);
                },
                function(error) {
                    console.warn('No se pudo obtener ubicación al cargar:', error.code, error.message);
                    if (typeof showAlert === 'function') {
                        var msg = 'No se pudo detectar tu ubicación. Se muestra ubicación por defecto. Usa el botón "Detectar mi ubicación" cuando el mapa cargue.';
                        if (error.code === 1) msg += ' (Permiso denegado o bloqueado por el navegador; en HTTP a veces no está disponible.)';
                        showAlert(msg, 'info');
                    }
                    $('#selectedAddress').val('');
                    initMapWithLocation(initialLocation);
                },
                {
                    enableHighAccuracy: true,
                    timeout: 12000,
                    maximumAge: 0
                }
            );
            return; // Se inicializará en el callback
        }

        // Inicializar con ubicación por defecto
        await initMapWithLocation(initialLocation);
    }

    /**
     * Comprueba si el mapId es un placeholder (no es un ID real de Google Cloud).
     * Los Map ID reales suelen ser alfanuméricos cortos; placeholders como LICORERIA_MAP_ID fallan en móvil.
     */
    function isPlaceholderMapId(id) {
        if (!id || typeof id !== 'string') return true;
        var s = id.toUpperCase();
        return s === 'DEFAULT_MAP_ID' || s === 'LICORERIA_MAP_ID' || s.indexOf('MAP_ID') !== -1;
    }

    /**
     * Inicializar mapa con ubicación específica.
     * En móvil o con Map ID placeholder se usa siempre mapa clásico + Marker (máxima compatibilidad).
     */
    async function initMapWithLocation(location) {
        // Asegurar que las librerías estén cargadas
        if (!mapsLibrariesLoaded) {
            await Promise.all([
                google.maps.importLibrary("maps"),
                google.maps.importLibrary("places"),
                google.maps.importLibrary("marker")
            ]);
            mapsLibrariesLoaded = true;
        }

        const { Map } = await google.maps.importLibrary("maps");
        var mapContainer = document.getElementById('googleMap');
        if (!mapContainer) return;

        // En móvil/touch o con contenedor sin tamaño, esperar y reintentar (máx 3 veces)
        var attempts = 0;
        while (mapContainer.offsetWidth < 50 || mapContainer.offsetHeight < 50) {
            if (attempts++ >= 3) break;
            await new Promise(function(r) { setTimeout(r, 150); });
        }

        var useClassicMap = isMobileOrTouch() || isPlaceholderMapId(config.mapId);
        var mapOptions = {
            center: location,
            zoom: 17,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: true,
            zoomControl: true,
            gestureHandling: 'greedy'  // Un solo dedo para mover el mapa (en móvil no exige dos dedos)
        };
        if (!useClassicMap && config.mapId) {
            mapOptions.mapId = config.mapId;
        }

        try {
            googleMap = new Map(mapContainer, mapOptions);
        } catch (e) {
            console.warn('Mapa falló, reintentando sin mapId:', e);
            delete mapOptions.mapId;
            googleMap = new Map(mapContainer, mapOptions);
        }

        // Resize tras un frame para que el contenedor tenga tamaño (sobre todo en móvil)
        setTimeout(function() {
            if (googleMap) {
                google.maps.event.trigger(googleMap, 'resize');
                googleMap.setCenter(location);
            }
        }, 150);

        // En móvil o sin Map ID válido usar siempre Marker clásico (evita error "página no cargó bien Google Maps")
        if (useClassicMap) {
            googleMarker = new google.maps.Marker({
                position: location,
                map: googleMap,
                draggable: true,
                title: 'Arrastra para ajustar ubicación'
            });
        } else {
            try {
                var AdvancedMarkerElement = (await google.maps.importLibrary("marker")).AdvancedMarkerElement;
                googleMarker = new AdvancedMarkerElement({
                    position: location,
                    map: googleMap,
                    gmpDraggable: true,
                    title: 'Arrastra para ajustar ubicación'
                });
            } catch (e) {
                googleMarker = new google.maps.Marker({
                    position: location,
                    map: googleMap,
                    draggable: true,
                    title: 'Arrastra para ajustar ubicación'
                });
            }
        }

        geocoder = new google.maps.Geocoder();

        // Evento al hacer clic en el mapa
        googleMap.addListener('click', function(event) {
            var clickedLocation = {
                lat: event.latLng.lat(),
                lng: event.latLng.lng()
            };
            if (googleMarker.setPosition) {
                googleMarker.setPosition(clickedLocation);
            } else {
                googleMarker.position = clickedLocation;
            }
            geocodeLatLng(clickedLocation.lat, clickedLocation.lng);
        });

        // Evento al arrastrar el marcador (Marker clásico usa getPosition(), AdvancedMarker usa position)
        google.maps.event.addListener(googleMarker, 'dragend', function() {
            var pos = googleMarker.getPosition ? googleMarker.getPosition() : googleMarker.position;
            var lat = typeof pos.lat === 'function' ? pos.lat() : pos.lat;
            var lng = typeof pos.lng === 'function' ? pos.lng() : pos.lng;
            geocodeLatLng(lat, lng);
        });

        await initPlacesAutocomplete();
        geocodeLatLng(location.lat, location.lng);
    }

    /**
     * Inicializar Places Autocomplete usando PlaceAutocompleteElement con bias de ubicación
     */
    async function initPlacesAutocomplete() {
        const container = document.getElementById('placesAutocompleteContainer');
        if (!container) return;

        try {
            const { PlaceAutocompleteElement } = await google.maps.importLibrary("places");

            // Quitar placeholder de carga y limpiar contenedor
            const ph = document.getElementById('mapSearchPlaceholder');
            if (ph) ph.remove();
            container.innerHTML = '';

            const autocompleteOptions = {};

            // Restringir a país si está configurado
            if (config.countryRestriction) {
                autocompleteOptions.includedRegionCodes = [config.countryRestriction.toUpperCase()];
            }

            // Bias: construir LatLngBounds real para que Google lo respete correctamente
            if (config.locationBias && config.locationBias.north !== undefined) {
                autocompleteOptions.locationBias = new google.maps.LatLngBounds(
                    { lat: config.locationBias.south, lng: config.locationBias.west },
                    { lat: config.locationBias.north, lng: config.locationBias.east }
                );
            }

            const placeAutocomplete = new PlaceAutocompleteElement(autocompleteOptions);
            placeAutocomplete.style.width = '100%';
            placeAutocomplete.style.display = 'block';
            placeAutocomplete.style.colorScheme = 'light';
            placeAutocomplete.style.backgroundColor = 'white';
            placeAutocomplete.setAttribute('placeholder', 'Buscar dirección, negocio o lugar...');

            container.appendChild(placeAutocomplete);

            // Inyectar estilos en Shadow DOM cuando esté listo (reintenta hasta 20 veces)
            function injectShadowStyles(attempts) {
                try {
                    const sr = placeAutocomplete.shadowRoot;
                    const inp = sr && sr.querySelector('input');
                    if (inp) {
                        inp.setAttribute('placeholder', 'Buscar dirección, negocio o lugar...');
                        const style = document.createElement('style');
                        style.textContent = `
                            input {
                                height: 48px !important;
                                line-height: normal !important;
                                padding-top: 0 !important;
                                padding-bottom: 0 !important;
                                vertical-align: middle !important;
                            }
                        `;
                        sr.appendChild(style);
                    } else if (attempts > 0) {
                        setTimeout(() => injectShadowStyles(attempts - 1), 100);
                    }
                } catch(e) {}
            }
            injectShadowStyles(20);

            placeAutocomplete.addEventListener('gmp-select', async ({ placePrediction }) => {
                try {
                    const place = placePrediction.toPlace();
                    await place.fetchFields({ fields: ['displayName', 'formattedAddress', 'location'] });

                    if (!place.location) {
                        if (typeof showAlert === 'function') showAlert('No se encontró la ubicación.', 'warning');
                        return;
                    }

                    const lat = place.location.lat();
                    const lng = place.location.lng();

                    googleMap.setCenter(place.location);
                    googleMap.setZoom(18);
                    if (googleMarker.setPosition) {
                        googleMarker.setPosition({ lat, lng });
                    } else {
                        googleMarker.position = { lat, lng };
                    }

                    const address = place.formattedAddress || place.displayName || `${lat}, ${lng}`;
                    updateSelectedLocation(address, lat, lng);
                } catch (err) {
                    console.error('Error obteniendo detalles del lugar:', err);
                }
            });

        } catch (error) {
            console.error('Error inicializando Places Autocomplete:', error);
            createFallbackSearchInput(container);
        }
    }

    /**
     * Crear input de búsqueda fallback
     */
    function createFallbackSearchInput(container) {
        container.innerHTML = `
            <div class="input-group">
                <span class="input-group-text"><i class="bi bi-search"></i></span>
                <input type="text" class="form-control" id="mapSearchInputFallback" 
                       placeholder="Buscar dirección, negocio o lugar...">
                <button class="btn btn-primary" type="button" id="searchAddressBtn">
                    <i class="bi bi-search"></i>
                </button>
            </div>
        `;

        const searchInput = document.getElementById('mapSearchInputFallback');
        const searchBtn = document.getElementById('searchAddressBtn');

        searchInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                searchAddressWithGeocoder(searchInput.value);
            }
        });

        searchBtn.addEventListener('click', function() {
            searchAddressWithGeocoder(searchInput.value);
        });
    }

    /**
     * Buscar dirección con Geocoder
     */
    function searchAddressWithGeocoder(address) {
        if (!address || address.trim() === '') {
            if (typeof showAlert === 'function') {
                showAlert('Por favor ingresa una dirección para buscar.', 'warning');
            }
            return;
        }

        const geocoderOptions = { address: address };
        if (config.countryRestriction) {
            geocoderOptions.componentRestrictions = { country: config.countryRestriction.toUpperCase() };
        }

        geocoder.geocode(geocoderOptions, function(results, status) {
            if (status === 'OK' && results[0]) {
                const location = results[0].geometry.location;
                const lat = location.lat();
                const lng = location.lng();

                googleMap.setCenter(location);
                googleMap.setZoom(18);
                if (googleMarker.setPosition) {
                    googleMarker.setPosition({ lat: lat, lng: lng });
                } else {
                    googleMarker.position = { lat: lat, lng: lng };
                }

                updateSelectedLocation(results[0].formatted_address, lat, lng);
            } else {
                if (typeof showAlert === 'function') {
                    showAlert('No se encontró la dirección. Intenta con otra búsqueda o haz clic en el mapa.', 'warning');
                }
            }
        });
    }

    /**
     * Geocodificar lat/lng a dirección
     */
    function geocodeLatLng(lat, lng) {
        if (!geocoder) return;

        geocoder.geocode({ location: { lat, lng } }, function(results, status) {
            if (status === 'OK' && results[0]) {
                updateSelectedLocation(results[0].formatted_address, lat, lng);
            } else {
                updateSelectedLocation(`Lat: ${lat.toFixed(6)}, Lng: ${lng.toFixed(6)}`, lat, lng);
            }
        });
    }

    /**
     * Actualizar ubicación seleccionada
     */
    function updateSelectedLocation(address, lat, lng) {
        selectedMapLocation = {
            address: address,
            latitude: lat,
            longitude: lng
        };

        $('#selectedAddress').val(address);
        $('#selectedLatitude').val(lat.toFixed(6));
        $('#selectedLongitude').val(lng.toFixed(6));
    }

    /**
     * Confirmar ubicación seleccionada
     */
    function confirmMapLocation() {
        if (!selectedMapLocation.latitude || !selectedMapLocation.longitude) {
            if (typeof showAlert === 'function') {
                showAlert('Por favor selecciona una ubicación en el mapa primero.', 'warning');
            } else {
                alert('Por favor selecciona una ubicación en el mapa primero.');
            }
            return;
        }

        // Guardar en los campos configurados
        $(config.addressFieldId).val(selectedMapLocation.address);
        $(config.latitudeFieldId).val(selectedMapLocation.latitude);
        $(config.longitudeFieldId).val(selectedMapLocation.longitude);

        // Cerrar modal
        bootstrap.Modal.getInstance(document.getElementById('mapModal')).hide();

        // Ejecutar callback si existe
        if (config.onLocationSelected && typeof config.onLocationSelected === 'function') {
            config.onLocationSelected(selectedMapLocation);
        }

        // Mostrar mensaje de éxito
        if (typeof showAlert === 'function') {
            showAlert('Ubicación seleccionada correctamente', 'success');
        }
    }

    /**
     * Obtener ubicación actual del dispositivo (botón "Detectar mi ubicación")
     */
    function getCurrentLocation() {
        if (!navigator.geolocation) {
            if (typeof showAlert === 'function') {
                showAlert('Tu navegador no soporta la detección de ubicación.', 'warning');
            }
            return;
        }
        if (!googleMap || !googleMarker) {
            if (typeof showAlert === 'function') {
                showAlert('Espera a que el mapa termine de cargar e inténtalo de nuevo.', 'warning');
            } else {
                alert('Espera a que el mapa termine de cargar e inténtalo de nuevo.');
            }
            return;
        }

        $('#selectedAddress').val('Detectando tu ubicación...');

        navigator.geolocation.getCurrentPosition(
            function(position) {
                var lat = position.coords.latitude;
                var lng = position.coords.longitude;
                if (googleMarker.setPosition) {
                    googleMarker.setPosition({ lat: lat, lng: lng });
                } else {
                    googleMarker.position = { lat: lat, lng: lng };
                }
                googleMap.setCenter({ lat: lat, lng: lng });
                googleMap.setZoom(17);
                geocodeLatLng(lat, lng);
                if (typeof showAlert === 'function') {
                    showAlert('Ubicación detectada correctamente.', 'success');
                }
            },
            function(error) {
                var mensaje = 'No se pudo obtener tu ubicación. ';
                if (error.code === 1) {
                    mensaje += 'Permiso denegado. Permite el acceso a la ubicación en tu navegador (candado o ícono de ubicación en la barra). Si entras por HTTP (sin candado), algunos navegadores no permiten la ubicación; prueba con HTTPS si es posible.';
                } else if (error.code === 2) {
                    mensaje += 'Posición no disponible. Comprueba que el GPS o la ubicación estén activos en el dispositivo.';
                } else if (error.code === 3) {
                    mensaje += 'Tardó demasiado. Comprueba que el GPS esté activo e inténtalo de nuevo.';
                } else {
                    mensaje += 'Selecciona la ubicación manualmente en el mapa o busca una dirección.';
                }
                console.warn('Error geolocalización:', error.code, error.message);
                $('#selectedAddress').val('');
                $('#selectedAddress').attr('placeholder', 'Haz clic en el mapa o busca una dirección');
                if (typeof showAlert === 'function') {
                    showAlert(mensaje, 'warning');
                } else {
                    alert(mensaje);
                }
            },
            {
                enableHighAccuracy: true,
                timeout: 15000,
                maximumAge: 0
            }
        );
    }

    // API pública
    return {
        config: configure,
        preload: preloadLibraries,
        openMapModal: openMapModal,
        confirmMapLocation: confirmMapLocation,
        getCurrentLocation: getCurrentLocation
    };
})();
