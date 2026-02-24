# Guía de diseño UI – LOCOBAR (Cliente y Administrador)

Sugerencias para un diseño **elegante, sencillo y amigable** en ambas interfaces, manteniendo coherencia con tu marca y Bootstrap.

---

## 1. Principios generales

- **Claridad**: jerarquía visual clara (títulos, subtítulos, acciones).
- **Consistencia**: misma paleta, tipografía y espaciado en cliente y admin.
- **Accesibilidad**: contraste suficiente, botones y áreas táctiles ≥ 44px en móvil.
- **Menos es más**: evitar decoración innecesaria; priorizar contenido y acciones.

---

## 2. Paleta de colores unificada

### Colores principales (marca LOCOBAR)

| Uso | Hex | Uso en UI |
|-----|-----|-----------|
| **Primario oscuro** | `#0f3460` | Navbar, botones principales, enlaces, focus |
| **Primario medio** | `#16213e` | Gradientes, hover |
| **Primario suave** | `#1a1a2e` | Fondos oscuros, gradientes |
| **Acento** | `#e94560` o `#ff6b6b` | CTAs importantes, alertas suaves, “Comprar” |

### Fondos y superficies

| Uso | Hex | Uso en UI |
|-----|-----|-----------|
| **Fondo página** | `#f8f9fa` | Admin y listas (cliente en modo claro) |
| **Tarjetas / cards** | `#ffffff` | Productos, resúmenes, formularios |
| **Bordes suaves** | `#e9ecef` | Separadores, inputs |

### Estados y feedback

| Estado | Sugerencia |
|--------|------------|
| **Éxito** | `#198754` (verde Bootstrap) o `#0d9488` |
| **Advertencia** | `#f59e0b` (ámbar) |
| **Error** | `#dc3545` (rojo Bootstrap) |
| **Info** | `#0ea5e9` (azul claro) |

**Recomendación**: Definir estas variables en un único archivo CSS (por ejemplo `public/css/theme.css`) y usarlas en cliente y admin para mantener coherencia.

---

## 3. Tipografía

- **Títulos**: una sola familia (ej. `"Inter"`, `"Plus Jakarta Sans"` o la que ya uses). Peso 600–700 para H1/H2.
- **Cuerpo**: misma familia, tamaño base 16px en móvil para legibilidad.
- **Números y precios**: misma familia; opcionalmente `tabular-nums` para alinear cifras.

Ejemplo de import (Google Fonts) y variables:

```css
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');

:root {
  --font-sans: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
  --text-base: 1rem;
  --text-sm: 0.875rem;
  --text-lg: 1.125rem;
  --heading-1: 1.75rem;
  --heading-2: 1.35rem;
}
body { font-family: var(--font-sans); }
```

Así el sistema se ve más moderno y uniforme sin cambiar tu estructura HTML.

---

## 4. Diseño para el **cliente** (app cliente / catálogo / carrito / checkout)

### 4.1 Objetivo

Experiencia **rápida y clara** en móvil y escritorio: ver productos, agregar al carrito y pagar con el mínimo de fricción.

### 4.2 Navbar (ya tienes buena base)

- Mantener el gradiente oscuro (`#1a1a2e` → `#0f3460`).
- Logo/banner siempre visible; en móvil solo icono de usuario si hace falta.
- Un solo menú (icono usuario) con: Mis Pedidos, Crédito, Compras Grupales, Cerrar sesión.
- **Sugerencia**: altura fija (ej. 56px) y `position: sticky; top: 0; z-index: 1020` para que al hacer scroll siga visible.

### 4.3 Catálogo

- **Tarjetas de producto**: mantener layout horizontal (imagen izquierda, datos derecha) en móvil; opcionalmente en escritorio pasar a grid de 2–3 columnas con tarjeta más cuadrada.
- **Bordes**: `border-radius: 12px` y `box-shadow: 0 1px 3px rgba(0,0,0,0.08)` para dar profundidad sutil.
- **Botón “Agregar”**: color primario `#0f3460` o acento `#e94560`; siempre visible, altura ≥ 44px en móvil.
- **Búsqueda**: barra con icono; `border-radius: 24px` para aspecto más amigable.

### 4.4 Carrito

- Lista de ítems con imagen, nombre, cantidad (+/-) y subtotal.
- Controles de cantidad grandes y fáciles de tocar (como ya tienes con `.quantity-controls`).
- **Resumen fijo abajo** (sticky): total, botón “Ir a pagar” en color primario o acento, siempre visible en móvil.

### 4.5 Checkout

- Pasos claros: 1) Resumen → 2) Método de pago → 3) Confirmación.
- Métodos de pago en tarjetas seleccionables (como ya haces) con borde/relleno al elegir.
- Botón “Pagar” destacado (tamaño grande, color acento o primario).
- Página de resultado (éxito/error) con icono grande, mensaje corto y botón “Volver al catálogo”.

### 4.6 Espaciado y contenedor

- Contenedor principal: `max-width: 480px` en móvil centrado; en tablet/desktop hasta 720px si quieres.
- Padding horizontal constante (ej. 16px) y entre secciones 24px para respirar.

---

## 5. Diseño para el **administrador** (dashboard / POS / configuración)

### 5.1 Objetivo

Interfaz **eficiente y ordenada** para operar muchas horas: sidebar estable, contenido escaneable y acciones evidentes.

### 5.2 Sidebar

- Mantener ancho fijo (ej. 260px); fondo `#1a1a2e` o `#16213e` para alinearlo con la marca.
- Ítems con icono + texto; padding 12px 16px; `border-radius: 8px` en el ítem.
- **Activo**: fondo `#0f3460` o `rgba(255,255,255,0.1)` y texto blanco.
- **Hover**: `background: rgba(255,255,255,0.06)`.
- Logo arriba; al final “Cerrar sesión” con icono.

### 5.3 Área principal (main content)

- Fondo `#f8f9fa`; `margin-left: 260px` (o el ancho del sidebar).
- Barra superior (navbar admin): fondo blanco o `#ffffff` con sombra sutil; título de sección a la izquierda; notificaciones y usuario a la derecha.

### 5.4 Tarjetas de estadísticas (dashboard)

- Unificar estilo: fondo blanco, `border-radius: 12px`, `box-shadow: 0 1px 3px rgba(0,0,0,0.08)`.
- **Color por tipo** con una franja izquierda o un icono de color en lugar de todo el fondo en gradiente:
  - Ventas: franja `#0f3460`
  - Éxito/entregas: franja `#198754`
  - Pendientes: franja `#f59e0b`
  - Info: franja `#0ea5e9`
- Número grande y legible; etiqueta pequeña debajo (ej. “Ventas hoy”).

### 5.5 Tablas y listas

- Cabeceras con fondo `#f8f9fa`, texto en negrita.
- Filas alternadas suaves (`tbody tr:nth-child(even) { background: #f8f9fa; }`) o sin alternar si prefieres más limpio.
- Botones de acción (editar, anular) con iconos; no abusar de color (solo para destructivas usar rojo).

### 5.6 POS

- Mantener burbuja de carrito; color coherente con la paleta (ej. `#0f3460` o acento).
- Productos en grid; cada producto con imagen, nombre y precio; botón “+” claro.
- Panel del carrito a la derecha (o abajo en móvil) con total y botón “Cobrar” destacado.

---

## 6. Componentes reutilizables (cliente y admin)

- **Botón primario**: fondo `#0f3460`, texto blanco, `border-radius: 8px`, padding 10px 20px.
- **Botón secundario**: borde `#0f3460`, texto `#0f3460`, fondo transparente; mismo border-radius.
- **Inputs**: `border: 1px solid #e9ecef`, `border-radius: 8px`, focus con `border-color: #0f3460` y `box-shadow: 0 0 0 3px rgba(15, 52, 96, 0.15)`.
- **Cards**: fondo blanco, `border-radius: 12px`, `box-shadow: 0 1px 3px rgba(0,0,0,0.08)`.
- **Badges** (stock, combo, etc.): `border-radius: 6px` o pill; colores según estado (verde/ámbar/rojo).

---

## 7. Resumen de prioridades de implementación

1. **Un solo archivo de tema** (`public/css/theme.css`) con variables CSS (colores, fuentes, radios, sombras) y usarlo en cliente y admin.
2. **Cliente**: navbar sticky, cards con sombra suave y radio 12px, botón “Agregar/Pagar” bien visible y táctil.
3. **Admin**: sidebar con colores de marca, tarjetas de estadísticas con franja de color en lugar de gradiente completo, tablas limpias.
4. **Tipografía**: una familia moderna (Plus Jakarta Sans o Inter) en todo el sistema.
5. **Acento opcional**: un color (ej. `#e94560`) solo para CTAs principales (Comprar, Cobrar, Pagar) para dar un toque elegante sin recargar.

Con estos puntos tendrás una base **elegante, sencilla y amigable** para ambos roles, sin cambiar tu stack ni la estructura de las vistas actuales.
