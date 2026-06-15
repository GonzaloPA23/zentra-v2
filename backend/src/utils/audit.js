const { pool } = require('../db');

async function insertAuditLog(executor = pool, entry) {
  const target = executor && typeof executor.query === 'function' ? executor : pool;
  const detalle = entry?.detalle ? JSON.stringify(entry.detalle) : null;

  await target.query(
    'INSERT INTO audit_log (empresa_id, usuario_id, accion, tabla, registro_id, detalle, ip) VALUES (?,?,?,?,?,?,?)',
    [
      entry?.empresa_id ?? null,
      entry?.usuario_id ?? null,
      entry?.accion ?? 'UNKNOWN',
      entry?.tabla ?? 'general',
      entry?.registro_id ?? null,
      detalle,
      entry?.ip ?? null,
    ]
  );
}

function normalizeAuditString(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function buildSkuSummary(detalles = []) {
  const skuNames = detalles
    .map((detail) => normalizeAuditString(detail?.sku_nombre))
    .filter(Boolean);

  if (!skuNames.length) return '';
  return skuNames.length === 1 ? skuNames[0] : `${skuNames[0]} +${skuNames.length - 1} mas`;
}

function buildRegistroAuditSnapshot(registro = {}, extra = {}) {
  const detalles = Array.isArray(registro?.detalles) ? registro.detalles : [];
  const totalCantidad = Number(extra.total_cantidad ?? registro?.cantidad_total ?? registro?.cantidad ?? 0);
  const snapshot = {
    estado: normalizeAuditString(extra.estado ?? registro?.estado) || null,
    detalle_items: extra.detalle_items ?? detalles.length ?? registro?.detalles_count ?? null,
    total_cantidad: Number.isFinite(totalCantidad) ? totalCantidad : null,
    zona: normalizeAuditString(extra.zona ?? registro?.zona) || null,
    ciudad_id: extra.ciudad_id ?? registro?.ciudad_id ?? null,
    ciudad_nombre: normalizeAuditString(extra.ciudad_nombre ?? registro?.ciudad_nombre) || null,
    categoria_id: extra.categoria_id ?? registro?.categoria_id ?? null,
    categoria_nombre: normalizeAuditString(extra.categoria_nombre ?? registro?.categoria_nombre) || null,
    accion: normalizeAuditString(extra.accion ?? registro?.accion) || null,
    tipo_accion: normalizeAuditString(extra.tipo_accion ?? registro?.tipo_accion) || null,
    nro_guia: normalizeAuditString(extra.nro_guia ?? registro?.nro_guia) || null,
    almacen_origen_id: extra.almacen_origen_id ?? registro?.almacen_origen_id ?? null,
    almacen_origen_nombre: normalizeAuditString(extra.almacen_origen_nombre ?? registro?.almacen_origen) || null,
    almacen_destino_id: extra.almacen_destino_id ?? registro?.almacen_destino_id ?? null,
    almacen_destino_nombre: normalizeAuditString(extra.almacen_destino_nombre ?? registro?.almacen_destino) || null,
    personal_receptor_id: extra.personal_receptor_id ?? registro?.personal_receptor_id ?? null,
    personal_receptor_nombre: normalizeAuditString(extra.personal_receptor_nombre ?? registro?.personal_receptor_nombre) || null,
    indicador_id: extra.indicador_id ?? registro?.indicador_id ?? null,
    indicador_nombre: normalizeAuditString(extra.indicador_nombre ?? registro?.indicador_nombre) || null,
    sku_resumen: normalizeAuditString(extra.sku_resumen ?? registro?.sku_resumen ?? buildSkuSummary(detalles)) || null,
    detalles: detalles.map((detail) => ({
      sku_id: detail?.sku_id ?? null,
      sku_nombre: normalizeAuditString(detail?.sku_nombre) || null,
      lote_id: detail?.lote_id ?? null,
      codigo_lote: normalizeAuditString(detail?.codigo_lote) || null,
      cantidad: Number(detail?.cantidad || 0),
    })),
  };

  Object.entries(extra || {}).forEach(([key, value]) => {
    if (value !== undefined) {
      snapshot[key] = value;
    }
  });

  return snapshot;
}

function parseAuditDetail(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function describeAuditAction(action, detail) {
  if (detail?.summary) return detail.summary;

  if (action === 'STATUS_CHANGE') {
    const labels = {
      pendiente: 'Pendiente',
      en_transito: 'En camino',
      aprobado: 'Aprobado',
      rechazado: 'Rechazado',
    };
    if (detail?.from || detail?.to) {
      const from = labels[detail.from] || detail.from || 'sin estado';
      const to = labels[detail.to] || detail.to || 'sin estado';
      return `Cambio de estado: ${from} -> ${to}`;
    }
    return 'Cambio de estado';
  }

  const fallbacks = {
    CREATE: 'Creo un registro',
    UPDATE: 'Edito un registro',
    UPDATE_APPROVED: 'Edito un registro aprobado',
    DELETE: 'Elimino un registro',
    DELETE_APPROVED: 'Elimino un registro aprobado',
  };

  return fallbacks[action] || action;
}

module.exports = {
  buildRegistroAuditSnapshot,
  insertAuditLog,
  parseAuditDetail,
  describeAuditAction,
};
