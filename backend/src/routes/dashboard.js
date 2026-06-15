const express = require('express');
const { pool } = require('../db');
const { authMiddleware, empresaMiddleware } = require('../middleware/auth');
const { getAssignedWarehouseIds, getWarehouseScope } = require('../utils/warehouseScope');
const { parseAuditDetail } = require('../utils/audit');

const router = express.Router();
router.use(authMiddleware, empresaMiddleware);

const LOW_STOCK_CRITICAL_THRESHOLD = 100;
const LOW_STOCK_WARNING_THRESHOLD = 200;
const ALERT_FETCH_LIMIT = 500;
const STOCK_MOVEMENT_EFFECTS = {
  APROBACION: { originDelta: -1, destinationDelta: 1 },
  SALIDA_TRANSITO: { originDelta: -1, destinationDelta: 0 },
  INGRESO_APROBADO: { originDelta: 0, destinationDelta: 1 },
  REVERSA_RECHAZO: { originDelta: 1, destinationDelta: 0 },
  STOCK_INITIAL: { originDelta: 0, destinationDelta: 1 },
  TG_INTERNO_SALIDA: { originDelta: -1, destinationDelta: 0 },
  TG_INTERNO_ENTRADA: { originDelta: 0, destinationDelta: 1 },
};
const DETAIL_COUNT_EXPR = 'COALESCE((SELECT COUNT(*) FROM registro_detalles rd_count WHERE rd_count.registro_id = r.id), 0)';
const PRIMARY_SKU_EXPR = `COALESCE((
  SELECT MIN(sk_detail.nombre)
  FROM registro_detalles rd_sku
  JOIN skus sk_detail ON sk_detail.id = rd_sku.sku_id
  WHERE rd_sku.registro_id = r.id
), sk.nombre, '')`;

function getZonaExpr(cityAlias = 'ci') {
  return `CASE WHEN UPPER(${cityAlias}.nombre)='LIMA' THEN 'LIMA' ELSE 'PROVINCIA' END`;
}

function toStockInteger(value) {
  return Math.trunc(Number(value || 0));
}

function getMovementEffects(tipoMovimiento = 'APROBACION') {
  return STOCK_MOVEMENT_EFFECTS[tipoMovimiento] || STOCK_MOVEMENT_EFFECTS.APROBACION;
}

function shouldIncludeSameWarehouseMovement(movement) {
  const tipoMovimiento = String(movement.tipo_movimiento || '').toUpperCase();
  if (tipoMovimiento === 'STOCK_INITIAL') return true;
  if (['TG_INTERNO_ENTRADA', 'TG_INTERNO_SALIDA'].includes(tipoMovimiento)) return true;

  const tipoAccion = String(movement.tipo_accion || '').trim().toUpperCase();
  if (tipoAccion === 'ENTRADA') {
    return ['INGRESO_APROBADO', 'APROBACION'].includes(tipoMovimiento);
  }
  return ['SALIDA_TRANSITO', 'APROBACION'].includes(tipoMovimiento);
}

function getSameWarehouseDirection(movement) {
  const tipoMovimiento = String(movement.tipo_movimiento || '').toUpperCase();
  if (tipoMovimiento === 'TG_INTERNO_ENTRADA') return 1;
  if (tipoMovimiento === 'TG_INTERNO_SALIDA') return -1;
  return String(movement.tipo_accion || '').trim().toUpperCase() === 'ENTRADA' ? 1 : -1;
}

function buildDashboardStockRows(movements = [], scopedWarehouseIds = []) {
  const scopedWarehouseSet = scopedWarehouseIds.length
    ? new Set(scopedWarehouseIds.map((id) => Number(id)))
    : null;
  const rowsByKey = new Map();

  movements.forEach((movement) => {
    const quantity = Number(movement.cantidad || 0);
    if (!quantity) return;

    const effects = getMovementEffects(movement.tipo_movimiento);
    const originId = Number(movement.almacen_origen_id || 0);
    const destinationId = Number(movement.almacen_destino_id || 0);
    const sameWarehouse = originId && destinationId && originId === destinationId;
    const entries = [];

    if (sameWarehouse) {
      if (!shouldIncludeSameWarehouseMovement(movement)) return;
      entries.push({
        almacen_id: originId,
        almacen: movement.almacen_origen_nombre || movement.almacen_destino_nombre || '',
        zona: movement.zona || '',
        delta: quantity * getSameWarehouseDirection(movement),
      });
    } else {
      if (effects.originDelta && originId) {
        entries.push({
          almacen_id: originId,
          almacen: movement.almacen_origen_nombre || '',
          zona: movement.zona_origen || movement.zona || '',
          delta: quantity * effects.originDelta,
        });
      }
      if (effects.destinationDelta && destinationId) {
        entries.push({
          almacen_id: destinationId,
          almacen: movement.almacen_destino_nombre || '',
          zona: movement.zona_destino || movement.zona || '',
          delta: quantity * effects.destinationDelta,
        });
      }
    }

    entries.forEach((entry) => {
      if (scopedWarehouseSet && !scopedWarehouseSet.has(Number(entry.almacen_id))) return;
      const loteKey = movement.lote_id ? String(movement.lote_id) : 'sin-lote';
      const key = [entry.almacen_id, movement.sku_id, loteKey].join('|');

      if (!rowsByKey.has(key)) {
        rowsByKey.set(key, {
          almacen_id: Number(entry.almacen_id),
          almacen: entry.almacen,
          zona: entry.zona,
          categoria_id: movement.categoria_id ? Number(movement.categoria_id) : null,
          categoria: movement.categoria_nombre || '',
          tipo_mercaderia_id: movement.tipo_mercaderia_id ? Number(movement.tipo_mercaderia_id) : null,
          tipo_mercaderia: movement.tipo_mercaderia_nombre || '',
          sku_id: Number(movement.sku_id),
          sku_codigo: movement.sku_codigo || '',
          sku: movement.sku_nombre || '',
          lote_id: movement.lote_id ? Number(movement.lote_id) : null,
          lote: movement.codigo_lote || 'SIN LOTE',
          fecha_vencimiento: movement.lote_fecha_vencimiento || null,
          stock_final: 0,
        });
      }

      const stockRow = rowsByKey.get(key);
      if (!stockRow.sku_codigo && movement.sku_codigo) stockRow.sku_codigo = movement.sku_codigo;
      if (!stockRow.sku && movement.sku_nombre) stockRow.sku = movement.sku_nombre;
      if (!stockRow.categoria && movement.categoria_nombre) stockRow.categoria = movement.categoria_nombre;
      if (!stockRow.tipo_mercaderia && movement.tipo_mercaderia_nombre) stockRow.tipo_mercaderia = movement.tipo_mercaderia_nombre;
      stockRow.stock_final += entry.delta;
    });
  });

  return [...rowsByKey.values()]
    .map((row) => ({ ...row, stock_final: toStockInteger(row.stock_final) }))
    .filter((row) => Number(row.stock_final || 0) !== 0)
    .sort((a, b) =>
      String(a.almacen).localeCompare(String(b.almacen)) ||
      String(a.categoria).localeCompare(String(b.categoria)) ||
      String(a.tipo_mercaderia).localeCompare(String(b.tipo_mercaderia)) ||
      String(a.sku).localeCompare(String(b.sku)) ||
      String(a.lote).localeCompare(String(b.lote))
    );
}

async function loadSkuReferenceMap(executor = pool, empresaId = null) {
  let query = `SELECT
      sk.id,
      sk.codigo,
      sk.nombre,
      sk.categoria_id,
      ca.nombre AS categoria_nombre,
      sk.tipo_mercaderia_id,
      tm.nombre AS tipo_mercaderia_nombre
    FROM skus sk
    LEFT JOIN categorias ca ON ca.id = sk.categoria_id
    LEFT JOIN tipos_mercaderia tm ON tm.id = sk.tipo_mercaderia_id
    WHERE 1=1`;
  const params = [];

  if (empresaId) {
    query += ' AND sk.empresa_id=?';
    params.push(empresaId);
  }

  const [rows] = await executor.query(query, params);
  return new Map(rows.map((row) => [Number(row.id), row]));
}

function applySkuReference(detail = {}, skuReferenceMap = new Map()) {
  const skuId = Number(detail.sku_id || 0);
  const skuReference = skuId ? skuReferenceMap.get(skuId) : null;
  if (!skuReference) return detail;

  return {
    ...detail,
    sku_codigo: skuReference.codigo || detail.sku_codigo || '',
    sku_nombre: skuReference.nombre || detail.sku_nombre || '',
    categoria_id: skuReference.categoria_id || detail.categoria_id || null,
    categoria_nombre: skuReference.categoria_nombre || detail.categoria_nombre || '',
    tipo_mercaderia_id: skuReference.tipo_mercaderia_id || detail.tipo_mercaderia_id || null,
    tipo_mercaderia_nombre: skuReference.tipo_mercaderia_nombre || detail.tipo_mercaderia_nombre || '',
  };
}

function buildStockInitialMovements(auditRows = [], skuReferenceMap = new Map()) {
  return auditRows.map((auditRow) => {
    const parsedDetail = parseAuditDetail(auditRow.detalle);
    const detail = parsedDetail ? applySkuReference(parsedDetail, skuReferenceMap) : null;
    if (!detail || !detail.almacen_id || !detail.sku_id || !detail.cantidad) return null;
    return {
      id: `audit-${auditRow.id}`,
      tipo_movimiento: 'STOCK_INITIAL',
      tipo_accion: 'ENTRADA',
      cantidad: Number(detail.cantidad || 0),
      almacen_origen_id: null,
      almacen_destino_id: Number(detail.almacen_id),
      almacen_origen_nombre: '',
      almacen_destino_nombre: detail.almacen_nombre || '',
      zona: detail.zona || '',
      zona_destino: detail.zona || '',
      categoria_id: detail.categoria_id || null,
      categoria_nombre: detail.categoria_nombre || '',
      tipo_mercaderia_id: detail.tipo_mercaderia_id || null,
      tipo_mercaderia_nombre: detail.tipo_mercaderia_nombre || '',
      sku_id: Number(detail.sku_id),
      sku_codigo: detail.sku_codigo || '',
      sku_nombre: detail.sku_nombre || '',
      lote_id: detail.lote_id || null,
      codigo_lote: detail.codigo_lote || '',
      lote_fecha_vencimiento: detail.fecha_vencimiento || null,
    };
  }).filter(Boolean);
}

function applyDashboardStockFilters(rows, filters = {}) {
  return rows.filter((row) => {
    if (filters.almacen_id && Number(row.almacen_id) !== Number(filters.almacen_id)) return false;
    if (filters.zona && row.zona !== filters.zona) return false;
    if (filters.categoria_id && Number(row.categoria_id) !== Number(filters.categoria_id)) return false;
    if (filters.tipo_mercaderia_id && Number(row.tipo_mercaderia_id) !== Number(filters.tipo_mercaderia_id)) return false;
    if (filters.sku) {
      const term = String(filters.sku).toLowerCase();
      if (!String(row.sku || '').toLowerCase().includes(term) && !String(row.sku_codigo || '').toLowerCase().includes(term)) return false;
    }
    if (filters.lote && !String(row.lote || 'SIN LOTE').toLowerCase().includes(String(filters.lote).toLowerCase())) return false;
    if (filters.vencimiento_desde) {
      const dateValue = row.fecha_vencimiento ? String(row.fecha_vencimiento).slice(0, 10) : '';
      if (!dateValue || dateValue < filters.vencimiento_desde) return false;
    }
    if (filters.vencimiento_hasta) {
      const dateValue = row.fecha_vencimiento ? String(row.fecha_vencimiento).slice(0, 10) : '';
      if (!dateValue || dateValue > filters.vencimiento_hasta) return false;
    }
    return true;
  });
}

async function getDashboardWarehouseScope(req) {
  if (!req?.usuario || req.usuario.rol === 'superadmin') {
    return [];
  }

  const assignedIds = await getAssignedWarehouseIds(req.usuario.id);
  if (['almacenero', 'supervisor'].includes(req.usuario.rol)) {
    return assignedIds;
  }

  return assignedIds.length ? assignedIds : [];
}

async function hasConfigNotificacionesTable() {
  const [rows] = await pool.query("SHOW TABLES LIKE 'config_notificaciones'");
  return rows.length > 0;
}

function normalizeDashboardLabel(value) {
  return String(value || 'SIN DATO')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function normalizeSqlText(expr) {
  return `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(UPPER(TRIM(COALESCE(${expr}, ''))), 'Á', 'A'), 'É', 'E'), 'Í', 'I'), 'Ó', 'O'), 'Ú', 'U')`;
}

router.get('/resumen', async (req, res) => {
  try {
    const eid = req.empresa_id;
    const {
      almacen_id,
      zona,
      categoria_id,
      tipo_mercaderia_id,
      sku,
      lote,
      vencimiento_desde,
      vencimiento_hasta,
    } = req.query;
    const hasNotificationConfig = await hasConfigNotificacionesTable();
    const configuredTypeNameExpr = normalizeSqlText('cn_tm.nombre');
    const skuTypeNameExpr = normalizeSqlText('tm.nombre');
    const notificationConfigMatch = `
      cn.empresa_id = sa.empresa_id
      AND cn.activo = 1
      AND (
        cn.tipo_mercaderia_id = sk.tipo_mercaderia_id
        OR EXISTS (
          SELECT 1
          FROM tipos_mercaderia cn_tm
          WHERE cn_tm.id = cn.tipo_mercaderia_id
            AND cn_tm.categoria_id = sk.categoria_id
            AND ${configuredTypeNameExpr} = ${skuTypeNameExpr}
        )
      )`;
    const vencimientosExclusionFilter = hasNotificationConfig
      ? `AND NOT EXISTS (
           SELECT 1
           FROM config_notificaciones cn
           WHERE ${notificationConfigMatch}
             AND cn.excluir_de_vencimientos = 1
         )`
      : '';
    const stockExclusionSelect = hasNotificationConfig
      ? `EXISTS (
           SELECT 1
           FROM config_notificaciones cn
           WHERE ${notificationConfigMatch}
             AND cn.excluir_de_stock_critico = 1
         ) AS excluir_de_stock_critico,
         EXISTS (
           SELECT 1
           FROM config_notificaciones cn
           WHERE ${notificationConfigMatch}
             AND cn.excluir_de_stock_bajo = 1
         ) AS excluir_de_stock_bajo,`
      : '0 AS excluir_de_stock_critico, 0 AS excluir_de_stock_bajo,';
    const scope = await getWarehouseScope(req, 'r');
    const registroFilters = [];
    const registroFilterParams = [];

    if (almacen_id) {
      registroFilters.push('(r.almacen_origen_id = ? OR r.almacen_destino_id = ?)');
      registroFilterParams.push(almacen_id, almacen_id);
    }
    if (zona) {
      registroFilters.push(`EXISTS (
        SELECT 1
        FROM almacenes a_zona
        JOIN ciudades c_zona ON c_zona.id = a_zona.ciudad_id
        WHERE a_zona.id IN (r.almacen_origen_id, r.almacen_destino_id)
          AND ${getZonaExpr('c_zona')} = ?
      )`);
      registroFilterParams.push(zona);
    }
    if (categoria_id) {
      registroFilters.push('r.categoria_id = ?');
      registroFilterParams.push(categoria_id);
    }
    if (tipo_mercaderia_id) {
      const selectedTypeNameExpr = normalizeSqlText('tm_selected.nombre');
      const registroTypeNameExpr = normalizeSqlText('tm_registro.nombre');
      const detailTypeNameExpr = normalizeSqlText('tm_detail_filter.nombre');
      const registroActionTypeExpr = normalizeSqlText('r.tipo_accion');
      registroFilters.push(`(
        r.tipo_mercaderia_id = ?
        OR EXISTS (
          SELECT 1
          FROM tipos_mercaderia tm_selected
          WHERE tm_selected.id = ?
            AND (
              EXISTS (
                SELECT 1
                FROM tipos_mercaderia tm_registro
                WHERE tm_registro.id = r.tipo_mercaderia_id
                  AND tm_registro.categoria_id = tm_selected.categoria_id
                  AND ${selectedTypeNameExpr} = ${registroTypeNameExpr}
              )
              OR (r.categoria_id = tm_selected.categoria_id AND ${selectedTypeNameExpr} = ${registroActionTypeExpr})
            )
        )
        OR EXISTS (
          SELECT 1
          FROM registro_detalles rd_type_filter
          JOIN tipos_mercaderia tm_detail_filter ON tm_detail_filter.id = rd_type_filter.tipo_mercaderia_id
          JOIN tipos_mercaderia tm_selected_detail ON tm_selected_detail.id = ?
          WHERE rd_type_filter.registro_id = r.id
            AND tm_detail_filter.categoria_id = tm_selected_detail.categoria_id
            AND ${normalizeSqlText('tm_selected_detail.nombre')} = ${detailTypeNameExpr}
        )
      )`);
      registroFilterParams.push(tipo_mercaderia_id, tipo_mercaderia_id, tipo_mercaderia_id);
    }
    if (sku) {
      registroFilters.push(`(
        EXISTS (
          SELECT 1
          FROM skus sk_filter
          WHERE sk_filter.id = r.sku_id
            AND (sk_filter.nombre LIKE ? OR sk_filter.codigo LIKE ?)
        )
        OR EXISTS (
          SELECT 1
          FROM registro_detalles rd_filter
          JOIN skus sk_detail_filter ON sk_detail_filter.id = rd_filter.sku_id
          WHERE rd_filter.registro_id = r.id
            AND (sk_detail_filter.nombre LIKE ? OR sk_detail_filter.codigo LIKE ?)
        )
      )`);
      registroFilterParams.push(`%${sku}%`, `%${sku}%`, `%${sku}%`, `%${sku}%`);
    }
    if (lote) {
      registroFilters.push(`(
        EXISTS (
          SELECT 1
          FROM lotes lo_filter
          WHERE lo_filter.id = r.lote_id
            AND COALESCE(lo_filter.codigo_lote, 'SIN LOTE') LIKE ?
        )
        OR EXISTS (
          SELECT 1
          FROM registro_detalles rd_lote_filter
          JOIN lotes lo_detail_filter ON lo_detail_filter.id = rd_lote_filter.lote_id
          WHERE rd_lote_filter.registro_id = r.id
            AND COALESCE(lo_detail_filter.codigo_lote, 'SIN LOTE') LIKE ?
        )
      )`);
      registroFilterParams.push(`%${lote}%`, `%${lote}%`);
    }
    if (vencimiento_desde) {
      registroFilters.push('r.fecha_vencimiento >= ?');
      registroFilterParams.push(vencimiento_desde);
    }
    if (vencimiento_hasta) {
      registroFilters.push('r.fecha_vencimiento <= ?');
      registroFilterParams.push(vencimiento_hasta);
    }

    const registroFilterClause = registroFilters.length ? ` AND ${registroFilters.join(' AND ')}` : '';
    const whereRegistros = eid
      ? `WHERE r.empresa_id=? AND r.eliminado_at IS NULL${scope.clause}${registroFilterClause}`
      : `WHERE r.eliminado_at IS NULL${scope.clause}${registroFilterClause}`;
    const scopedParams = eid ? [eid, ...scope.params, ...registroFilterParams] : [...scope.params, ...registroFilterParams];

    const [[totales]] = await pool.query(
      `SELECT
        COUNT(*) AS total_registros,
        SUM(CASE WHEN r.estado='pendiente' THEN 1 ELSE 0 END) AS pendientes,
        SUM(CASE WHEN r.estado='en_transito' THEN 1 ELSE 0 END) AS en_transito,
        SUM(CASE WHEN r.estado='aprobado' THEN 1 ELSE 0 END) AS aprobados,
        SUM(CASE WHEN DATE(r.created_at)=CURDATE() THEN 1 ELSE 0 END) AS hoy
       FROM registros r
       ${whereRegistros}`,
      scopedParams
    );

    const [por_categoria] = await pool.query(
      `SELECT ca.nombre,
              COUNT(r.id) AS total,
              SUM(COALESCE((
                SELECT SUM(rd.cantidad)
                FROM registro_detalles rd
                WHERE rd.registro_id = r.id
              ), r.cantidad, 0)) AS cantidad
       FROM registros r
       JOIN categorias ca ON ca.id = r.categoria_id
       ${whereRegistros}
       GROUP BY ca.id
       ORDER BY total DESC
       LIMIT 10`,
      scopedParams
    );

    const [por_mes] = await pool.query(
      `SELECT DATE_FORMAT(r.fecha,'%Y-%m') AS mes,
              COUNT(*) AS total,
              SUM(COALESCE((
                SELECT SUM(rd.cantidad)
                FROM registro_detalles rd
                WHERE rd.registro_id = r.id
              ), r.cantidad, 0)) AS cantidad
       FROM registros r
       ${whereRegistros} AND r.fecha >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
       GROUP BY mes
       ORDER BY mes`,
      scopedParams
    );

    const [transitoRaw] = await pool.query(
      `SELECT
        r.id,
        r.fecha,
        r.nro_guia,
        ao.nombre AS almacen_origen,
        ad.nombre AS almacen_destino,
        ${PRIMARY_SKU_EXPR} AS sku_principal_nombre,
        GREATEST(${DETAIL_COUNT_EXPR}, 1) AS detalles_count
       FROM registros r
       LEFT JOIN almacenes ao ON ao.id = r.almacen_origen_id
       LEFT JOIN almacenes ad ON ad.id = r.almacen_destino_id
       LEFT JOIN skus sk ON sk.id = r.sku_id
       ${whereRegistros} AND r.estado='en_transito'
       ORDER BY r.fecha DESC, r.id DESC
       LIMIT 20`,
      scopedParams
    );

    const transito = transitoRaw.map((row) => {
      const totalDetalles = Number(row.detalles_count || 1);
      const skuPrincipal = row.sku_principal_nombre || '-';
      return {
        ...row,
        detalles_count: totalDetalles,
        sku_resumen: totalDetalles > 1 ? `${skuPrincipal} +${totalDetalles - 1} más` : skuPrincipal,
      };
    });

    const scopedStockIds = await getDashboardWarehouseScope(req);
    const stockFilters = [];
    const stockFilterParams = [];

    if (almacen_id) {
      stockFilters.push('sa.almacen_id = ?');
      stockFilterParams.push(almacen_id);
    }
    if (zona) {
      stockFilters.push(`${getZonaExpr('c_stock')} = ?`);
      stockFilterParams.push(zona);
    }
    if (categoria_id) {
      stockFilters.push('sk.categoria_id = ?');
      stockFilterParams.push(categoria_id);
    }
    if (tipo_mercaderia_id) {
      stockFilters.push(`(
        sk.tipo_mercaderia_id = ?
        OR EXISTS (
          SELECT 1
          FROM tipos_mercaderia tm_selected_stock
          WHERE tm_selected_stock.id = ?
            AND tm_selected_stock.categoria_id = sk.categoria_id
            AND ${normalizeSqlText('tm_selected_stock.nombre')} = ${normalizeSqlText('tm.nombre')}
        )
      )`);
      stockFilterParams.push(tipo_mercaderia_id, tipo_mercaderia_id);
    }
    if (sku) {
      stockFilters.push('(sk.nombre LIKE ? OR sk.codigo LIKE ?)');
      stockFilterParams.push(`%${sku}%`, `%${sku}%`);
    }
    if (lote) {
      stockFilters.push("COALESCE(lo.codigo_lote, 'SIN LOTE') LIKE ?");
      stockFilterParams.push(`%${lote}%`);
    }
    if (vencimiento_desde) {
      stockFilters.push('lo.fecha_vencimiento >= ?');
      stockFilterParams.push(vencimiento_desde);
    }
    if (vencimiento_hasta) {
      stockFilters.push('lo.fecha_vencimiento <= ?');
      stockFilterParams.push(vencimiento_hasta);
    }

    const stockWhere = [
      'sa.cantidad > 0',
      eid ? 'sa.empresa_id = ?' : null,
      scopedStockIds.length ? `sa.almacen_id IN (${scopedStockIds.map(() => '?').join(',')})` : null,
      ...stockFilters,
    ].filter(Boolean).join(' AND ');
    const stockParams = [
      ...(eid ? [eid] : []),
      ...scopedStockIds,
      ...stockFilterParams,
    ];

    const [vencimientos] = await pool.query(
      `SELECT sa.id, sk.nombre AS sku, lo.fecha_vencimiento, sa.cantidad, ao.nombre AS almacen
       FROM stock_almacen sa
       JOIN skus sk ON sk.id = sa.sku_id
       LEFT JOIN tipos_mercaderia tm ON tm.id = sk.tipo_mercaderia_id
       JOIN lotes lo ON lo.id = sa.lote_id
       JOIN almacenes ao ON ao.id = sa.almacen_id
       JOIN ciudades c_stock ON c_stock.id = ao.ciudad_id
       WHERE ${stockWhere}
         AND lo.fecha_vencimiento IS NOT NULL
         AND lo.fecha_vencimiento BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)
         ${vencimientosExclusionFilter}
       ORDER BY lo.fecha_vencimiento
       LIMIT ${ALERT_FETCH_LIMIT}`,
      stockParams
    );

    const [vencidos] = await pool.query(
      `SELECT sa.id, sk.nombre AS sku, lo.fecha_vencimiento, sa.cantidad, ao.nombre AS almacen
       FROM stock_almacen sa
       JOIN skus sk ON sk.id = sa.sku_id
       LEFT JOIN tipos_mercaderia tm ON tm.id = sk.tipo_mercaderia_id
       JOIN lotes lo ON lo.id = sa.lote_id
       JOIN almacenes ao ON ao.id = sa.almacen_id
       JOIN ciudades c_stock ON c_stock.id = ao.ciudad_id
       WHERE ${stockWhere}
         AND lo.fecha_vencimiento < CURDATE()
         ${vencimientosExclusionFilter}
       ORDER BY lo.fecha_vencimiento
       LIMIT ${ALERT_FETCH_LIMIT}`,
      stockParams
    );

    const [stockAlertRows] = await pool.query(
      `SELECT
        sa.almacen_id,
        sa.sku_id,
        ao.nombre AS almacen,
        sk.nombre AS sku,
        ca.nombre AS categoria,
        tm.nombre AS tipo_mercaderia,
        ${stockExclusionSelect}
        SUM(sa.cantidad) AS cantidad
       FROM stock_almacen sa
       JOIN skus sk ON sk.id = sa.sku_id
       LEFT JOIN categorias ca ON ca.id = sk.categoria_id
       LEFT JOIN tipos_mercaderia tm ON tm.id = sk.tipo_mercaderia_id
       JOIN almacenes ao ON ao.id = sa.almacen_id
       JOIN ciudades c_stock ON c_stock.id = ao.ciudad_id
       LEFT JOIN lotes lo ON lo.id = sa.lote_id
       WHERE ${stockWhere}
       GROUP BY sa.almacen_id, sa.sku_id, ao.nombre, sk.nombre, ca.nombre, tm.nombre, sk.tipo_mercaderia_id, sa.empresa_id
       HAVING SUM(sa.cantidad) <= ?
       ORDER BY cantidad ASC, sk.nombre ASC
       LIMIT ${ALERT_FETCH_LIMIT}`,
      [...stockParams, LOW_STOCK_WARNING_THRESHOLD]
    );

    const stock_critico = [];
    const stock_bajo = [];

    stockAlertRows.forEach((item) => {
      const normalizedItem = {
        ...item,
        cantidad: Number(item.cantidad || 0),
      };

      if (normalizedItem.cantidad <= LOW_STOCK_CRITICAL_THRESHOLD) {
        if (!normalizedItem.excluir_de_stock_critico) {
          stock_critico.push(normalizedItem);
        }
      } else if (!normalizedItem.excluir_de_stock_bajo) {
        stock_bajo.push(normalizedItem);
      }
    });

    res.json({
      ok: true,
      datos: {
        totales,
        por_categoria,
        por_mes,
        alertas: {
          transito,
          vencimientos_proximos: vencimientos,
          vencidos,
          stock_critico,
          stock_bajo,
          stock_limites: {
            critico: LOW_STOCK_CRITICAL_THRESHOLD,
            bajo: LOW_STOCK_WARNING_THRESHOLD,
          },
        },
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, mensaje: 'Error interno' });
  }
});

router.get('/stock-table', async (req, res) => {
  try {
    const eid = req.empresa_id;
    const {
      almacen_id,
      zona,
      categoria_id,
      tipo_mercaderia_id,
      sku,
      lote,
      vencimiento_desde,
      vencimiento_hasta,
    } = req.query;

    const scopedStockIds = await getDashboardWarehouseScope(req);
    
    let movementsQuery = `SELECT
        sm.id,
        sm.tipo_movimiento,
        sm.cantidad,
        sm.almacen_origen_id,
        sm.almacen_destino_id,
        sm.sku_id,
        sm.lote_id,
        COALESCE(r.accion, 'TG INTERNO') AS accion,
        COALESCE(r.tipo_accion,
          CASE WHEN sm.tipo_movimiento='TG_INTERNO_ENTRADA' THEN 'ENTRADA'
               WHEN sm.tipo_movimiento='TG_INTERNO_SALIDA' THEN 'SALIDA'
               ELSE NULL END
        ) AS tipo_accion,
        sk.codigo AS sku_codigo,
        sk.nombre AS sku_nombre,
        ca.id AS categoria_id,
        ca.nombre AS categoria_nombre,
        tm.id AS tipo_mercaderia_id,
        tm.nombre AS tipo_mercaderia_nombre,
        lo.codigo_lote,
        lo.fecha_vencimiento AS lote_fecha_vencimiento,
        ao.nombre AS almacen_origen_nombre,
        ad.nombre AS almacen_destino_nombre,
        ${getZonaExpr('co')} AS zona_origen,
        ${getZonaExpr('cd')} AS zona_destino,
        CASE WHEN sm.almacen_origen_id IS NOT NULL THEN ${getZonaExpr('co')} ELSE ${getZonaExpr('cd')} END AS zona
      FROM stock_movimientos sm
      LEFT JOIN registros r ON r.id = sm.registro_id
      JOIN skus sk ON sk.id = sm.sku_id
      JOIN categorias ca ON ca.id = sk.categoria_id
      LEFT JOIN tipos_mercaderia tm ON tm.id = sk.tipo_mercaderia_id
      LEFT JOIN lotes lo ON lo.id = sm.lote_id
      LEFT JOIN almacenes ao ON ao.id = sm.almacen_origen_id
      LEFT JOIN almacenes ad ON ad.id = sm.almacen_destino_id
      LEFT JOIN ciudades co ON co.id = ao.ciudad_id
      LEFT JOIN ciudades cd ON cd.id = ad.ciudad_id
      WHERE (r.id IS NULL OR r.eliminado_at IS NULL)`;
    const movementParams = [];
    if (eid) {
      movementsQuery += ' AND sm.empresa_id=?';
      movementParams.push(eid);
    }

    const [stockMovements] = await pool.query(movementsQuery, movementParams);

    let auditQuery = `SELECT id, created_at, detalle
                      FROM audit_log
                      WHERE accion='STOCK_INITIAL' AND tabla='stock_almacen'`;
    const auditParams = [];
    if (eid) {
      auditQuery += ' AND empresa_id=?';
      auditParams.push(eid);
    }
    const [auditRows] = await pool.query(auditQuery, auditParams);
    const skuReferenceMap = await loadSkuReferenceMap(pool, eid);

    const filterRows = buildDashboardStockRows(
      [...stockMovements, ...buildStockInitialMovements(auditRows, skuReferenceMap)],
      scopedStockIds,
    );
    const normalizedRows = applyDashboardStockFilters(filterRows, {
      almacen_id,
      zona,
      categoria_id,
      tipo_mercaderia_id,
      sku,
      lote,
      vencimiento_desde,
      vencimiento_hasta,
    });

    const uniqueBy = (key, labelKey) => Array.from(
      filterRows.reduce((map, row) => {
        if (row[key]) map.set(Number(row[key]), row[labelKey] || '');
        return map;
      }, new Map()).entries(),
    )
      .map(([id, nombre]) => ({ id, nombre }))
      .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));

    const uniqueWarehouses = () => Array.from(
      filterRows.reduce((map, row) => {
        if (row.almacen_id) {
          map.set(Number(row.almacen_id), {
            id: Number(row.almacen_id),
            nombre: row.almacen || '',
            zona: row.zona || '',
          });
        }
        return map;
      }, new Map()).values(),
    ).sort((a, b) => String(a.zona).localeCompare(String(b.zona)) || String(a.nombre).localeCompare(String(b.nombre)));

    const uniqueTypeByCategory = () => Array.from(
      filterRows.reduce((map, row) => {
        if (!row.tipo_mercaderia_id) return map;
        const label = row.tipo_mercaderia || 'SIN DATO';
        const normalized = normalizeDashboardLabel(label);
        const categoryId = row.categoria_id ? Number(row.categoria_id) : 0;
        const key = `${categoryId}-${normalized}`;
        if (!map.has(key)) {
          map.set(key, {
            id: Number(row.tipo_mercaderia_id),
            nombre: label,
            categoria_id: row.categoria_id ? Number(row.categoria_id) : null,
            categoria_nombre: row.categoria || '',
          });
        }
        return map;
      }, new Map()).values(),
    ).sort((a, b) => {
      const categoryCompare = String(a.categoria_nombre).localeCompare(String(b.categoria_nombre));
      return categoryCompare || String(a.nombre).localeCompare(String(b.nombre));
    });

    const sumBy = (labelKey) => Array.from(
      normalizedRows.reduce((map, row) => {
        const label = row[labelKey] || 'SIN DATO';
        map.set(label, (map.get(label) || 0) + Number(row.stock_final || 0));
        return map;
      }, new Map()).entries(),
    )
      .map(([nombre, stock]) => ({ nombre, stock }))
      .sort((a, b) => b.stock - a.stock);

    const sumByNormalized = (labelKey) => Array.from(
      normalizedRows.reduce((map, row) => {
        const label = row[labelKey] || 'SIN DATO';
        const normalized = normalizeDashboardLabel(label);
        const current = map.get(normalized) || { nombre: label, stock: 0 };
        current.stock += Number(row.stock_final || 0);
        map.set(normalized, current);
        return map;
      }, new Map()).values(),
    ).sort((a, b) => b.stock - a.stock);

    res.json({
      ok: true,
      datos: {
        rows: normalizedRows,
        filtros: {
          almacenes: uniqueWarehouses(),
          zonas: ['LIMA', 'PROVINCIA'].filter((zonaNombre) => filterRows.some((row) => row.zona === zonaNombre)),
          categorias: uniqueBy('categoria_id', 'categoria'),
          tipos_mercaderia: uniqueTypeByCategory(),
        },
        resumen: {
          por_almacen: sumBy('almacen').slice(0, 30),
          por_categoria: sumBy('categoria').slice(0, 12),
          por_tipo_mercaderia: sumByNormalized('tipo_mercaderia').slice(0, 12),
        },
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, mensaje: 'Error interno' });
  }
});

module.exports = router;
