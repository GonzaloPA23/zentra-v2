const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { pool } = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

function parseIdCsv(value) {
  return String(value || '').split(',').map((item) => parseInt(item)).filter(Boolean);
}

// POST /api/auth/login
router.post('/login', [
  body('email').isEmail().normalizeEmail().withMessage('Email inválido'),
  body('password').notEmpty().withMessage('Contraseña requerida'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ ok: false, errores: errors.array() });

  const { email, password } = req.body;
  try {
    // Superadmin no tiene empresa_id, usuarios normales sí
    const [rows] = await pool.query(
      `SELECT u.*,
        COALESCE(e.nombre, 'SISTEMA') AS empresa_nombre,
        (SELECT GROUP_CONCAT(uc.ciudad_id ORDER BY c.nombre SEPARATOR ',')
         FROM usuario_ciudad uc
         JOIN ciudades c ON c.id = uc.ciudad_id
         WHERE uc.usuario_id = u.id) AS ciudad_ids,
        (SELECT GROUP_CONCAT(c.nombre ORDER BY c.nombre SEPARATOR ', ')
         FROM usuario_ciudad uc
         JOIN ciudades c ON c.id = uc.ciudad_id
         WHERE uc.usuario_id = u.id) AS ciudad_nombre,
        (SELECT GROUP_CONCAT(DISTINCT CASE WHEN UPPER(c.nombre)='LIMA' THEN 'LIMA' ELSE 'PROVINCIA' END ORDER BY c.nombre SEPARATOR ', ')
         FROM usuario_ciudad uc
         JOIN ciudades c ON c.id = uc.ciudad_id
         WHERE uc.usuario_id = u.id) AS zona
       FROM usuarios u
       LEFT JOIN empresas e ON e.id = u.empresa_id
       WHERE u.email = ? AND u.activo = 1
         AND (u.empresa_id IS NULL OR e.activo = 1)`,
      [email]
    );

    if (!rows.length) {
      return res.status(401).json({ ok: false, mensaje: 'Credenciales incorrectas' });
    }

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ ok: false, mensaje: 'Credenciales incorrectas' });
    }

    await pool.query('UPDATE usuarios SET ultimo_login = NOW() WHERE id = ?', [user.id]);

    const payload = {
      id: user.id,
      nombre: user.nombre,
      apellido: user.apellido,
      email: user.email,
      rol: user.rol,
      empresa_id: user.empresa_id,       // NULL para superadmin
      empresa_nombre: user.empresa_nombre,
      ciudad_id: user.ciudad_id,
      ciudad_ids: parseIdCsv(user.ciudad_ids),
      ciudad_nombre: user.ciudad_nombre,
      zona: user.zona,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES || '8h',
    });

    res.json({ ok: true, token, usuario: payload });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, mensaje: 'Error interno del servidor' });
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.nombre, u.apellido, u.email, u.rol, u.empresa_id,
              u.ciudad_id,
              (SELECT GROUP_CONCAT(uc.ciudad_id ORDER BY c.nombre SEPARATOR ',')
               FROM usuario_ciudad uc
               JOIN ciudades c ON c.id = uc.ciudad_id
               WHERE uc.usuario_id = u.id) AS ciudad_ids,
              (SELECT GROUP_CONCAT(c.nombre ORDER BY c.nombre SEPARATOR ', ')
               FROM usuario_ciudad uc
               JOIN ciudades c ON c.id = uc.ciudad_id
               WHERE uc.usuario_id = u.id) AS ciudad_nombre,
              (SELECT GROUP_CONCAT(DISTINCT CASE WHEN UPPER(c.nombre)='LIMA' THEN 'LIMA' ELSE 'PROVINCIA' END ORDER BY c.nombre SEPARATOR ', ')
               FROM usuario_ciudad uc
               JOIN ciudades c ON c.id = uc.ciudad_id
               WHERE uc.usuario_id = u.id) AS zona,
              COALESCE(e.nombre, 'SISTEMA') AS empresa_nombre
       FROM usuarios u
       LEFT JOIN empresas e ON e.id = u.empresa_id
       WHERE u.id = ? AND u.activo = 1`,
      [req.usuario.id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, mensaje: 'Usuario no encontrado' });
    res.json({ ok: true, usuario: { ...rows[0], ciudad_ids: parseIdCsv(rows[0].ciudad_ids) } });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: 'Error interno' });
  }
});

// POST /api/auth/cambiar-password
router.post('/cambiar-password', authMiddleware, [
  body('password_actual').notEmpty(),
  body('password_nuevo').isLength({ min: 8 }).withMessage('Mínimo 8 caracteres'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ ok: false, errores: errors.array() });

  const { password_actual, password_nuevo } = req.body;
  try {
    const [rows] = await pool.query(
      'SELECT password_hash FROM usuarios WHERE id = ?', [req.usuario.id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, mensaje: 'Usuario no encontrado' });

    const valid = await bcrypt.compare(password_actual, rows[0].password_hash);
    if (!valid) return res.status(400).json({ ok: false, mensaje: 'Contraseña actual incorrecta' });

    const hash = await bcrypt.hash(password_nuevo, 10);
    await pool.query('UPDATE usuarios SET password_hash = ? WHERE id = ?', [hash, req.usuario.id]);

    res.json({ ok: true, mensaje: 'Contraseña actualizada correctamente' });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: 'Error interno' });
  }
});

module.exports = router;
