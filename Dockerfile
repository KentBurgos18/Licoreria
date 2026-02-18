# Usar Node.js 18 Alpine como base
FROM node:18-alpine

# Establecer directorio de trabajo
WORKDIR /app

# Instalar dependencias de PostgreSQL
RUN apk add --no-cache postgresql-client

# Copiar package.json y package-lock.json
COPY package*.json ./

# Instalar dependencias
RUN npm ci --only=production

# Copiar código fuente
COPY . .

# Crear directorios necesarios
RUN mkdir -p database/migrations views

# Exponer puerto
EXPOSE 3000

# Variables de entorno por defecto
ENV NODE_ENV=production
ENV PORT=3000

# Comando de inicio
CMD ["npm", "start"]