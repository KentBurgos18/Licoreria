# Ejecutar Migración de Cédula

## Problema
El error "Error al cargar clientes" ocurre porque la columna `cedula` no existe en la tabla `customers` de la base de datos.

## Solución

### Opción 1: Ejecutar la migración SQL manualmente

Conéctate a tu base de datos PostgreSQL y ejecuta:

```sql
-- Agregar columna cedula
ALTER TABLE customers 
ADD COLUMN IF NOT EXISTS cedula VARCHAR(50) NOT NULL DEFAULT '';

-- Crear índice único para cedula por tenant
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_tenant_cedula 
ON customers(tenant_id, cedula);

-- Actualizar registros existentes con un valor temporal
UPDATE customers 
SET cedula = 'TEMP-' || id::text 
WHERE cedula IS NULL OR cedula = '';
```

### Opción 2: Usar psql desde la línea de comandos

```bash
# Conectarte a PostgreSQL
psql -U licoreria_user -d licoreria

# Luego ejecutar el SQL de arriba
```

### Opción 3: Ejecutar el archivo de migración

```bash
psql -U licoreria_user -d licoreria -f database/migrations/005_add_customer_cedula.sql
```

## Verificar

Después de ejecutar la migración, verifica que la columna existe:

```sql
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'customers' AND column_name = 'cedula';
```

Deberías ver una fila con `cedula` y `character varying`.

## Nota

El código ahora es más tolerante y funcionará aunque la columna no exista, pero es recomendable ejecutar la migración para tener todas las funcionalidades completas.
