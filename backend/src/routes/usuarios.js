const express = require('express');
const bcrypt = require('bcryptjs');
const { body, param, validationResult } = require('express-validator');
const { pool } = require('../db');
const { authMiddleware, requireRol, empresaMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

const validate = (req, res, next) => {
  const e = validationResult(req);
  if (!e.isEmpty()) return res.status(400).json({ ok: false, errores: e.array() });
  next();
};

function uniquePositiveIds(values = []) {
  return [...new Set((Array.isArray(values) ? values : [values]).map((value) => parseInt(value)).filter(Boolean))];
}

async function validateUserCitiesAndWarehouses(conn, { empresaId, rol, ciudadId, ciudadIds = [], almacenes = [] }) {
  let normalizedCityIds = uniquePositiveIds([...ciudadIds, ciudadId].filter(Boolean));
  const warehouseIds = uniquePositiveIds(almacenes);

  if (warehouseIds.length) {
    const [warehouses] = await conn.query(
      `SELECT a.id, a.ciudad_id
       FROM almacenes a
       JOIN ciudades c ON c.id=a.ciudad_id
       JOIN regiones r ON r.id=c.region_id
       WHERE a.id IN (${warehouseIds.map(() => '?').join(',')}) AND r.empresa_id=?`,
      [...warehouseIds, empresaId]
    );
    if (warehouses.length !== warehouseIds.length) {
      return { mensaje: 'Uno o mas almacenes no pertenecen a la empresa seleccionada' };
    }
    const warehouseCityIds = uniquePositiveIds(warehouses.map((warehouse) => warehouse.ciudad_id));
    if (!normalizedCityIds.length) normalizedCityIds = warehouseCityIds;
    const invalidWarehouseCity = warehouseCityIds.some((id) => !normalizedCityIds.includes(id));
    if (invalidWarehouseCity) {
      return { mensaje: 'Los almacenes asignados deben pertenecer a las ciudades seleccionadas' };
    }
  }

  if (['supervisor', 'almacenero'].includes(rol) && !normalizedCityIds.length) {
    return { mensaje: 'Selecciona al menos una ciudad para supervisor o almacenero' };
  }

  if (normalizedCityIds.length) {
    const [cities] = await conn.query(
      `SELECT c.id FROM ciudades c JOIN regiones r ON r.id=c.region_id
       WHERE c.id IN (${normalizedCityIds.map(() => '?').join(',')}) AND c.activo=1 AND r.empresa_id=?`,
      [...normalizedCityIds, empresaId]
    );
    if (cities.length !== normalizedCityIds.length) {
      return { mensaje: 'Una o mas ciudades no pertenecen a la empresa seleccionada' };
    }
  }

  return { mensaje: null, ciudadIds: normalizedCityIds };
}

async function syncUserCities(conn, usuarioId, ciudadIds = []) {
  const ids = uniquePositiveIds(ciudadIds);
  await conn.query('DELETE FROM usuario_ciudad WHERE usuario_id = ?', [usuarioId]);
  if (ids.length) {
    await conn.query('INSERT INTO usuario_ciudad (usuario_id, ciudad_id) VALUES ?', [
      ids.map((ciudadId) => [usuarioId, ciudadId]),
    ]);
  }
  await conn.query('UPDATE usuarios SET ciudad_id=? WHERE id=?', [ids[0] || null, usuarioId]);
}

// GET /api/usuarios
// superadmin ve todos, admin ve solo los de su empresa
router.get('/', requireRol('superadmin', 'admin'), async (req, res) => {
  try {
    let where = "WHERE u.rol != 'superadmin'";
    const p = [];

    if (req.usuario.rol === 'admin') {
      where += ' AND u.empresa_id = ?';
      p.push(req.usuario.empresa_id);
    }

    const [rows] = await pool.query(
      `SELECT u.id, u.nombre, u.apellido, u.email, u.rol, u.activo,
              u.empresa_id, u.ciudad_id,
              GROUP_CONCAT(DISTINCT uci.ciudad_id ORDER BY cix.nombre SEPARATOR ',') AS ciudad_ids,
              GROUP_CONCAT(DISTINCT cix.nombre ORDER BY cix.nombre SEPARATOR ', ') AS ciudad_nombre,
              GROUP_CONCAT(DISTINCT CASE WHEN UPPER(cix.nombre)='LIMA' THEN 'LIMA' ELSE 'PROVINCIA' END ORDER BY cix.nombre SEPARATOR ', ') AS zona,
              u.ultimo_login,
              COALESCE(e.nombre, '—') AS empresa_nombre,
              GROUP_CONCAT(DISTINCT a.nombre ORDER BY a.nombre SEPARATOR ', ') AS almacenes
       FROM usuarios u
       LEFT JOIN empresas e ON e.id = u.empresa_id
       LEFT JOIN usuario_ciudad uci ON uci.usuario_id = u.id
       LEFT JOIN ciudades cix ON cix.id = uci.ciudad_id
       LEFT JOIN usuario_almacen ua ON ua.usuario_id = u.id
       LEFT JOIN almacenes a ON a.id = ua.almacen_id
       ${where}
       GROUP BY u.id
       ORDER BY e.nombre, u.nombre`,
      p
    );
    res.json({ ok: true, datos: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, mensaje: 'Error interno' });
  }
});

// POST /api/usuarios
router.post('/', requireRol('superadmin', 'admin'), [
  body('nombre').trim().notEmpty().withMessage('Nombre requerido'),
  body('apellido').trim().notEmpty().withMessage('Apellido requerido'),
  body('email').isEmail().normalizeEmail().withMessage('Email inválido'),
  body('password').isLength({ min: 8 }).withMessage('Mínimo 8 caracteres'),
  body('rol').isIn(['admin', 'supervisor', 'almacenero']).withMessage('Rol inválido'),
  body('empresa_id').isInt({ min: 1 }).withMessage('Empresa requerida'),
  body('ciudad_id').optional({ checkFalsy: true, nullable: true }).isInt({ min: 1 }).withMessage('Ciudad invalida'),
  body('ciudad_ids').optional().isArray().withMessage('Ciudades invalidas'),
  body('almacenes').optional().isArray(),
], validate, async (req, res) => {
  const { nombre, apellido, email, password, rol, empresa_id, ciudad_id, ciudad_ids = [], almacenes = [] } = req.body;

  // Admin solo puede crear en su propia empresa
  if (req.usuario.rol === 'admin' && parseInt(empresa_id) !== req.usuario.empresa_id) {
    return res.status(403).json({ ok: false, mensaje: 'Solo puedes crear usuarios en tu empresa' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [ex] = await conn.query('SELECT id FROM usuarios WHERE email = ?', [email]);
    if (ex.length) {
      await conn.rollback();
      return res.status(409).json({ ok: false, mensaje: 'Email ya registrado' });
    }

    const hash = await bcrypt.hash(password, 10);
    const scope = await validateUserCitiesAndWarehouses(conn, {
      empresaId: parseInt(empresa_id),
      rol,
      ciudadId: ciudad_id,
      ciudadIds: ciudad_ids,
      almacenes,
    });
    if (scope.mensaje) {
      await conn.rollback();
      return res.status(400).json({ ok: false, mensaje: scope.mensaje });
    }
    const [result] = await conn.query(
      'INSERT INTO usuarios (empresa_id, ciudad_id, nombre, apellido, email, password_hash, rol) VALUES (?,?,?,?,?,?,?)',
      [empresa_id, scope.ciudadIds?.[0] || null, nombre, apellido, email, hash, rol]
    );
    const uid = result.insertId;
    await syncUserCities(conn, uid, scope.ciudadIds);

    if (almacenes.length) {
      const vals = almacenes.map(aid => [uid, parseInt(aid)]);
      await conn.query('INSERT INTO usuario_almacen (usuario_id, almacen_id) VALUES ?', [vals]);
    }

    await conn.commit();
    res.status(201).json({ ok: true, id: uid, mensaje: 'Usuario creado correctamente' });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ ok: false, mensaje: 'Error interno' });
  } finally {
    conn.release();
  }
});

// PUT /api/usuarios/:id
router.put('/:id', requireRol('superadmin', 'admin'), [
  param('id').isInt({ min: 1 }),
  body('nombre').trim().notEmpty(),
  body('apellido').trim().notEmpty(),
  body('email').isEmail().normalizeEmail(),
  body('rol').isIn(['admin', 'supervisor', 'almacenero']),
  body('activo').isBoolean(),
  body('ciudad_id').optional({ checkFalsy: true, nullable: true }).isInt({ min: 1 }),
  body('ciudad_ids').optional().isArray(),
  body('almacenes').optional().isArray(),
  body('password').optional().isLength({ min: 8 }),
], validate, async (req, res) => {
  const { nombre, apellido, email, rol, activo, almacenes, password, ciudad_id, ciudad_ids = [] } = req.body;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Verificar que el usuario existe
    const [owner] = await conn.query('SELECT id, empresa_id FROM usuarios WHERE id = ?', [req.params.id]);
    if (!owner.length) {
      await conn.rollback();
      return res.status(404).json({ ok: false, mensaje: 'Usuario no encontrado' });
    }

    // Admin solo puede editar usuarios de su empresa
    if (req.usuario.rol === 'admin' && owner[0].empresa_id !== req.usuario.empresa_id) {
      await conn.rollback();
      return res.status(403).json({ ok: false, mensaje: 'Sin permisos para editar este usuario' });
    }

    const [ex] = await conn.query('SELECT id FROM usuarios WHERE email = ? AND id != ?', [email, req.params.id]);
    if (ex.length) {
      await conn.rollback();
      return res.status(409).json({ ok: false, mensaje: 'Email ya en uso' });
    }
    const scope = await validateUserCitiesAndWarehouses(conn, {
      empresaId: owner[0].empresa_id,
      rol,
      ciudadId: ciudad_id,
      ciudadIds: ciudad_ids,
      almacenes: almacenes || [],
    });
    if (scope.mensaje) {
      await conn.rollback();
      return res.status(400).json({ ok: false, mensaje: scope.mensaje });
    }

    if (password) {
      const hash = await bcrypt.hash(password, 10);
      await conn.query(
        'UPDATE usuarios SET nombre=?, apellido=?, email=?, rol=?, activo=?, ciudad_id=?, password_hash=? WHERE id=?',
        [nombre, apellido, email, rol, activo ? 1 : 0, scope.ciudadIds?.[0] || null, hash, req.params.id]
      );
    } else {
      await conn.query(
        'UPDATE usuarios SET nombre=?, apellido=?, email=?, rol=?, activo=?, ciudad_id=? WHERE id=?',
        [nombre, apellido, email, rol, activo ? 1 : 0, scope.ciudadIds?.[0] || null, req.params.id]
      );
    }
    await syncUserCities(conn, req.params.id, scope.ciudadIds);

    if (almacenes !== undefined) {
      await conn.query('DELETE FROM usuario_almacen WHERE usuario_id = ?', [req.params.id]);
      if (almacenes.length) {
        const vals = almacenes.map(aid => [req.params.id, parseInt(aid)]);
        await conn.query('INSERT INTO usuario_almacen (usuario_id, almacen_id) VALUES ?', [vals]);
      }
    }

    await conn.commit();
    res.json({ ok: true, mensaje: 'Usuario actualizado' });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ ok: false, mensaje: 'Error interno' });
  } finally {
    conn.release();
  }
});

// DELETE /api/usuarios/:id
router.delete('/:id', requireRol('superadmin', 'admin'), param('id').isInt({ min: 1 }), validate, async (req, res) => {
  try {
    const [owner] = await pool.query('SELECT empresa_id FROM usuarios WHERE id = ?', [req.params.id]);
    if (!owner.length) return res.status(404).json({ ok: false, mensaje: 'No encontrado' });

    if (req.usuario.rol === 'admin' && owner[0].empresa_id !== req.usuario.empresa_id) {
      return res.status(403).json({ ok: false, mensaje: 'Sin permisos' });
    }

    await pool.query('UPDATE usuarios SET activo = 0 WHERE id = ?', [req.params.id]);
    res.json({ ok: true, mensaje: 'Usuario desactivado' });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: 'Error interno' });
  }
});

module.exports = router;
