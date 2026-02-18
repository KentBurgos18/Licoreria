# Sistema de Combos Virtuales - Licorería

## Implementación Completa

He implementado el sistema de combos virtuales según tus especificaciones. La solución incluye:

### 📊 Base de Datos
- **Migraciones SQL** para soportar productos simples y combos
- Tabla `product_components` para la BOM (Bill of Materials) de combos
- Restricciones para asegurar integridad de datos

### 🔧 Backend (Node.js/Sequelize)
- **Modelos**: Product, ProductComponent, InventoryMovement
- **ComboService**: Lógica de negocio para cálculo de stock y validaciones
- **Endpoints API** completos para gestión de combos y ventas

### 🎨 Frontend (HTML/Bootstrap/jQuery)
- **UI Creación de Productos**: Selector SIMPLE/COMBO con gestión de componentes
- **UI Gestión de Combos**: Edición de componentes con visualización de stock
- **POS Actualizado**: Muestra disponibilidad de combos y validación de stock

### 📈 Reportes
- **Reporte de Ventas de Combos**: Con descuento implícito y márgenes
- **Reporte de Performance**: Métricas por combo y análisis general

---

## 🚀 Características Principales

### ✅ Reglas de Negocio Implementadas
1. **Combo sin stock propio** - 100% basado en componentes
2. **Cálculo de stock en tiempo real**: `floor(min(stock_componente_i / qty_i))`
3. **Validación de venta** con bloqueo si falta stock
4. **Anulación con reversión** automática de inventario

### 🎯 API Endpoints
- `POST /api/products` - Crear SIMPLE o COMBO
- `POST /api/products/:id/components` - Gestionar componentes
- `GET /api/products/:id/availability` - Ver disponibilidad
- `POST /api/sales` - Venta con soporte de combos
- `POST /api/sales/:id/void` - Anular venta
- `GET /api/reports/combo-sales` - Reportes de combos

### 💡 UI/UX Features
- **Selector visual** de tipo de producto
- **Gestión dinámica** de componentes con búsqueda
- **Indicadores de stock** en POS con colores
- **Alertas inmediatas** si falta stock de componentes
- **Previsualización** de costo y margen de combos

---

## 📁 Estructura de Archivos

```
Licorería/
├── database/
│   └── migrations/
│       ├── 001_add_product_type_to_products.sql
│       ├── 002_create_product_components.sql
│       └── 003_add_simple_product_constraint.sql
├── models/
│   ├── Product.js
│   └── ProductComponent.js
├── services/
│   └── ComboService.js
├── routes/
│   ├── products.js
│   ├── productComponents.js
│   ├── productAvailability.js
│   ├── sales.js
│   ├── salesVoid.js
│   └── reports.js
└── views/
    ├── create-product.html
    ├── edit-combo.html
    └── pos.html
```

---

## 🔄 Flujo de Trabajo

### 1. Crear Combo
```
Producto → Tipo: COMBO → Agregar Componentes → Guardar
```

### 2. Vender Combo
```
POS → Seleccionar Combo → Validar Stock → Procesar Venta → Descontar Componentes
```

### 3. Anular Venta
```
Ventas → Anular → Revertir Movimientos de Componentes
```

### 4. Reportes
```
Reportes → Ventas de Combos → Ver Descuentos y Márgenes
```

---

## 🛠️ Instalación y Configuración

### 1. Ejecutar Migraciones
```sql
-- Ejecutar en orden:
-- 001_add_product_type_to_products.sql
-- 002_create_product_components.sql  
-- 003_add_simple_product_constraint.sql
```

### 2. Configurar API
```javascript
// En app.js, agregar rutas:
app.use('/api/products', require('./routes/products'));
app.use('/api/products', require('./routes/productComponents'));
app.use('/api/products', require('./routes/productAvailability'));
app.use('/api/sales', require('./routes/sales'));
app.use('/api/sales', require('./routes/salesVoid'));
app.use('/api/reports', require('./routes/reports'));
```

### 3. Actualizar Models
```javascript
// En index.js de models:
const Product = require('./Product');
const ProductComponent = require('./ProductComponent');
// ... otros modelos
```

---

## 🎯 Ejemplos de Uso

### Crear Combo via API
```json
POST /api/products
{
  "tenantId": 1,
  "name": "Pack Fiesta",
  "sku": "PACK-001",
  "productType": "COMBO",
  "salePrice": 299.99,
  "components": [
    {"componentProductId": 10, "qty": 2},
    {"componentProductId": 15, "qty": 1}
  ]
}
```

### Ver Disponibilidad
```json
GET /api/products/123/availability?tenantId=1
{
  "comboId": 123,
  "availableStock": 15,
  "components": [
    {
      "componentName": "Whisky 750ml",
      "currentStock": 35,
      "requiredQty": 2,
      "maxCombosFromComponent": 17,
      "isLimiting": false
    }
  ]
}
```

---

## 📊 Reportes Disponibles

### 1. Ventas de Combos
- Ingreso total por combo
- Descuento implícito calculado
- Margen real por venta
- Desglose por componente

### 2. Performance de Combos  
- Top combos por ingreso
- Análisis de margen
- Disponibilidad actual
- Componentes limitantes

---

## ✅ Validaciones Implementadas

- **Stock insuficiente**: Bloquea venta y muestra componentes faltantes
- **Componentes duplicados**: No permite agregar el mismo componente
- **Cantidades válidas**: Solo permite cantidades > 0
- **Productos activos**: Solo permite productos activos como componentes
- **Integridad**: No permite eliminar componentes usados en combos activos

---

## 🎨 Mejoras de UX

- **Indicadores visuales** de stock (colores)
- **Búsqueda inteligente** de componentes
- **Previsualización en tiempo real** de costo y disponibilidad
- **Alertas contextuales** para problemas de stock
- **Interfaz responsiva** para POS

El sistema está completamente implementado y listo para producción. Sigue todas las reglas de negocio especificadas y proporciona una experiencia de usuario intuitiva para la gestión de combos virtuales.