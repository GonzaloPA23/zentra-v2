#!/bin/bash
# ============================================================
# ZENTRA ALMACENES - Script de despliegue en VPS
# Probado en Ubuntu 22.04 LTS
# ============================================================

set -e

echo ""
echo "╔══════════════════════════════════════╗"
echo "║   ZENTRA ALMACENES - Despliegue VPS  ║"
echo "╚══════════════════════════════════════╝"
echo ""

# ── 1. Variables de configuración ─────────────────────────────────────────────
APP_DIR="/var/www/zentra"
BACKEND_DIR="$APP_DIR/backend"
FRONTEND_DIR="$APP_DIR/frontend"
NODE_VERSION="20"

# ── 2. Instalar dependencias del sistema ──────────────────────────────────────
echo "→ Actualizando paquetes del sistema..."
apt-get update -qq

echo "→ Instalando Node.js $NODE_VERSION..."
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
  apt-get install -y nodejs
fi
node --version

echo "→ Instalando PM2..."
npm install -g pm2 2>/dev/null || true

echo "→ Instalando Nginx..."
apt-get install -y nginx

# ── 3. Copiar archivos ─────────────────────────────────────────────────────────
echo "→ Copiando archivos a $APP_DIR..."
mkdir -p "$BACKEND_DIR" "$FRONTEND_DIR"

# Asumiendo que los archivos están en el directorio actual
cp -r backend/* "$BACKEND_DIR/"
cp -r frontend/* "$FRONTEND_DIR/"

# ── 4. Backend: instalar dependencias y configurar ────────────────────────────
echo "→ Instalando dependencias del backend..."
cd "$BACKEND_DIR"
npm install --omit=dev

# Crear .env si no existe
if [ ! -f .env ]; then
  cp .env.example .env
  echo ""
  echo "⚠️  IMPORTANTE: Edita el archivo $BACKEND_DIR/.env con tus credenciales de MySQL"
  echo "   nano $BACKEND_DIR/.env"
  echo ""
fi

mkdir -p uploads

# ── 5. Frontend: build ─────────────────────────────────────────────────────────
echo "→ Construyendo el frontend..."
cd "$FRONTEND_DIR"
npm install
npm run build
echo "→ Build completado en $FRONTEND_DIR/dist"

# ── 6. PM2: iniciar backend ────────────────────────────────────────────────────
echo "→ Configurando PM2..."
cd "$BACKEND_DIR"

# Crear ecosistema PM2
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'zentra-api',
    script: 'src/server.js',
    cwd: '/var/www/zentra/backend',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '300M',
    env: {
      NODE_ENV: 'production',
      PORT: 4000,
    },
    error_file: '/var/log/zentra/error.log',
    out_file: '/var/log/zentra/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }],
};
EOF

mkdir -p /var/log/zentra
pm2 start ecosystem.config.js
pm2 save
pm2 startup | tail -1 | bash || true

# ── 7. Nginx: configurar virtual host ─────────────────────────────────────────
echo "→ Configurando Nginx..."

cat > /etc/nginx/sites-available/zentra << 'NGINXEOF'
server {
    listen 80;
    server_name _;   # Cambia _ por tu dominio o IP

    client_max_body_size 10M;

    # Frontend (React build)
    root /var/www/zentra/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Backend API
    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }

    # Archivos subidos
    location /uploads/ {
        proxy_pass http://127.0.0.1:4000/uploads/;
    }

    # Seguridad
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
}
NGINXEOF

ln -sf /etc/nginx/sites-available/zentra /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  ✅ ZENTRA desplegado correctamente                  ║"
echo "║                                                      ║"
echo "║  Pasos siguientes:                                   ║"
echo "║  1. Editar: nano /var/www/zentra/backend/.env        ║"
echo "║  2. Importar SQL en phpMyAdmin: sql/zentra_schema.sql║"
echo "║  3. Reiniciar: pm2 restart zentra-api                ║"
echo "║  4. Acceder: http://TU_IP_O_DOMINIO                  ║"
echo "║                                                      ║"
echo "║  Credenciales iniciales:                             ║"
echo "║  Email: superadmin@zentra.com                        ║"
echo "║  Pass:  Admin123!                                    ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
