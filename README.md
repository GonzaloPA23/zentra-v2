# 🏭 ZENTRA Almacenes

Sistema web multiempresa de gestión de almacenes. Construido con **Node.js + Express** (backend), **React + Vite + Tailwind CSS** (frontend) y **MySQL** (base de datos).

---

## 🗂️ Estructura del proyecto

```
zentra/
├── sql/
│   └── zentra_schema.sql       ← Importar en phpMyAdmin
├── backend/
│   ├── src/
│   │   ├── server.js           ← Punto de entrada
│   │   ├── db.js               ← Conexión MySQL
│   │   ├── middleware/
│   │   │   └── auth.js         ← JWT + roles
│   │   └── routes/
│   │       ├── auth.js         ← Login / me / cambiar-password
│   │       ├── empresas.js     ← CRUD empresas (superadmin)
│   │       ├── usuarios.js     ← CRUD usuarios + asignación almacenes
│   │       ├── catalogos.js    ← Todos los catálogos
│   │       ├── registros.js    ← Módulo 1 - Registros
│   │       └── dashboard.js    ← Estadísticas
│   ├── .env.example
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.jsx             ← Router principal
│   │   ├── context/AuthContext.jsx
│   │   ├── utils/api.js        ← Axios + helpers
│   │   ├── components/         ← Modal, DataTable, Layout, etc.
│   │   └── pages/              ← Todas las páginas
│   ├── tailwind.config.js
│   └── package.json
├── deploy.sh                   ← Script de despliegue automático
└── README.md
```

---

## 🚀 Instalación rápida

### Requisitos
- Node.js 18+
- MySQL 5.7+ (phpMyAdmin disponible)
- VPS con Ubuntu 20.04/22.04 (para producción)

### Paso 1: Base de datos

1. Abre **phpMyAdmin**
2. Importa el archivo `sql/zentra_schema.sql`
3. Esto crea la base de datos `zentra_db` con:
   - Todas las tablas
   - Datos iniciales (regiones, ciudades, almacenes de Perú)
   - Usuario superadmin por defecto

### Paso 2: Backend

```bash
cd backend
cp .env.example .env
nano .env  # Configura tus credenciales MySQL
npm install
npm start
```

### Paso 3: Frontend

```bash
cd frontend
npm install
npm run dev       # Desarrollo (puerto 3000)
npm run build     # Producción (genera carpeta dist/)
```

---

## ⚙️ Variables de entorno (backend/.env)

```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=tu_password_mysql
DB_NAME=zentra_db

JWT_SECRET=cambia_esto_por_algo_muy_seguro
JWT_EXPIRES=8h

PORT=4000
NODE_ENV=production
FRONTEND_URL=http://tu-dominio.com

UPLOAD_PATH=./uploads
MAX_FILE_SIZE=5242880
```

---

## 🌐 Despliegue en VPS (producción)

```bash
# En el servidor (Ubuntu 22.04):
chmod +x deploy.sh
sudo ./deploy.sh
```

El script instala automáticamente:
- Node.js 20
- PM2 (gestor de procesos)
- Nginx (proxy reverso + servidor de frontend)

Configuración Nginx generada en `/etc/nginx/sites-available/zentra`:
- **`/`** → Sirve el frontend React (SPA)
- **`/api/`** → Proxy al backend Express (puerto 4000)
- **`/uploads/`** → Archivos subidos

---

## 🔐 Credenciales iniciales

| Rol | Email | Contraseña |
|-----|-------|-----------|
| SuperAdmin | `superadmin@zentra.com` | `Admin123!` |

> ⚠️ **Cambia la contraseña** inmediatamente después del primer login.

---

## 👥 Roles del sistema

| Rol | Permisos |
|-----|----------|
| **superadmin** | Todo: empresas, usuarios, catálogos, registros, aprobaciones |
| **admin** | Empresa propia: usuarios, catálogos, registros, aprobaciones |
| **supervisor** | Vista, descarga y aprobación de registros |
| **almacenero** | Crear y ver registros de sus almacenes asignados |

---

## 📋 Módulo 1: Registros

Campos del formulario:

| Campo | Tipo | Descripción |
|-------|------|-------------|
| Fecha | Calendario | Fecha del movimiento |
| Ciudad | Lista desplegable | Ciudad filtrada por región |
| Almacén Inicial | Lista desplegable | Almacén de origen |
| Almacén Destino | Lista desplegable | Almacén destino (opcional) |
| Categoría | Lista desplegable (CRUD) | ABARROTES, CONFITES, MASCOTAS, etc. |
| Acción | Lista fija | MERMA / DESPACHO A CANJISTAS / OTROS MOVIMIENTOS |
| Tipo de Acción | Lista fija | ENTRADA / SALIDA / CANJES / CRUCERISMO / etc. |
| Personal Receptor | Lista desplegable (CRUD) | Persona que recibe |
| Indicador | Lista desplegable (CRUD) | DISGREGACIÓN, TG-ALMACENES, etc. |
| Tipo Mercadería | Lista (asociada a categoría, CRUD) | ACTIVOS, CANJES, MERCARISMO, etc. |
| SKU | Lista (asociada a categoría, CRUD) | Producto específico |
| Lote | Lista (asociada a SKU, CRUD) | Registro manual |
| Fecha Vencimiento | Fecha | Asociada a SKU y lote |
| Cantidad | Numérico | Cantidad del movimiento |
| Nro. Guía | Texto | Número de guía |
| Foto Guía | Archivo JPG/PNG/PDF | Imagen o PDF de la guía |

---

## 🗄️ Catálogos con CRUD

| Catálogo | CRUD | Notas |
|----------|------|-------|
| Categorías | ✅ | Principal |
| Tipos de Mercadería | ✅ | Asociado a categoría |
| Almacenes | ✅ | Asociado a ciudad/región |
| SKUs | ✅ | Asociado a categoría + tipo |
| Lotes | ✅ | Asociado a SKU |
| Personal Receptor | ✅ | Lista de personas |
| Indicadores | ✅ | Criterios de gestión |
| Regiones | ✅ | LIMA, NORTE, SUR, etc. |
| Ciudades | Solo lectura | Administradas por región |
| Acción | ❌ | Valor fijo (lógica de negocio) |
| Tipo de Acción | ❌ | Valor fijo (lógica de negocio) |

---

## 🛠️ API Endpoints

```
POST   /api/auth/login
GET    /api/auth/me
POST   /api/auth/cambiar-password

GET    /api/empresas          (superadmin)
POST   /api/empresas
PUT    /api/empresas/:id
DELETE /api/empresas/:id

GET    /api/usuarios
POST   /api/usuarios
PUT    /api/usuarios/:id
DELETE /api/usuarios/:id

GET    /api/catalogos/categorias
GET    /api/catalogos/almacenes
GET    /api/catalogos/skus
GET    /api/catalogos/lotes?sku_id=X
GET    /api/catalogos/tipos-mercaderia?categoria_id=X
GET    /api/catalogos/personal-receptor
GET    /api/catalogos/indicadores
GET    /api/catalogos/regiones
GET    /api/catalogos/ciudades
(+ POST/PUT/DELETE para cada catálogo)

GET    /api/registros         (con filtros: fecha_ini, fecha_fin, estado, etc.)
POST   /api/registros
PUT    /api/registros/:id
PATCH  /api/registros/:id/estado
DELETE /api/registros/:id
GET    /api/registros/export/csv

GET    /api/dashboard/resumen
```

---

## 🔄 Flujo de estados de un registro

```
PENDIENTE → EN_TRÁNSITO → APROBADO
                       ↘ RECHAZADO
```

---

## 📊 Dashboard

- Total de registros / Pendientes / En tránsito / Aprobados
- Gráfico de barras: registros por mes (últimos 6 meses)
- Gráfico de torta: distribución por categoría
- **Alertas de vencimiento**: productos vencidos (🔴) y próximos a vencer en 7 días (🟡)

---

## 🆘 Comandos útiles en producción

```bash
# Ver logs del backend
pm2 logs zentra-api

# Reiniciar backend (tras cambios en .env)
pm2 restart zentra-api

# Ver estado
pm2 status

# Recargar Nginx
systemctl reload nginx

# Ver logs de Nginx
tail -f /var/log/nginx/error.log
```

---

## 📝 Notas importantes

1. **La contraseña del superadmin** está hasheada con bcrypt. El hash en el SQL corresponde a `Admin123!`
2. **Los uploads** se guardan en `backend/uploads/`. En producción, considera S3 o un storage externo.
3. **Multiempresa**: cada empresa ve solo sus propios datos. El superadmin puede ver/gestionar todas las empresas.
4. **Sin migraciones**: el sistema usa `ALTER TABLE` directos. Para cambios de schema, edita el SQL manualmente.
5. La **exportación CSV** incluye BOM UTF-8 para compatibilidad con Excel en Windows.
