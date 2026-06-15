/**
 * crudFactory - genera rutas CRUD para tablas de catálogo simples
 * tabla: nombre de tabla MySQL
 * campos: array de campos permitidos en POST/PUT
 * extraWhere: SQL adicional para filtrar (e.g. empresa_id)
 */
const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { pool } = require('../db');

function crudFactory({ tabla, campos, requireEmpresa = true, roles = ['superadmin','admin'] }) {
  const router = express.Router();

  const validate = (req, res, next) => {
    const e = validationResult(req);
    if (!e.isEmpty()) return res.status(400).json({ ok: false, errores: e.array() });
    next();
  };

  // GET /
  router.get('/', async (req, res) => {
    try {
      const where = requireEmpresa ? 'WHERE empresa_id = ?' : 'WHERE 1=1';
      const params = requireEmpresa ? [req.empresa_id] : [];
      const [rows] = await pool.query(`SELECT * FROM \`${tabla}\` ${where} ORDER BY id`, params);
      res.json({ ok: true, datos: rows });
    } catch (err) {
      console.error(err);
      res.status(500).json({ ok: false, mensaje: 'Error interno' });
    }
  });

  // GET /:id
  router.get('/:id', param('id').isInt({ min: 1 }), validate, async (req, res) => {
    try {
      const where = requireEmpresa
        ? 'WHERE id = ? AND empresa_id = ?'
        : 'WHERE id = ?';
      const params = requireEmpresa ? [req.params.id, req.empresa_id] : [req.params.id];
      const [rows] = await pool.query(`SELECT * FROM \`${tabla}\` ${where}`, params);
      if (!rows.length) return res.status(404).json({ ok: false, mensaje: 'Registro no encontrado' });
      res.json({ ok: true, datos: rows[0] });
    } catch {
      res.status(500).json({ ok: false, mensaje: 'Error interno' });
    }
  });

  // POST /
  router.post('/', [
    body('nombre').trim().notEmpty().withMessage('Nombre requerido'),
  ], validate, async (req, res) => {
    try {
      const data = {};
      if (requireEmpresa) data.empresa_id = req.empresa_id;
      for (const c of campos) {
        if (req.body[c] !== undefined) data[c] = req.body[c];
      }
      const keys = Object.keys(data);
      const vals = Object.values(data);
      const [result] = await pool.query(
        `INSERT INTO \`${tabla}\` (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
        vals
      );
      res.status(201).json({ ok: true, id: result.insertId, mensaje: 'Registro creado' });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ ok: false, mensaje: 'Registro duplicado' });
      res.status(500).json({ ok: false, mensaje: 'Error interno' });
    }
  });

  // PUT /:id
  router.put('/:id', [param('id').isInt({ min: 1 })], validate, async (req, res) => {
    try {
      const data = {};
      for (const c of campos) {
        if (req.body[c] !== undefined) data[c] = req.body[c];
      }
      if (!Object.keys(data).length) return res.status(400).json({ ok: false, mensaje: 'Sin datos para actualizar' });

      const setClause = Object.keys(data).map(k => `\`${k}\` = ?`).join(', ');
      const vals = [...Object.values(data)];

      const where = requireEmpresa
        ? `WHERE id = ? AND empresa_id = ?`
        : `WHERE id = ?`;
      const whereParams = requireEmpresa ? [req.params.id, req.empresa_id] : [req.params.id];

      await pool.query(`UPDATE \`${tabla}\` SET ${setClause} ${where}`, [...vals, ...whereParams]);
      res.json({ ok: true, mensaje: 'Registro actualizado' });
    } catch {
      res.status(500).json({ ok: false, mensaje: 'Error interno' });
    }
  });

  // DELETE /:id  (soft delete si existe columna activo, hard delete si no)
  router.delete('/:id', param('id').isInt({ min: 1 }), validate, async (req, res) => {
    try {
      const where = requireEmpresa ? 'WHERE id=? AND empresa_id=?' : 'WHERE id=?';
      const params = requireEmpresa ? [req.params.id, req.empresa_id] : [req.params.id];
      // Intentar soft delete
      try {
        await pool.query(`UPDATE \`${tabla}\` SET activo=0 ${where}`, params);
      } catch {
        await pool.query(`DELETE FROM \`${tabla}\` ${where}`, params);
      }
      res.json({ ok: true, mensaje: 'Registro eliminado' });
    } catch {
      res.status(500).json({ ok: false, mensaje: 'Error interno' });
    }
  });

  return router;
}

module.exports = crudFactory;
