const { pool } = require('../db');

const SCOPED_ROLES = new Set(['almacenero', 'supervisor']);

async function getAssignedWarehouseIds(userId, executor = pool) {
  const [rows] = await executor.query(
    'SELECT almacen_id FROM usuario_almacen WHERE usuario_id = ?',
    [userId]
  );

  return rows
    .map((row) => Number(row.almacen_id))
    .filter((value, index, self) => Number.isInteger(value) && self.indexOf(value) === index);
}

async function getWarehouseScope(req, alias = 'r', executor = pool) {
  if (!req?.usuario || !SCOPED_ROLES.has(req.usuario.rol)) {
    return { clause: '', params: [], ids: [] };
  }

  const ids = await getAssignedWarehouseIds(req.usuario.id, executor);
  if (!ids.length) {
    return { clause: '', params: [], ids };
  }

  const placeholders = ids.map(() => '?').join(',');
  return {
    clause: ` AND (${alias}.almacen_origen_id IN (${placeholders}) OR ${alias}.almacen_destino_id IN (${placeholders}))`,
    params: [...ids, ...ids],
    ids,
  };
}

function recordMatchesAssignedWarehouses(record, ids = []) {
  if (!ids.length) return true;

  const origen = Number(record?.almacen_origen_id);
  const destino = Number(record?.almacen_destino_id);
  return ids.some((id) => id === origen || id === destino);
}

module.exports = {
  getAssignedWarehouseIds,
  getWarehouseScope,
  recordMatchesAssignedWarehouses,
};
