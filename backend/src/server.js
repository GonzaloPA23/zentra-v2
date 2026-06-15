require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { testConnection } = require('./db');

const app = express();

// ── Seguridad ──────────────────────────────────────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}));

// ── Rate limiting ─────────────────────────────────────────────────────────
app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { ok: false, mensaje: 'Demasiados intentos, espera 15 minutos' } }));
app.use('/api/', rateLimit({ windowMs: 1 * 60 * 1000, max: 300 }));

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(compression());
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Archivos estáticos (uploads) ──────────────────────────────────────────
const uploadPath = process.env.UPLOAD_PATH || './uploads';
app.use('/uploads', express.static(path.resolve(uploadPath)));

// ── Health check ───────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true, version: '1.0.0', timestamp: new Date().toISOString() }));

// ── Rutas API ──────────────────────────────────────────────────────────────
app.use('/api/auth',           require('./routes/auth'));
app.use('/api/empresas',       require('./routes/empresas'));
app.use('/api/usuarios',       require('./routes/usuarios'));
app.use('/api/catalogos',      require('./routes/catalogos'));
app.use('/api/registros',      require('./routes/registros'));
app.use('/api/dashboard',      require('./routes/dashboard'));
app.use('/api/auditoria',      require('./routes/auditoria'));
app.use('/api/notificaciones', require('./routes/notificaciones'));
app.use('/api/tg-interno',     require('./routes/tg-interno'));

// ── 404 ────────────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ ok: false, mensaje: 'Ruta no encontrada' }));

// ── Error handler ──────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Error]', err);
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ ok: false, mensaje: 'Archivo demasiado grande (máx 5MB)' });
  res.status(500).json({ ok: false, mensaje: err.message || 'Error interno del servidor' });
});

// ── Arranque ───────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;
testConnection().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🚀 ZENTRA API corriendo en http://localhost:${PORT}`);
    console.log(`   Entorno: ${process.env.NODE_ENV || 'development'}`);
    console.log(`   Health:  http://localhost:${PORT}/health\n`);
  });
});
