# Seed para el primer despliegue

## Contenido de `seed.sql`

1. **Configuración inicial (settings)** – tenant_id = 1  
   - IVA (`tax_rate`: 16 %)  
   - Nombre del negocio y títulos de página (login, catálogo, carrito, etc.)  
   - Asuntos de correo (verificación, bienvenida, recuperación)  
   - Los settings usan `ON CONFLICT DO NOTHING`, así que se pueden ejecutar varias veces sin duplicar.

2. **Datos de ejemplo** (opcional)  
   - 6 categorías de producto (Whisky, Vodka, Tequila, Ron, Cerveza, Accesorios)  
   - 5 presentaciones de producto (Individual, Six Pack, Caja 24, Cajetilla, Media Cajetilla)  
   - 7 productos simples (whisky, vodka, tequila, ron, cerveza, hielos, vasos)  
   - Movimientos de inventario iniciales  
   - 3 combos y sus componentes  
   - 1 cliente de prueba  

   Esta parte debe ejecutarse **una sola vez** en una base vacía. Si la base ya tiene datos, comenta o elimina la sección 2 en `seed.sql` para evitar errores de duplicado.

## Cómo ejecutar el primer despliegue

### Con Docker (recomendado)

1. Crea la base con `docker-compose up -d postgres`.  
   Se ejecutan automáticamente `init.sql` y `seed.sql` al crear el contenedor por primera vez.

2. Las **migraciones** (tablas `users`, `notifications`, etc.) no están en el entrypoint. Ejecuta:
   ```bash
   npm run seed:first-deploy
   ```
   Ese script aplica todas las migraciones, vuelve a ejecutar el seed (solo los settings son idempotentes) y crea el usuario admin.  
   Si es la primera vez con contenedor nuevo, el seed de productos ya lo habrá corrido Docker; la segunda ejecución del seed puede fallar en los INSERT de productos (SKU duplicado). En ese caso puedes ejecutar solo las migraciones y el admin:
   - Aplicar a mano los SQL de `database/migrations/` en orden.
   - Luego: `node scripts/create-admin-user.js`.

### Sin Docker (PostgreSQL local)

1. Crea la base y el usuario (por ejemplo `licoreria` / `licoreria_user`).
2. Ejecuta el esquema:
   ```bash
   psql -U licoreria_user -d licoreria -f database/init.sql
   ```
3. Ejecuta migraciones y seed:
   ```bash
   npm run seed:first-deploy
   ```
   Eso aplica las migraciones 001–018, el `seed.sql` y crea el usuario administrador.

### Solo el seed (sin migraciones ni admin)

Si la base ya tiene todas las tablas y solo quieres cargar configuración y datos de ejemplo:

```bash
psql -U licoreria_user -d licoreria -f database/seed.sql
```

## Usuario administrador

- **Crear o comprobar:** `node scripts/create-admin-user.js`  
- **Credenciales por defecto:** `admin@locobar.com` / `admin123`  
- Cambia la contraseña después del primer acceso.
