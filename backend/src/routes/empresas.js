const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { pool } = require('../db');
const { authMiddleware, requireRol } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware, requireRol('superadmin'));

const validate = (req, res, next) => {
  const e = validationResult(req);
  if (!e.isEmpty()) return res.status(400).json({ ok: false, errores: e.array() });
  next();
};

// GET /api/empresas
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, nombre, ruc, logo, activo, created_at FROM empresas ORDER BY nombre'
    );
    res.json({ ok: true, datos: rows });
  } catch { res.status(500).json({ ok: false, mensaje: 'Error interno' }); }
});

// POST /api/empresas
router.post('/', [
  body('nombre').trim().notEmpty().withMessage('Nombre requerido'),
  body('ruc').optional().matches(/^\d{11}$/).withMessage('RUC debe tener 11 dígitos'),
], validate, async (req, res) => {
  const { nombre, ruc } = req.body;
  try {
    if (ruc) {
      const [ex] = await pool.query('SELECT id FROM empresas WHERE ruc = ?', [ruc]);
      if (ex.length) return res.status(409).json({ ok: false, mensaje: 'RUC ya registrado' });
    }
    const [result] = await pool.query('INSERT INTO empresas (nombre, ruc) VALUES (?,?)', [nombre, ruc || null]);
    res.status(201).json({ ok: true, id: result.insertId, mensaje: 'Empresa creada' });
  } catch { res.status(500).json({ ok: false, mensaje: 'Error interno' }); }
});

// PUT /api/empresas/:id
router.put('/:id', [
  param('id').isInt({ min: 1 }),
  body('nombre').trim().notEmpty(),
  body('ruc').optional().matches(/^\d{11}$/),
  body('activo').optional().isBoolean(),
], validate, async (req, res) => {
  const { nombre, ruc, activo } = req.body;
  try {
    if (ruc) {
      const [ex] = await pool.query('SELECT id FROM empresas WHERE ruc = ? AND id != ?', [ruc, req.params.id]);
      if (ex.length) return res.status(409).json({ ok: false, mensaje: 'RUC ya registrado' });
    }
    await pool.query(
      'UPDATE empresas SET nombre=?, ruc=?, activo=? WHERE id=?',
      [nombre, ruc || null, activo !== undefined ? activo : 1, req.params.id]
    );
    res.json({ ok: true, mensaje: 'Empresa actualizada' });
  } catch { res.status(500).json({ ok: false, mensaje: 'Error interno' }); }
});

// DELETE /api/empresas/:id  (soft delete)
router.delete('/:id', param('id').isInt({ min: 1 }), validate, async (req, res) => {
  try {
    await pool.query('UPDATE empresas SET activo = 0 WHERE id = ?', [req.params.id]);
    res.json({ ok: true, mensaje: 'Empresa desactivada' });
  } catch { res.status(500).json({ ok: false, mensaje: 'Error interno' }); }
});

module.exports = router;
