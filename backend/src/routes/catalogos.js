const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { body, param, validationResult } = require("express-validator");
const { pool } = require("../db");
const {
  authMiddleware,
  requireRol,
  empresaMiddleware,
} = require("../middleware/auth");
const {
  addWorksheetRows,
  createWorkbook,
  prepareWorksheet,
  readWorkbookFromBuffer,
  readWorksheetRows,
  sendExcelWorkbook,
  sendWorkbook,
} = require("../utils/excel");

const router = express.Router();
router.use(authMiddleware, empresaMiddleware);

const excelStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = process.env.UPLOAD_PATH || "./uploads";
    const excelDir = path.join(dir, "excels");
    fs.mkdirSync(excelDir, { recursive: true });
    cb(null, excelDir);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});

const excelUpload = multer({
  storage: excelStorage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE || "", 10) || 5 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const extension = path.extname(file.originalname || "").toLowerCase();
    if ([".xlsx", ".xlsm"].includes(extension)) {
      cb(null, true);
      return;
    }
    cb(new Error("Solo se permiten archivos Excel .xlsx"));
  },
});

const validate = (req, res, next) => {
  const e = validationResult(req);
  if (!e.isEmpty())
    return res.status(400).json({ ok: false, errores: e.array() });
  next();
};

// Helper: resuelve empresa_id efectiva para queries
// superadmin puede pasar empresa_id en query, si no viene usa null (verá todo)
function resolveEmpresaId(req) {
  if (req.usuario.rol === "superadmin") {
    const eid = req.query.empresa_id || req.body?.empresa_id;
    return eid ? parseInt(eid) : null;
  }
  return req.usuario.empresa_id;
}

function getZonaFromCityName(ciudadNombre) {
  return String(ciudadNombre || "").toUpperCase() === "LIMA"
    ? "LIMA"
    : "PROVINCIA";
}

function getZonaCaseSql(cityAlias = "c") {
  return `CASE WHEN UPPER(${cityAlias}.nombre)='LIMA' THEN 'LIMA' ELSE 'PROVINCIA' END`;
}

function parseBooleanFlag(value) {
  return ["1", "true", "yes", "si"].includes(
    String(value || "")
      .trim()
      .toLowerCase(),
  );
}

function resolveIncludeInactive(req) {
  return parseBooleanFlag(req.query?.incluir_inactivos);
}

function formatEstadoLabel(value) {
  return parseBooleanFlag(value) ? "Activo" : "Inactivo";
}

function formatBooleanLabel(value) {
  return parseBooleanFlag(value) ? "Si" : "No";
}

function parsePositiveInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeOptionalString(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

const PERSONAL_RECEPTOR_DUPLICATE_MESSAGE =
  "Ya existe un personal receptor con ese correo para el mismo almacen y categoria";

async function findPersonalReceptorDuplicate({
  empresaId,
  email,
  almacenId,
  categoriaId,
  excludeId = null,
}) {
  const params = [empresaId, email, almacenId, categoriaId];
  let sql =
    "SELECT id FROM personal_receptor WHERE empresa_id=? AND email=? AND almacen_id=? AND categoria_id=?";

  if (excludeId !== null && excludeId !== undefined) {
    sql += " AND id<>?";
    params.push(excludeId);
  }

  sql += " LIMIT 1";
  const [rows] = await pool.query(sql, params);
  return rows[0] || null;
}

function normalizeSpreadsheetDateInput(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    return `${slashMatch[3]}-${String(slashMatch[2]).padStart(2, "0")}-${String(slashMatch[1]).padStart(2, "0")}`;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseSpreadsheetBoolean(value, defaultValue = false) {
  if (value === null || value === undefined || value === "") {
    return defaultValue;
  }
  return ["1", "true", "yes", "si", "s", "x"].includes(
    String(value).trim().toLowerCase(),
  );
}

function hasSpreadsheetValue(value) {
  return !(
    value === null ||
    value === undefined ||
    String(value).trim() === ""
  );
}

function normalizeLookupText(value) {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function buildDuplicateLookupSet(rows = [], getter) {
  const counts = new Map();
  rows.forEach((row) => {
    const key = normalizeLookupText(getter(row));
    if (!key) return;
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  return new Set(
    [...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key),
  );
}

function normalizeZonaInput(value) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return null;
  const upper = normalized.toUpperCase();
  return ["LIMA", "PROVINCIA"].includes(upper) ? upper : null;
}

function buildTipoReferencia(row, duplicateTypeNames = new Set()) {
  const nombre = normalizeOptionalString(row.nombre) || "";
  if (!duplicateTypeNames.has(normalizeLookupText(nombre))) {
    return nombre;
  }
  return `${nombre} | ${row.categoria_nombre || "SIN CATEGORIA"}`;
}

function buildSkuReferenceLabel(row, duplicateSkuNames = new Set()) {
  const nombre = normalizeOptionalString(row.nombre) || "";
  if (!duplicateSkuNames.has(normalizeLookupText(nombre))) {
    return nombre;
  }
  return `${nombre} | ${row.categoria_nombre || "SIN CATEGORIA"} | ${row.zona || "SIN ZONA"}`;
}

function describeTipoMercaderia(row) {
  return `${row.nombre || ""} / ${row.categoria_nombre || "SIN CATEGORIA"}`;
}

function describeSku(row) {
  const parts = [
    row.nombre || "",
    row.categoria_nombre || "SIN CATEGORIA",
    row.zona || "SIN ZONA",
  ];
  if (row.codigo) {
    parts.push(row.codigo);
  }
  return parts.join(" / ");
}

function buildSkuIdentityKey({
  nombre,
  categoria_id,
  tipo_mercaderia_id,
  zona,
}) {
  return [
    normalizeLookupText(nombre),
    Number(categoria_id || 0),
    Number(tipo_mercaderia_id || 0),
    normalizeLookupText(zona),
  ].join("|");
}

function findSkuIdentityDuplicate(skus, identity, { ignoreId = null } = {}) {
  const key = buildSkuIdentityKey(identity);
  return skus.find((sku) => {
    if (ignoreId && Number(sku.id) === Number(ignoreId)) {
      return false;
    }
    return buildSkuIdentityKey(sku) === key;
  });
}

function resolveSingleSheetMatch(
  rows,
  {
    value,
    rowNumber,
    entityLabel,
    getMatchValues = [],
    describeRow = () => "",
  },
) {
  const lookupValue = normalizeLookupText(value);
  if (!lookupValue) return null;

  const matches = rows.filter((row) =>
    getMatchValues.some(
      (getter) => normalizeLookupText(getter(row)) === lookupValue,
    ),
  );

  if (!matches.length) {
    throw new Error(
      `No se encontro ${entityLabel} "${value}" en la fila ${rowNumber}.`,
    );
  }

  if (matches.length > 1) {
    const activeMatches = matches.filter((row) => Number(row.activo) === 1);
    if (activeMatches.length === 1) {
      return activeMatches[0];
    }

    const examples = matches
      .slice(0, 3)
      .map((row) => describeRow(row))
      .filter(Boolean)
      .join(" | ");
    throw new Error(
      `Hay varios ${entityLabel} llamados "${value}" en la fila ${rowNumber}. ` +
        `Usa el nombre exacto de la hoja de referencia.${examples ? ` Ejemplos: ${examples}` : ""}`,
    );
  }

  return matches[0];
}

function resolveCategoriaFromSheetRow(
  row,
  categorias,
  rowNumber,
  { fallbackCategoryId = null, allowBlank = false } = {},
) {
  const categoriaId = parsePositiveInt(row.categoria_id);
  const categoriaNombre = normalizeOptionalString(
    row.categoria || row.categoria_nombre,
  );

  if (categoriaId) {
    const categoria = categorias.find(
      (item) => Number(item.id) === categoriaId,
    );
    if (!categoria) {
      throw new Error(
        `La categoria indicada en la fila ${rowNumber} no existe.`,
      );
    }
    return categoria;
  }

  if (categoriaNombre) {
    return resolveSingleSheetMatch(categorias, {
      value: categoriaNombre,
      rowNumber,
      entityLabel: "la categoria",
      getMatchValues: [(item) => item.nombre],
      describeRow: (item) => item.nombre || "",
    });
  }

  if (fallbackCategoryId) {
    return (
      categorias.find(
        (item) => Number(item.id) === Number(fallbackCategoryId),
      ) || null
    );
  }

  if (allowBlank) {
    return null;
  }

  throw new Error(`La categoria es obligatoria en la fila ${rowNumber}.`);
}

function resolveTipoFromSheetRow(
  row,
  tiposMercaderia,
  rowNumber,
  {
    categoriaId = null,
    fallbackTypeId = null,
    duplicateTypeNames = new Set(),
  } = {},
) {
  const tipoId = parsePositiveInt(row.tipo_mercaderia_id);
  const tipoNombre = normalizeOptionalString(
    row.tipo_mercaderia || row.tipo || row.tipo_mercaderia_nombre,
  );

  if (tipoId) {
    const tipo = tiposMercaderia.find((item) => Number(item.id) === tipoId);
    if (!tipo) {
      throw new Error(
        `El tipo de mercaderia indicado en la fila ${rowNumber} no existe.`,
      );
    }
    if (categoriaId && Number(tipo.categoria_id) !== Number(categoriaId)) {
      throw new Error(
        `El tipo de mercaderia de la fila ${rowNumber} no pertenece a la categoria indicada.`,
      );
    }
    return tipo;
  }

  if (tipoNombre) {
    const scopedRows = categoriaId
      ? tiposMercaderia.filter(
          (item) => Number(item.categoria_id) === Number(categoriaId),
        )
      : tiposMercaderia;

    return resolveSingleSheetMatch(scopedRows, {
      value: tipoNombre,
      rowNumber,
      entityLabel: "tipos de mercaderia",
      getMatchValues: [
        (item) => item.nombre,
        (item) => buildTipoReferencia(item, duplicateTypeNames),
      ],
      describeRow: describeTipoMercaderia,
    });
  }

  if (fallbackTypeId) {
    return (
      tiposMercaderia.find(
        (item) => Number(item.id) === Number(fallbackTypeId),
      ) || null
    );
  }

  return null;
}

function buildInstructionSheet(workbook, title, rows = []) {
  const worksheet = workbook.addWorksheet(title, {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  const columns = [
    { header: "CAMPO", key: "campo", width: 26 },
    { header: "DETALLE", key: "detalle", width: 96 },
  ];

  prepareWorksheet(worksheet, columns);
  addWorksheetRows(worksheet, columns, rows);
  return worksheet;
}

async function getScopedSku(skuId, empresaId, executor = pool) {
  let query = "SELECT * FROM skus WHERE id=?";
  const params = [skuId];

  if (empresaId) {
    query += " AND empresa_id=?";
    params.push(empresaId);
  }

  const [rows] = await executor.query(query, params);
  return rows[0] || null;
}

async function getScopedLote(loteId, empresaId, executor = pool) {
  let query = `SELECT l.*, s.empresa_id, s.nombre AS sku_nombre
               FROM lotes l
               JOIN skus s ON s.id = l.sku_id
               WHERE l.id=?`;
  const params = [loteId];

  if (empresaId) {
    query += " AND s.empresa_id=?";
    params.push(empresaId);
  }

  const [rows] = await executor.query(query, params);
  return rows[0] || null;
}

async function skuHasMovimientos(skuId, empresaId, executor = pool) {
  const conditions = [];
  const params = [];

  if (empresaId) {
    conditions.push("r.empresa_id=?");
    params.push(empresaId);
  }

  const whereEmpresa = conditions.length
    ? ` AND ${conditions.join(" AND ")}`
    : "";
  const [rows] = await executor.query(
    `SELECT EXISTS(
        SELECT 1
        FROM registro_detalles rd
        JOIN registros r ON r.id = rd.registro_id
        WHERE rd.sku_id=?${whereEmpresa}
      )
      OR EXISTS(
        SELECT 1
        FROM stock_movimientos sm
        WHERE sm.sku_id=?${empresaId ? " AND sm.empresa_id=?" : ""}
      )
      OR EXISTS(
        SELECT 1
        FROM stock_almacen sa
        WHERE sa.sku_id=?${empresaId ? " AND sa.empresa_id=?" : ""}
      )
      OR EXISTS(
        SELECT 1
        FROM registros r
        WHERE r.sku_id=?${whereEmpresa}
      ) AS has_movimientos`,
    empresaId
      ? [skuId, ...params, skuId, empresaId, skuId, empresaId, skuId, ...params]
      : [skuId, skuId, skuId, skuId],
  );

  return !!rows[0]?.has_movimientos;
}

async function loteHasMovimientos(loteId, empresaId, executor = pool) {
  const conditions = [];
  const params = [];

  if (empresaId) {
    conditions.push("r.empresa_id=?");
    params.push(empresaId);
  }

  const whereEmpresa = conditions.length
    ? ` AND ${conditions.join(" AND ")}`
    : "";
  const [rows] = await executor.query(
    `SELECT EXISTS(
        SELECT 1
        FROM registro_detalles rd
        JOIN registros r ON r.id = rd.registro_id
        WHERE rd.lote_id=?${whereEmpresa}
      )
      OR EXISTS(
        SELECT 1
        FROM stock_movimientos sm
        WHERE sm.lote_id=?${empresaId ? " AND sm.empresa_id=?" : ""}
      )
      OR EXISTS(
        SELECT 1
        FROM stock_almacen sa
        WHERE sa.lote_id=?${empresaId ? " AND sa.empresa_id=?" : ""}
      )
      OR EXISTS(
        SELECT 1
        FROM registros r
        WHERE r.lote_id=?${whereEmpresa}
      ) AS has_movimientos`,
    empresaId
      ? [
          loteId,
          ...params,
          loteId,
          empresaId,
          loteId,
          empresaId,
          loteId,
          ...params,
        ]
      : [loteId, loteId, loteId, loteId],
  );

  return !!rows[0]?.has_movimientos;
}

async function fetchCategorias(
  req,
  { includeInactive = false } = {},
  executor = pool,
) {
  const eid = resolveEmpresaId(req);
  let q = "SELECT * FROM categorias WHERE 1=1";
  const p = [];
  if (!includeInactive) q += " AND activo=1";
  if (eid) {
    q += " AND empresa_id=?";
    p.push(eid);
  }
  q += " ORDER BY nombre";
  const [rows] = await executor.query(q, p);
  return rows;
}

async function fetchTiposMercaderia(
  req,
  { includeInactive = false } = {},
  executor = pool,
) {
  const eid = resolveEmpresaId(req);
  const catId = req.query.categoria_id;
  let q = `SELECT tm.*, c.nombre AS categoria_nombre
           FROM tipos_mercaderia tm
           JOIN categorias c ON c.id = tm.categoria_id
           WHERE 1=1`;
  const p = [];
  if (!includeInactive) q += " AND tm.activo=1";
  if (eid) {
    q += " AND c.empresa_id=?";
    p.push(eid);
  }
  if (catId) {
    q += " AND tm.categoria_id=?";
    p.push(catId);
  }
  q += " ORDER BY c.nombre, tm.nombre";
  const [rows] = await executor.query(q, p);
  return rows;
}

async function fetchAlmacenes(
  req,
  { includeInactive = false } = {},
  executor = pool,
) {
  const eid = resolveEmpresaId(req);
  const { ciudad_id, zona } = req.query;
  let q = `SELECT a.*, c.nombre AS ciudad_nombre, r.nombre AS region_nombre, r.empresa_id
           , ${getZonaCaseSql("c")} AS zona
           FROM almacenes a
           JOIN ciudades c ON c.id = a.ciudad_id
           JOIN regiones r ON r.id = c.region_id
           WHERE 1=1`;
  const p = [];
  if (!includeInactive) q += " AND a.activo=1";
  if (eid) {
    q += " AND r.empresa_id=?";
    p.push(eid);
  }
  if (ciudad_id) {
    q += " AND a.ciudad_id=?";
    p.push(ciudad_id);
  }
  if (zona) {
    q += ` AND ${getZonaCaseSql("c")}=?`;
    p.push(zona);
  }
  q += " ORDER BY r.nombre, c.nombre, a.nombre";
  const [rows] = await executor.query(q, p);
  return rows;
}

async function fetchIndicadores(
  req,
  { includeInactive = false } = {},
  executor = pool,
) {
  const eid = resolveEmpresaId(req);
  let q = "SELECT * FROM indicadores WHERE 1=1";
  const p = [];
  if (!includeInactive) q += " AND activo=1";
  if (eid) {
    q += " AND empresa_id=?";
    p.push(eid);
  }
  q += " ORDER BY nombre";
  const [rows] = await executor.query(q, p);
  return rows;
}

async function fetchPersonalReceptor(
  req,
  { includeInactive = false } = {},
  executor = pool,
) {
  const eid = resolveEmpresaId(req);
  const {
    almacen_id,
    almacen_origen_id,
    almacen_destino_id,
    categoria_id,
    ciudad_id,
  } = req.query;
  const targetWarehouseIds = [
    ...new Set(
      [almacen_id, almacen_origen_id, almacen_destino_id]
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => Number.isInteger(value) && value > 0),
    ),
  ];

  let q = `SELECT pr.*,
              a.nombre AS almacen_nombre,
              a.ciudad_id,
              COALESCE(ci.nombre, '') AS ciudad_nombre,
              ca.nombre AS categoria_nombre,
              CASE WHEN UPPER(COALESCE(ci.nombre,''))='LIMA' THEN 'LIMA' ELSE 'PROVINCIA' END AS zona
           FROM personal_receptor pr
           LEFT JOIN almacenes a ON a.id = pr.almacen_id
           LEFT JOIN ciudades ci ON ci.id = a.ciudad_id
           LEFT JOIN categorias ca ON ca.id = pr.categoria_id
           WHERE 1=1`;
  const p = [];

  if (!includeInactive) q += " AND pr.activo=1";
  if (eid) {
    q += " AND pr.empresa_id=?";
    p.push(eid);
  }
  if (targetWarehouseIds.length === 1) {
    q += " AND pr.almacen_id=?";
    p.push(targetWarehouseIds[0]);
  } else if (targetWarehouseIds.length > 1) {
    q += ` AND pr.almacen_id IN (${targetWarehouseIds.map(() => "?").join(",")})`;
    p.push(...targetWarehouseIds);
  }
  if (categoria_id) {
    q += " AND pr.categoria_id=?";
    p.push(categoria_id);
  }
  if (ciudad_id) {
    q += " AND a.ciudad_id=?";
    p.push(ciudad_id);
  }
  q += " ORDER BY pr.nombre";

  const [rows] = await executor.query(q, p);
  return rows;
}

async function fetchSkus(
  req,
  { includeInactive = false } = {},
  executor = pool,
) {
  const eid = resolveEmpresaId(req);
  const { categoria_id, tipo_mercaderia_id, zona } = req.query;
  let q = `SELECT s.*, c.nombre AS categoria_nombre, tm.nombre AS tipo_mercaderia_nombre,
                  COALESCE(lc.lotes_count, 0) AS lotes_count
           FROM skus s
           JOIN categorias c ON c.id = s.categoria_id
           LEFT JOIN tipos_mercaderia tm ON tm.id = s.tipo_mercaderia_id
           LEFT JOIN (
             SELECT sku_id, COUNT(*) AS lotes_count
             FROM lotes
             WHERE activo=1
             GROUP BY sku_id
           ) lc ON lc.sku_id = s.id
           WHERE 1=1`;
  const p = [];
  if (!includeInactive) q += " AND s.activo=1";
  if (eid) {
    q += " AND s.empresa_id=?";
    p.push(eid);
  }
  if (categoria_id) {
    q += " AND s.categoria_id=?";
    p.push(categoria_id);
  }
  if (tipo_mercaderia_id) {
    q += " AND s.tipo_mercaderia_id=?";
    p.push(tipo_mercaderia_id);
  }
  if (zona) {
    q += " AND s.zona=?";
    p.push(zona);
  }
  q += " ORDER BY c.nombre, s.nombre";
  const [rows] = await executor.query(q, p);
  return rows;
}

async function fetchLotes(
  req,
  { includeInactive = false } = {},
  executor = pool,
) {
  const empresaId = resolveEmpresaId(req);
  const { sku_id, almacen_id, solo_con_stock } = req.query;
  if (!sku_id) {
    const error = new Error("sku_id requerido");
    error.statusCode = 400;
    throw error;
  }

  const sku = await getScopedSku(sku_id, empresaId, executor);
  if (!sku) {
    const error = new Error("SKU no encontrado");
    error.statusCode = 404;
    throw error;
  }

  const almacenId = almacen_id ? Number.parseInt(almacen_id, 10) : null;
  const includeLoteId = req.query.include_lote_id ? Number.parseInt(req.query.include_lote_id, 10) : null;
  const registroId = req.query.registro_id ? Number.parseInt(req.query.registro_id, 10) : null;
  const filterByWarehouseStock = !!almacenId || String(solo_con_stock || "") === "1";
  if (filterByWarehouseStock && !almacenId) {
    const error = new Error("almacen_id requerido para filtrar lotes por stock");
    error.statusCode = 400;
    throw error;
  }

  if (filterByWarehouseStock) {
    const stockSources = [];
    const stockParams = [];

    let auditStockQuery = `SELECT
        CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(a.detalle, '$.lote_id')), '') AS UNSIGNED) AS lote_id,
        SUM(CAST(COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(a.detalle, '$.cantidad')), ''), '0') AS DECIMAL(18,4))) AS cantidad
      FROM audit_log a
      WHERE a.accion='STOCK_INITIAL'
        AND a.tabla='stock_almacen'
        AND CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(a.detalle, '$.almacen_id')), '') AS UNSIGNED)=?
        AND CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(a.detalle, '$.sku_id')), '') AS UNSIGNED)=?`;
    stockParams.push(almacenId, sku_id);
    if (empresaId) {
      auditStockQuery += " AND a.empresa_id=?";
      stockParams.push(empresaId);
    }
    auditStockQuery += " GROUP BY lote_id";
    stockSources.push(auditStockQuery);

    let movementStockQuery = `SELECT
        sm.lote_id,
        SUM(
          CASE
            WHEN sm.almacen_origen_id IS NOT NULL
              AND sm.almacen_destino_id IS NOT NULL
              AND sm.almacen_origen_id=sm.almacen_destino_id THEN
              CASE
                WHEN sm.tipo_movimiento='TG_INTERNO_ENTRADA' THEN sm.cantidad
                WHEN sm.tipo_movimiento='TG_INTERNO_SALIDA' THEN -sm.cantidad
                WHEN COALESCE(r.tipo_accion, '')='ENTRADA'
                  AND sm.tipo_movimiento IN ('INGRESO_APROBADO', 'APROBACION') THEN sm.cantidad
                WHEN COALESCE(r.tipo_accion, '')<>'ENTRADA'
                  AND sm.tipo_movimiento IN ('SALIDA_TRANSITO', 'APROBACION') THEN -sm.cantidad
                ELSE 0
              END
            ELSE
              (CASE
                WHEN sm.almacen_origen_id=?
                  AND sm.tipo_movimiento IN ('APROBACION', 'SALIDA_TRANSITO', 'TG_INTERNO_SALIDA') THEN -sm.cantidad
                WHEN sm.almacen_origen_id=?
                  AND sm.tipo_movimiento='REVERSA_RECHAZO' THEN sm.cantidad
                ELSE 0
              END)
              +
              (CASE
                WHEN sm.almacen_destino_id=?
                  AND sm.tipo_movimiento IN ('APROBACION', 'INGRESO_APROBADO', 'TG_INTERNO_ENTRADA') THEN sm.cantidad
                ELSE 0
              END)
          END
        ) AS cantidad
      FROM stock_movimientos sm
      LEFT JOIN registros r ON r.id = sm.registro_id
      WHERE sm.sku_id=?
        AND (sm.almacen_origen_id=? OR sm.almacen_destino_id=?)
        AND (r.id IS NULL OR r.eliminado_at IS NULL)`;
    stockParams.push(almacenId, almacenId, almacenId, sku_id, almacenId, almacenId);
    if (empresaId) {
      movementStockQuery += " AND sm.empresa_id=?";
      stockParams.push(empresaId);
    }
    movementStockQuery += " GROUP BY sm.lote_id";
    stockSources.push(movementStockQuery);

    if (registroId && Number.isFinite(registroId)) {
      stockSources.push(`SELECT
          rd.lote_id,
          SUM(rd.cantidad) AS cantidad
        FROM registro_detalles rd
        JOIN registros r ON r.id = rd.registro_id
        WHERE r.id=?
          AND r.tipo_accion='SALIDA'
          AND r.almacen_origen_id=?
          AND rd.sku_id=?
          AND r.eliminado_at IS NULL
        GROUP BY rd.lote_id`);
      stockParams.push(registroId, almacenId, sku_id);
    }

    let query = `SELECT l.id, l.sku_id, l.codigo_lote,
                        DATE_FORMAT(l.fecha_vencimiento, '%Y-%m-%d') AS fecha_vencimiento,
                        l.activo, l.created_at,
                        s.nombre AS sku_nombre,
                        GREATEST(COALESCE(stock.stock_disponible, 0), 0) AS stock_disponible
                 FROM lotes l
                 JOIN skus s ON s.id = l.sku_id
                 LEFT JOIN (
                   SELECT lote_id, SUM(cantidad) AS stock_disponible
                   FROM (${stockSources.join(" UNION ALL ")}) stock_base
                   GROUP BY lote_id
                 ) stock ON (stock.lote_id <=> l.id)
                 WHERE l.sku_id=?`;
    const params = [...stockParams, sku_id];

    if (!includeInactive) {
      if (includeLoteId && Number.isFinite(includeLoteId)) {
        query += " AND (l.activo=1 OR l.id=?)";
        params.push(includeLoteId);
      } else {
        query += " AND l.activo=1";
      }
    }

    if (includeLoteId && Number.isFinite(includeLoteId)) {
      query += " HAVING stock_disponible > 0 OR id=?";
      params.push(includeLoteId);
    } else {
      query += " HAVING stock_disponible > 0";
    }

    query += " ORDER BY l.fecha_vencimiento IS NULL, l.fecha_vencimiento, l.codigo_lote";
    const [rows] = await executor.query(query, params);
    return rows;
  }

  const stockJoin = filterByWarehouseStock
    ? `${includeLoteId ? "LEFT JOIN" : "JOIN"} stock_almacen sa ON sa.lote_id = l.id AND sa.sku_id = l.sku_id AND sa.almacen_id = ?${empresaId ? " AND sa.empresa_id=?" : ""}`
    : "";

  const previousRegistroJoin =
    filterByWarehouseStock && registroId && Number.isFinite(registroId)
      ? `LEFT JOIN (
                 SELECT
                   r.empresa_id,
                   r.almacen_origen_id AS almacen_id,
                   rd.sku_id,
                   rd.lote_id,
                   SUM(rd.cantidad) AS cantidad
                 FROM registro_detalles rd
                 JOIN registros r ON r.id = rd.registro_id
                 WHERE r.id=?
                   AND r.tipo_accion='SALIDA'
                   AND r.eliminado_at IS NULL
                 GROUP BY r.empresa_id, r.almacen_origen_id, rd.sku_id, rd.lote_id
               ) prev_registro ON prev_registro.empresa_id = s.empresa_id
                 AND prev_registro.almacen_id = ?
                 AND prev_registro.sku_id = l.sku_id
                 AND (prev_registro.lote_id <=> l.id)`
      : "";
  const previousStockExpression = previousRegistroJoin
    ? " + COALESCE(prev_registro.cantidad, 0)"
    : "";
  const previousStockFilter = previousRegistroJoin
    ? " OR COALESCE(prev_registro.cantidad, 0) > 0"
    : "";

  let query = `SELECT l.id, l.sku_id, l.codigo_lote,
                      DATE_FORMAT(l.fecha_vencimiento, '%Y-%m-%d') AS fecha_vencimiento,
                      l.activo, l.created_at,
                      s.nombre AS sku_nombre
                      ${filterByWarehouseStock ? `, GREATEST(COALESCE(sa.cantidad, 0) - COALESCE(dup.cantidad, 0)${previousStockExpression}, 0) AS stock_disponible` : ""}
               FROM lotes l
               JOIN skus s ON s.id = l.sku_id
               ${stockJoin}
               ${filterByWarehouseStock ? `LEFT JOIN (
                 SELECT
                   sm.empresa_id,
                   sm.almacen_destino_id AS almacen_id,
                   sm.sku_id,
                   sm.lote_id,
                   SUM(sm.cantidad) AS cantidad
                 FROM stock_movimientos sm
                 JOIN registros r ON r.id = sm.registro_id
                 WHERE sm.tipo_movimiento='INGRESO_APROBADO'
                   AND r.tipo_accion='SALIDA'
                   AND sm.almacen_origen_id=sm.almacen_destino_id
                   AND r.eliminado_at IS NULL
                 GROUP BY sm.empresa_id, sm.almacen_destino_id, sm.sku_id, sm.lote_id
               ) dup ON dup.empresa_id = sa.empresa_id
                 AND dup.almacen_id = sa.almacen_id
                 AND dup.sku_id = sa.sku_id
                 AND (dup.lote_id <=> sa.lote_id)` : ""}
               ${previousRegistroJoin}
               WHERE l.sku_id=?`;
  const params = filterByWarehouseStock
    ? [
        almacenId,
        ...(empresaId ? [empresaId] : []),
        ...(previousRegistroJoin ? [registroId, almacenId] : []),
        sku_id,
      ]
    : [sku_id];

  if (!includeInactive) {
    if (includeLoteId && Number.isFinite(includeLoteId)) {
      query += " AND (l.activo=1 OR l.id=?)";
      params.push(includeLoteId);
    } else {
      query += " AND l.activo=1";
    }
  }
  if (filterByWarehouseStock) {
    if (includeLoteId && Number.isFinite(includeLoteId)) {
      query += ` AND (COALESCE(sa.cantidad, 0) > 0${previousStockFilter} OR l.id=?)`;
      params.push(includeLoteId);
    } else {
      query += ` AND (COALESCE(sa.cantidad, 0) > 0${previousStockFilter})`;
    }
  }

  if (filterByWarehouseStock) {
    if (includeLoteId && Number.isFinite(includeLoteId)) {
      query += " HAVING stock_disponible > 0 OR id=?";
      params.push(includeLoteId);
    } else {
      query += " HAVING stock_disponible > 0";
    }
  }

  query += " ORDER BY l.fecha_vencimiento IS NULL, l.fecha_vencimiento, l.codigo_lote";

  const [rows] = await executor.query(query, params);
  return rows;
}

async function buildSkusImportTemplateWorkbook(req) {
  const workbook = createWorkbook();
  const skusSheet = workbook.addWorksheet("Carga_SKUs", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  const skusTemplateColumns = [
    { header: "OPERACION", key: "operacion", width: 16 },
    { header: "NOMBRE_REFERENCIA", key: "nombre_referencia", width: 38 },
    { header: "NOMBRE", key: "nombre", width: 32 },
    { header: "CODIGO", key: "codigo", width: 18 },
    { header: "CATEGORIA", key: "categoria", width: 24 },
    { header: "TIPO_MERCADERIA", key: "tipo_mercaderia", width: 26 },
    { header: "ZONA", key: "zona", width: 14 },
    { header: "UNIDAD", key: "unidad", width: 16 },
    { header: "TIENE_LOTE", key: "tiene_lote", width: 14 },
    { header: "TIENE_VENCIMIENTO", key: "tiene_vencimiento", width: 18 },
    { header: "ACTIVO", key: "activo", width: 12 },
  ];
  prepareWorksheet(skusSheet, skusTemplateColumns);

  const lotesSheet = workbook.addWorksheet("Carga_Lotes", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  const lotesTemplateColumns = [
    { header: "SKU_REFERENCIA", key: "sku_referencia", width: 42 },
    { header: "CODIGO_LOTE", key: "codigo_lote", width: 20 },
    { header: "FECHA_VENCIMIENTO", key: "fecha_vencimiento", width: 20 },
  ];
  prepareWorksheet(lotesSheet, lotesTemplateColumns);

  const tiposMercaderia = await fetchTiposMercaderia(req, {
    includeInactive: true,
  });
  const skus = await fetchSkus(req, { includeInactive: true });
  const duplicateTypeNames = buildDuplicateLookupSet(
    tiposMercaderia,
    (row) => row.nombre,
  );
  const duplicateSkuNames = buildDuplicateLookupSet(skus, (row) => row.nombre);

  const referenciaSheet = workbook.addWorksheet("SKUs_Actuales (referencia)", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  const referenciaColumns = [
    { header: "NOMBRE_REFERENCIA", key: "nombre_referencia", width: 40 },
    { header: "NOMBRE", key: "nombre", width: 30 },
    { header: "CODIGO", key: "codigo", width: 18 },
    { header: "CATEGORIA", key: "categoria_nombre", width: 24 },
    { header: "TIPO_MERCADERIA", key: "tipo_mercaderia_nombre", width: 28 },
    { header: "ZONA", key: "zona", width: 14 },
    { header: "TIENE_LOTE", key: "tiene_lote", width: 14 },
    { header: "TIENE_VENCIMIENTO", key: "tiene_vencimiento", width: 18 },
    { header: "ACTIVO", key: "activo", width: 12 },
  ];
  prepareWorksheet(referenciaSheet, referenciaColumns);
  addWorksheetRows(
    referenciaSheet,
    referenciaColumns,
    skus.map((row) => ({
      nombre_referencia: buildSkuReferenceLabel(row, duplicateSkuNames),
      nombre: row.nombre || "",
      codigo: row.codigo || "",
      categoria_nombre: row.categoria_nombre || "",
      tipo_mercaderia_nombre: row.tipo_mercaderia_nombre
        ? buildTipoReferencia(
            {
              nombre: row.tipo_mercaderia_nombre,
              categoria_nombre: row.categoria_nombre,
            },
            duplicateTypeNames,
          )
        : "",
      zona: row.zona || "",
      tiene_lote: formatBooleanLabel(row.tiene_lote),
      tiene_vencimiento: formatBooleanLabel(row.tiene_vencimiento),
      activo: formatEstadoLabel(row.activo),
    })),
  );

  return workbook;
}

async function importLotesSheetFromWorkbook(
  connection,
  req,
  workbook,
  { skus = null, strict = true } = {},
) {
  const worksheet = workbook.getWorksheet("Carga_Lotes");
  if (!worksheet) {
    return {
      filas_procesadas: 0,
      creados: 0,
      actualizados: 0,
      reactivados: 0,
    };
  }

  const rows = readWorksheetRows(worksheet);
  if (!rows.length) {
    return {
      filas_procesadas: 0,
      creados: 0,
      actualizados: 0,
      reactivados: 0,
    };
  }

  const sourceSkus =
    skus || (await fetchSkus(req, { includeInactive: true }, connection));
  const duplicateSkuNames = buildDuplicateLookupSet(
    sourceSkus,
    (row) => row.nombre,
  );

  let creados = 0;
  let actualizados = 0;
  let reactivados = 0;

  for (const row of rows) {
    const rowNumber = Number(row.__rowNum || 0);
    const skuRef = normalizeOptionalString(
      row.sku_referencia ||
        row.sku ||
        row.nombre_sku ||
        row.nombre_referencia,
    );
    const codigoLote = normalizeOptionalString(
      row.codigo_lote || row.lote || row.codigo,
    );
    const fechaVencimiento = normalizeSpreadsheetDateInput(
      row.fecha_vencimiento || row.vencimiento || row.fecha_venc,
    );

    if (!skuRef) {
      throw new Error(`Fila ${rowNumber}: SKU_REFERENCIA vacio.`);
    }
    if (!codigoLote) {
      throw new Error(`Fila ${rowNumber}: CODIGO_LOTE vacio.`);
    }

    const sku = resolveSingleSheetMatch(sourceSkus, {
      value: skuRef,
      rowNumber,
      entityLabel: "SKUs",
      getMatchValues: [
        (item) => item.nombre,
        (item) => buildSkuReferenceLabel(item, duplicateSkuNames),
      ],
      describeRow: describeSku,
    });

    if (!sku || !parseBooleanFlag(sku.activo)) {
      throw new Error(`Fila ${rowNumber}: SKU no disponible para cargar lotes.`);
    }
    if (!parseBooleanFlag(sku.tiene_lote)) {
      throw new Error(`Fila ${rowNumber}: El SKU "${sku.nombre}" no maneja lotes.`);
    }

    const [existingRows] = await connection.query(
      `SELECT id, codigo_lote, fecha_vencimiento, activo
       FROM lotes
       WHERE sku_id=? AND UPPER(codigo_lote)=UPPER(?)
       LIMIT 1`,
      [sku.id, codigoLote],
    );
    const existing = existingRows[0] || null;
    const existingFecha = normalizeSpreadsheetDateInput(
      existing?.fecha_vencimiento,
    );
    const finalFecha = fechaVencimiento || existingFecha || null;

    if (parseBooleanFlag(sku.tiene_vencimiento) && !finalFecha) {
      throw new Error(
        `Fila ${rowNumber}: FECHA_VENCIMIENTO es obligatoria para el SKU "${sku.nombre}".`,
      );
    }

    if (!existing) {
      await connection.query(
        `INSERT INTO lotes (sku_id, codigo_lote, fecha_vencimiento, activo)
         VALUES (?,?,?,1)`,
        [sku.id, codigoLote, finalFecha],
      );
      creados += 1;
      continue;
    }

    if (parseBooleanFlag(existing.activo)) {
      await connection.query(
        `UPDATE lotes
         SET fecha_vencimiento=?
         WHERE id=?`,
        [finalFecha, existing.id],
      );
      actualizados += 1;
      continue;
    }

    await connection.query(
      `UPDATE lotes
       SET activo=1,
           fecha_vencimiento=?
       WHERE id=?`,
      [finalFecha, existing.id],
    );
    reactivados += 1;
  }

  return {
    filas_procesadas: rows.length,
    creados,
    actualizados,
    reactivados,
  };
}

async function importSkusFromWorkbook(connection, req, workbook) {
  const empresaId = resolveEmpresaId(req) || req.empresa_id;
  if (!empresaId) {
    throw new Error(
      "Debe seleccionar una empresa para la carga masiva de SKUs",
    );
  }

  const worksheet =
    workbook.getWorksheet("Carga_SKUs") || workbook.worksheets[0];
  if (!worksheet) {
    throw new Error("El archivo no contiene hojas de trabajo");
  }

  const rows = readWorksheetRows(worksheet);

  const categorias = await fetchCategorias(
    req,
    { includeInactive: true },
    connection,
  );
  const tiposMercaderia = await fetchTiposMercaderia(
    req,
    { includeInactive: true },
    connection,
  );
  const skus = await fetchSkus(req, { includeInactive: true }, connection);
  const categoriaMap = new Map(categorias.map((row) => [Number(row.id), row]));
  const tipoMap = new Map(tiposMercaderia.map((row) => [Number(row.id), row]));
  const duplicateTypeNames = buildDuplicateLookupSet(
    tiposMercaderia,
    (row) => row.nombre,
  );
  const duplicateSkuNames = buildDuplicateLookupSet(skus, (row) => row.nombre);

  let creados = 0;
  let actualizados = 0;

  for (const row of rows) {
    const rowNumber = Number(row.__rowNum || 0);
    const skuId = parsePositiveInt(row.id || row.sku_id);
    const nombreReferencia = normalizeOptionalString(
      row.nombre_referencia ||
        row.sku_actual ||
        row.nombre_actual ||
        row.sku_referencia,
    );
    const operacionBase = String(row.operacion || row.accion || "")
      .trim()
      .toUpperCase();
    const operacion =
      operacionBase || (skuId || nombreReferencia ? "ACTUALIZAR" : "CREAR");

    if (!["CREAR", "ACTUALIZAR"].includes(operacion)) {
      throw new Error(
        `Operacion invalida en la fila ${rowNumber}. Usa CREAR o ACTUALIZAR.`,
      );
    }
    if (operacion === "ACTUALIZAR" && !skuId && !nombreReferencia) {
      throw new Error(
        `Para ACTUALIZAR debes indicar NOMBRE_REFERENCIA en la fila ${rowNumber}.`,
      );
    }
    if (operacion === "CREAR" && (skuId || nombreReferencia)) {
      throw new Error(
        `La fila ${rowNumber} tiene datos de referencia, pero la operacion es CREAR. Borralos o cambia la operacion.`,
      );
    }

    const nombre = normalizeOptionalString(
      row.nombre || row.sku || row.nombre_nuevo,
    );
    const codigo = normalizeOptionalString(row.codigo);
    const unidad = normalizeOptionalString(row.unidad);
    const zonaInput = normalizeZonaInput(row.zona);
    const hasCategoryInput =
      hasSpreadsheetValue(row.categoria_id) ||
      hasSpreadsheetValue(row.categoria || row.categoria_nombre);
    const hasTypeInput =
      hasSpreadsheetValue(row.tipo_mercaderia_id) ||
      hasSpreadsheetValue(
        row.tipo_mercaderia || row.tipo || row.tipo_mercaderia_nombre,
      );

    let existingSku = null;
    if (operacion === "ACTUALIZAR") {
      if (skuId) {
        existingSku = await getScopedSku(skuId, empresaId, connection);
      } else {
        existingSku = resolveSingleSheetMatch(skus, {
          value: nombreReferencia,
          rowNumber,
          entityLabel: "SKUs",
          getMatchValues: [
            (item) => item.nombre,
            (item) => buildSkuReferenceLabel(item, duplicateSkuNames),
          ],
          describeRow: describeSku,
        });
      }
      if (!existingSku) {
        throw new Error(
          `No se encontro el SKU indicado en la fila ${rowNumber}.`,
        );
      }
    }

    const categoria = hasCategoryInput
      ? resolveCategoriaFromSheetRow(row, categorias, rowNumber)
      : existingSku
        ? categoriaMap.get(Number(existingSku.categoria_id)) || null
        : null;

    let tipo = null;
    if (hasTypeInput) {
      tipo = resolveTipoFromSheetRow(row, tiposMercaderia, rowNumber, {
        categoriaId: categoria ? Number(categoria.id) : null,
        duplicateTypeNames,
      });
    }

    const categoriaFinal =
      categoria ||
      (tipo ? categoriaMap.get(Number(tipo.categoria_id)) || null : null);
    if (!categoriaFinal) {
      throw new Error(`La categoria es obligatoria en la fila ${rowNumber}.`);
    }

    if (
      !tipo &&
      existingSku &&
      Number(existingSku.categoria_id) === Number(categoriaFinal.id) &&
      existingSku.tipo_mercaderia_id
    ) {
      tipo = tipoMap.get(Number(existingSku.tipo_mercaderia_id)) || null;
    }

    const zona =
      zonaInput || (existingSku ? normalizeZonaInput(existingSku.zona) : null);
    if (!zona) {
      throw new Error(
        `La zona es obligatoria en la fila ${rowNumber}. Usa LIMA o PROVINCIA.`,
      );
    }

    const nombreFinal =
      nombre ||
      (existingSku ? normalizeOptionalString(existingSku.nombre) : null);
    if (!nombreFinal) {
      throw new Error(`El nombre es obligatorio en la fila ${rowNumber}.`);
    }

    const codigoFinal =
      codigo !== null
        ? codigo
        : existingSku
          ? normalizeOptionalString(existingSku.codigo)
          : null;
    const unidadFinal =
      unidad !== null
        ? unidad
        : existingSku
          ? normalizeOptionalString(existingSku.unidad)
          : null;

    const tieneLote = parseSpreadsheetBoolean(
      row.tiene_lote,
      existingSku ? parseBooleanFlag(existingSku.tiene_lote) : false,
    );
    // Si tiene_lote=true, tiene_vencimiento DEBE ser true
    const tieneVencimientoRaw = parseSpreadsheetBoolean(
      row.tiene_vencimiento,
      existingSku ? parseBooleanFlag(existingSku.tiene_vencimiento) : false,
    );
    const tieneVencimiento = tieneLote ? true : tieneVencimientoRaw;
    if (
      tieneLote &&
      !tieneVencimientoRaw &&
      hasSpreadsheetValue(row.tiene_vencimiento)
    ) {
      throw new Error(
        `Fila ${rowNumber}: Si TIENE_LOTE=Si, TIENE_VENCIMIENTO debe ser Si.`,
      );
    }
    const activo = parseSpreadsheetBoolean(
      row.activo,
      existingSku ? parseBooleanFlag(existingSku.activo) : true,
    );

    const duplicateSku = findSkuIdentityDuplicate(
      skus,
      {
        nombre: nombreFinal,
        categoria_id: Number(categoriaFinal.id),
        tipo_mercaderia_id: tipo ? Number(tipo.id) : null,
        zona,
      },
      { ignoreId: existingSku?.id || null },
    );
    if (duplicateSku) {
      const duplicateLabel = describeSku(duplicateSku);
      throw new Error(
        `Fila ${rowNumber}: ya existe un SKU con el mismo nombre, categoria, tipo de mercaderia y zona. ` +
          `No se puede crear duplicado aunque el codigo sea diferente o este vacio. ` +
          `Usa ACTUALIZAR con NOMBRE_REFERENCIA si quieres modificarlo. SKU existente: ${duplicateLabel}.`,
      );
    }

    if (operacion === "CREAR") {
      const [result] = await connection.query(
        `INSERT INTO skus
         (empresa_id, categoria_id, tipo_mercaderia_id, zona, codigo, nombre, unidad, tiene_lote, tiene_vencimiento)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          empresaId,
          Number(categoriaFinal.id),
          tipo ? Number(tipo.id) : null,
          zona,
          codigoFinal || null,
          nombreFinal,
          unidadFinal || null,
          tieneLote ? 1 : 0,
          tieneVencimiento ? 1 : 0,
        ],
      );
      skus.push({
        id: result.insertId,
        empresa_id: empresaId,
        categoria_id: Number(categoriaFinal.id),
        categoria_nombre: categoriaFinal.nombre || "",
        tipo_mercaderia_id: tipo ? Number(tipo.id) : null,
        tipo_mercaderia_nombre: tipo?.nombre || "",
        zona,
        codigo: codigoFinal || null,
        nombre: nombreFinal,
        unidad: unidadFinal || null,
        tiene_lote: tieneLote ? 1 : 0,
        tiene_vencimiento: tieneVencimiento ? 1 : 0,
        activo: activo ? 1 : 0,
      });
      creados += 1;
      continue;
    }

    await connection.query(
      `UPDATE skus
       SET nombre=?,
           categoria_id=?,
           tipo_mercaderia_id=?,
           zona=?,
           codigo=?,
           unidad=?,
           tiene_lote=?,
           tiene_vencimiento=?,
           activo=?
       WHERE id=?`,
      [
        nombreFinal,
        Number(categoriaFinal.id),
        tipo ? Number(tipo.id) : null,
        zona,
        codigoFinal || null,
        unidadFinal || null,
        tieneLote ? 1 : 0,
        tieneVencimiento ? 1 : 0,
        activo ? 1 : 0,
        existingSku.id,
      ],
    );
    Object.assign(existingSku, {
      nombre: nombreFinal,
      categoria_id: Number(categoriaFinal.id),
      categoria_nombre: categoriaFinal.nombre || "",
      tipo_mercaderia_id: tipo ? Number(tipo.id) : null,
      tipo_mercaderia_nombre: tipo?.nombre || "",
      zona,
      codigo: codigoFinal || null,
      unidad: unidadFinal || null,
      tiene_lote: tieneLote ? 1 : 0,
      tiene_vencimiento: tieneVencimiento ? 1 : 0,
      activo: activo ? 1 : 0,
    });
    actualizados += 1;
  }

  const lotesResumen = await importLotesSheetFromWorkbook(connection, req, workbook, {
    skus,
  });

  if (!rows.length && !lotesResumen.filas_procesadas) {
    throw new Error("La plantilla no contiene filas para procesar");
  }

  return {
    filas_procesadas: rows.length + lotesResumen.filas_procesadas,
    skus_procesados: rows.length,
    creados,
    actualizados,
    lotes_procesados: lotesResumen.filas_procesadas,
    lotes_creados: lotesResumen.creados,
    lotes_actualizados: lotesResumen.actualizados,
    lotes_reactivados: lotesResumen.reactivados,
  };
}

// ── REGIONES ──────────────────────────────────────────────────────────────────
router.get("/regiones", async (req, res) => {
  try {
    const eid = resolveEmpresaId(req);
    let q = "SELECT * FROM regiones WHERE activo=1";
    const p = [];
    if (eid) {
      q += " AND empresa_id=?";
      p.push(eid);
    }
    q += " ORDER BY nombre";
    const [rows] = await pool.query(q, p);
    res.json({ ok: true, datos: rows });
  } catch {
    res.status(500).json({ ok: false, mensaje: "Error interno" });
  }
});
router.post(
  "/regiones",
  requireRol("superadmin", "admin"),
  [body("nombre").trim().notEmpty()],
  validate,
  async (req, res) => {
    const eid = resolveEmpresaId(req) || req.empresa_id;
    const [r] = await pool.query(
      "INSERT INTO regiones (empresa_id, nombre) VALUES (?,?)",
      [eid, req.body.nombre],
    );
    res.status(201).json({ ok: true, id: r.insertId });
  },
);
router.put(
  "/regiones/:id",
  requireRol("superadmin", "admin"),
  [param("id").isInt()],
  validate,
  async (req, res) => {
    await pool.query("UPDATE regiones SET nombre=?, activo=? WHERE id=?", [
      req.body.nombre,
      req.body.activo ?? 1,
      req.params.id,
    ]);
    res.json({ ok: true });
  },
);
router.delete(
  "/regiones/:id",
  requireRol("superadmin", "admin"),
  async (req, res) => {
    await pool.query("UPDATE regiones SET activo=0 WHERE id=?", [
      req.params.id,
    ]);
    res.json({ ok: true });
  },
);

// ── CIUDADES ──────────────────────────────────────────────────────────────────
router.get("/ciudades", async (req, res) => {
  try {
    const eid = resolveEmpresaId(req);
    const { zona } = req.query;
    let q = `SELECT c.*, r.nombre AS region_nombre, r.empresa_id
             , ${getZonaCaseSql("c")} AS zona
             FROM ciudades c JOIN regiones r ON r.id = c.region_id
             WHERE c.activo=1`;
    const p = [];
    if (eid) {
      q += " AND r.empresa_id=?";
      p.push(eid);
    }
    if (zona) {
      q += ` AND ${getZonaCaseSql("c")}=?`;
      p.push(zona);
    }
    q += " ORDER BY r.nombre, c.nombre";
    const [rows] = await pool.query(q, p);
    res.json({ ok: true, datos: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, mensaje: "Error interno" });
  }
});
router.get("/ciudades/por-region/:region_id", async (req, res) => {
  const [rows] = await pool.query(
    "SELECT * FROM ciudades WHERE region_id=? AND activo=1 ORDER BY nombre",
    [req.params.region_id],
  );
  res.json({ ok: true, datos: rows });
});

// ── ALMACENES ─────────────────────────────────────────────────────────────────
router.get("/almacenes", async (req, res) => {
  try {
    const rows = await fetchAlmacenes(req, {
      includeInactive: resolveIncludeInactive(req),
    });
    res.json({ ok: true, datos: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, mensaje: "Error interno" });
  }
});
router.get(
  "/almacenes/export/excel",
  requireRol("superadmin", "admin"),
  async (req, res) => {
    try {
      const rows = await fetchAlmacenes(req, { includeInactive: true });
      await sendExcelWorkbook(res, {
        fileName: `catalogo_almacenes_${Date.now()}`,
        sheetName: "Almacenes",
        columns: [
          { header: "ID", key: "id", width: 10, type: "integer" },
          { header: "NOMBRE", key: "nombre", width: 28 },
          { header: "CIUDAD", key: "ciudad_nombre", width: 20 },
          { header: "REGION", key: "region_nombre", width: 20 },
          { header: "ZONA", key: "zona", width: 14 },
          { header: "DIRECCION", key: "direccion", width: 32 },
          { header: "ESTADO", key: "estado", width: 14 },
        ],
        rows: rows.map((row) => ({
          id: Number(row.id || 0),
          nombre: row.nombre || "",
          ciudad_nombre: row.ciudad_nombre || "",
          region_nombre: row.region_nombre || "",
          zona: row.zona || "",
          direccion: row.direccion || "",
          estado: formatEstadoLabel(row.activo),
        })),
      });
    } catch (err) {
      console.error(err);
      res
        .status(err.statusCode || 500)
        .json({ ok: false, mensaje: err.message || "Error interno" });
    }
  },
);
router.get("/almacenes/:id", async (req, res) => {
  const [rows] = await pool.query(
    `SELECT a.*, c.nombre AS ciudad_nombre FROM almacenes a
     JOIN ciudades c ON c.id = a.ciudad_id WHERE a.id=?`,
    [req.params.id],
  );
  if (!rows.length)
    return res.status(404).json({ ok: false, mensaje: "No encontrado" });
  res.json({ ok: true, datos: rows[0] });
});
router.post(
  "/almacenes",
  requireRol("superadmin", "admin"),
  [body("nombre").trim().notEmpty(), body("ciudad_id").isInt({ min: 1 })],
  validate,
  async (req, res) => {
    const { nombre, ciudad_id, direccion } = req.body;
    const [r] = await pool.query(
      "INSERT INTO almacenes (ciudad_id, nombre, direccion) VALUES (?,?,?)",
      [ciudad_id, nombre, direccion || null],
    );
    res.status(201).json({ ok: true, id: r.insertId });
  },
);
router.put(
  "/almacenes/:id",
  requireRol("superadmin", "admin"),
  [param("id").isInt()],
  validate,
  async (req, res) => {
    const { nombre, ciudad_id, direccion, activo } = req.body;
    await pool.query(
      "UPDATE almacenes SET nombre=?, ciudad_id=?, direccion=?, activo=? WHERE id=?",
      [nombre, ciudad_id, direccion || null, activo ?? 1, req.params.id],
    );
    res.json({ ok: true });
  },
);
router.delete(
  "/almacenes/:id",
  requireRol("superadmin", "admin"),
  async (req, res) => {
    await pool.query("UPDATE almacenes SET activo=0 WHERE id=?", [
      req.params.id,
    ]);
    res.json({ ok: true });
  },
);

// ── CATEGORIAS ────────────────────────────────────────────────────────────────
router.get("/categorias", async (req, res) => {
  try {
    const rows = await fetchCategorias(req, {
      includeInactive: resolveIncludeInactive(req),
    });
    res.json({ ok: true, datos: rows });
  } catch {
    res.status(500).json({ ok: false, mensaje: "Error interno" });
  }
});
router.get(
  "/categorias/export/excel",
  requireRol("superadmin", "admin"),
  async (req, res) => {
    try {
      const rows = await fetchCategorias(req, { includeInactive: true });
      await sendExcelWorkbook(res, {
        fileName: `catalogo_categorias_${Date.now()}`,
        sheetName: "Categorias",
        columns: [
          { header: "ID", key: "id", width: 10, type: "integer" },
          { header: "NOMBRE", key: "nombre", width: 28 },
          { header: "DESCRIPCION", key: "descripcion", width: 40 },
          { header: "ESTADO", key: "estado", width: 14 },
        ],
        rows: rows.map((row) => ({
          id: Number(row.id || 0),
          nombre: row.nombre || "",
          descripcion: row.descripcion || "",
          estado: formatEstadoLabel(row.activo),
        })),
      });
    } catch (err) {
      console.error(err);
      res
        .status(err.statusCode || 500)
        .json({ ok: false, mensaje: err.message || "Error interno" });
    }
  },
);
router.post(
  "/categorias",
  requireRol("superadmin", "admin"),
  [body("nombre").trim().notEmpty()],
  validate,
  async (req, res) => {
    const eid = resolveEmpresaId(req) || req.empresa_id;
    const [r] = await pool.query(
      "INSERT INTO categorias (empresa_id, nombre, descripcion) VALUES (?,?,?)",
      [eid, req.body.nombre, req.body.descripcion || null],
    );
    res.status(201).json({ ok: true, id: r.insertId });
  },
);
router.put(
  "/categorias/:id",
  requireRol("superadmin", "admin"),
  [param("id").isInt()],
  validate,
  async (req, res) => {
    await pool.query(
      "UPDATE categorias SET nombre=?, descripcion=?, activo=? WHERE id=?",
      [
        req.body.nombre,
        req.body.descripcion || null,
        req.body.activo ?? 1,
        req.params.id,
      ],
    );
    res.json({ ok: true });
  },
);
router.delete(
  "/categorias/:id",
  requireRol("superadmin", "admin"),
  async (req, res) => {
    await pool.query("UPDATE categorias SET activo=0 WHERE id=?", [
      req.params.id,
    ]);
    res.json({ ok: true });
  },
);

// ── TIPOS DE MERCADERIA ───────────────────────────────────────────────────────
router.get("/tipos-mercaderia", async (req, res) => {
  try {
    const rows = await fetchTiposMercaderia(req, {
      includeInactive: resolveIncludeInactive(req),
    });
    res.json({ ok: true, datos: rows });
  } catch {
    res.status(500).json({ ok: false, mensaje: "Error interno" });
  }
});
router.get(
  "/tipos-mercaderia/export/excel",
  requireRol("superadmin", "admin"),
  async (req, res) => {
    try {
      const rows = await fetchTiposMercaderia(req, { includeInactive: true });
      await sendExcelWorkbook(res, {
        fileName: `catalogo_tipos_mercaderia_${Date.now()}`,
        sheetName: "Tipos Mercaderia",
        columns: [
          { header: "ID", key: "id", width: 10, type: "integer" },
          { header: "CATEGORIA", key: "categoria_nombre", width: 24 },
          { header: "NOMBRE", key: "nombre", width: 28 },
          { header: "ESTADO", key: "estado", width: 14 },
        ],
        rows: rows.map((row) => ({
          id: Number(row.id || 0),
          categoria_nombre: row.categoria_nombre || "",
          nombre: row.nombre || "",
          estado: formatEstadoLabel(row.activo),
        })),
      });
    } catch (err) {
      console.error(err);
      res
        .status(err.statusCode || 500)
        .json({ ok: false, mensaje: err.message || "Error interno" });
    }
  },
);
router.post(
  "/tipos-mercaderia",
  requireRol("superadmin", "admin"),
  [body("nombre").trim().notEmpty(), body("categoria_id").isInt({ min: 1 })],
  validate,
  async (req, res) => {
    const [r] = await pool.query(
      "INSERT INTO tipos_mercaderia (categoria_id, nombre) VALUES (?,?)",
      [req.body.categoria_id, req.body.nombre],
    );
    res.status(201).json({ ok: true, id: r.insertId });
  },
);
router.put(
  "/tipos-mercaderia/:id",
  requireRol("superadmin", "admin"),
  [param("id").isInt()],
  validate,
  async (req, res) => {
    await pool.query(
      "UPDATE tipos_mercaderia SET nombre=?, activo=? WHERE id=?",
      [req.body.nombre, req.body.activo ?? 1, req.params.id],
    );
    res.json({ ok: true });
  },
);
router.delete(
  "/tipos-mercaderia/:id",
  requireRol("superadmin", "admin"),
  async (req, res) => {
    await pool.query("UPDATE tipos_mercaderia SET activo=0 WHERE id=?", [
      req.params.id,
    ]);
    res.json({ ok: true });
  },
);

// ── INDICADORES ───────────────────────────────────────────────────────────────
router.get("/indicadores", async (req, res) => {
  try {
    const rows = await fetchIndicadores(req, {
      includeInactive: resolveIncludeInactive(req),
    });
    res.json({ ok: true, datos: rows });
  } catch {
    res.status(500).json({ ok: false, mensaje: "Error interno" });
  }
});
router.get(
  "/indicadores/export/excel",
  requireRol("superadmin", "admin"),
  async (req, res) => {
    try {
      const rows = await fetchIndicadores(req, { includeInactive: true });
      await sendExcelWorkbook(res, {
        fileName: `catalogo_indicadores_${Date.now()}`,
        sheetName: "Indicadores",
        columns: [
          { header: "ID", key: "id", width: 10, type: "integer" },
          { header: "NOMBRE", key: "nombre", width: 28 },
          { header: "ESTADO", key: "estado", width: 14 },
        ],
        rows: rows.map((row) => ({
          id: Number(row.id || 0),
          nombre: row.nombre || "",
          estado: formatEstadoLabel(row.activo),
        })),
      });
    } catch (err) {
      console.error(err);
      res
        .status(err.statusCode || 500)
        .json({ ok: false, mensaje: err.message || "Error interno" });
    }
  },
);
router.post(
  "/indicadores",
  requireRol("superadmin", "admin"),
  [body("nombre").trim().notEmpty()],
  validate,
  async (req, res) => {
    const eid = resolveEmpresaId(req) || req.empresa_id;
    const [r] = await pool.query(
      "INSERT INTO indicadores (empresa_id, nombre) VALUES (?,?)",
      [eid, req.body.nombre],
    );
    res.status(201).json({ ok: true, id: r.insertId });
  },
);
router.put(
  "/indicadores/:id",
  requireRol("superadmin", "admin"),
  [param("id").isInt()],
  validate,
  async (req, res) => {
    await pool.query("UPDATE indicadores SET nombre=?, activo=? WHERE id=?", [
      req.body.nombre,
      req.body.activo ?? 1,
      req.params.id,
    ]);
    res.json({ ok: true });
  },
);
router.delete(
  "/indicadores/:id",
  requireRol("superadmin", "admin"),
  async (req, res) => {
    await pool.query("UPDATE indicadores SET activo=0 WHERE id=?", [
      req.params.id,
    ]);
    res.json({ ok: true });
  },
);

// ── PERSONAL RECEPTOR ─────────────────────────────────────────────────────────
router.get("/personal-receptor", async (req, res) => {
  try {
    const rows = await fetchPersonalReceptor(req, {
      includeInactive: resolveIncludeInactive(req),
    });
    res.json({ ok: true, datos: rows });
  } catch {
    res.status(500).json({ ok: false, mensaje: "Error interno" });
  }
});
router.get(
  "/personal-receptor/export/excel",
  requireRol("superadmin", "admin"),
  async (req, res) => {
    try {
      const rows = await fetchPersonalReceptor(req, { includeInactive: true });
      await sendExcelWorkbook(res, {
        fileName: `catalogo_personal_receptor_${Date.now()}`,
        sheetName: "Personal Receptor",
        columns: [
          { header: "ID", key: "id", width: 10, type: "integer" },
          { header: "NOMBRE", key: "nombre", width: 28 },
          { header: "CORREO", key: "email", width: 30 },
          { header: "CARGO", key: "cargo", width: 22 },
          { header: "ALMACEN", key: "almacen_nombre", width: 24 },
          { header: "CIUDAD", key: "ciudad_nombre", width: 20 },
          { header: "CATEGORIA", key: "categoria_nombre", width: 24 },
          { header: "ESTADO", key: "estado", width: 14 },
        ],
        rows: rows.map((row) => ({
          id: Number(row.id || 0),
          nombre: row.nombre || "",
          email: row.email || "",
          cargo: row.cargo || "",
          almacen_nombre: row.almacen_nombre || "",
          ciudad_nombre: row.ciudad_nombre || "",
          categoria_nombre: row.categoria_nombre || "",
          estado: formatEstadoLabel(row.activo),
        })),
      });
    } catch (err) {
      console.error(err);
      res
        .status(err.statusCode || 500)
        .json({ ok: false, mensaje: err.message || "Error interno" });
    }
  },
);
router.post(
  "/personal-receptor",
  requireRol("superadmin", "admin"),
  [
    body("nombre").trim().notEmpty(),
    body("email").isEmail().normalizeEmail().withMessage("Correo invalido"),
    body("almacen_id").isInt({ min: 1 }).withMessage("Almacen requerido"),
    body("categoria_id").isInt({ min: 1 }).withMessage("Categoria requerida"),
  ],
  validate,
  async (req, res) => {
    const eid = resolveEmpresaId(req) || req.empresa_id;
    const { nombre, email, cargo, almacen_id, categoria_id } = req.body;
    const existingRow = await findPersonalReceptorDuplicate({
      empresaId: eid,
      email,
      almacenId: almacen_id,
      categoriaId: categoria_id,
    });
    if (existingRow) {
      return res
        .status(400)
        .json({ ok: false, mensaje: PERSONAL_RECEPTOR_DUPLICATE_MESSAGE });
    }
    const [r] = await pool.query(
      "INSERT INTO personal_receptor (empresa_id, nombre, email, cargo, almacen_id, categoria_id) VALUES (?,?,?,?,?,?)",
      [eid, nombre, email, cargo || null, almacen_id, categoria_id],
    );
    res.status(201).json({ ok: true, id: r.insertId });
  },
);
router.put(
  "/personal-receptor/:id",
  requireRol("superadmin", "admin"),
  [
    param("id").isInt(),
    body("nombre").trim().notEmpty(),
    body("email").isEmail().normalizeEmail().withMessage("Correo invalido"),
    body("almacen_id").isInt({ min: 1 }).withMessage("Almacen requerido"),
    body("categoria_id").isInt({ min: 1 }).withMessage("Categoria requerida"),
  ],
  validate,
  async (req, res) => {
    const eid = resolveEmpresaId(req) || req.empresa_id;
    const { nombre, email, cargo, almacen_id, categoria_id, activo } = req.body;
    const existingRow = await findPersonalReceptorDuplicate({
      empresaId: eid,
      email,
      almacenId: almacen_id,
      categoriaId: categoria_id,
      excludeId: req.params.id,
    });
    if (existingRow) {
      return res
        .status(400)
        .json({ ok: false, mensaje: PERSONAL_RECEPTOR_DUPLICATE_MESSAGE });
    }
    await pool.query(
      "UPDATE personal_receptor SET nombre=?, email=?, cargo=?, almacen_id=?, categoria_id=?, activo=? WHERE id=?",
      [
        nombre,
        email,
        cargo || null,
        almacen_id,
        categoria_id,
        activo ?? 1,
        req.params.id,
      ],
    );
    res.json({ ok: true });
  },
);
router.delete(
  "/personal-receptor/:id",
  requireRol("superadmin", "admin"),
  async (req, res) => {
    await pool.query("UPDATE personal_receptor SET activo=0 WHERE id=?", [
      req.params.id,
    ]);
    res.json({ ok: true });
  },
);

// ── SKUS ──────────────────────────────────────────────────────────────────────
router.get("/skus", async (req, res) => {
  try {
    const rows = await fetchSkus(req, {
      includeInactive: resolveIncludeInactive(req),
    });
    res.json({ ok: true, datos: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, mensaje: "Error interno" });
  }
});
router.get(
  "/skus/export/excel",
  requireRol("superadmin", "admin"),
  async (req, res) => {
    try {
      const rows = await fetchSkus(req, { includeInactive: true });
      await sendExcelWorkbook(res, {
        fileName: `catalogo_skus_${Date.now()}`,
        sheetName: "SKUs",
        columns: [
          { header: "ID", key: "id", width: 10, type: "integer" },
          { header: "NOMBRE", key: "nombre", width: 30 },
          { header: "CODIGO", key: "codigo", width: 18 },
          { header: "CATEGORIA", key: "categoria_nombre", width: 24 },
          {
            header: "TIPO MERCADERIA",
            key: "tipo_mercaderia_nombre",
            width: 24,
          },
          { header: "ZONA", key: "zona", width: 14 },
          { header: "UNIDAD", key: "unidad", width: 14 },
          { header: "MANEJA LOTES", key: "tiene_lote", width: 14 },
          { header: "TIENE VENCIMIENTO", key: "tiene_vencimiento", width: 18 },
          {
            header: "LOTES ACTIVOS",
            key: "lotes_count",
            width: 14,
            type: "integer",
          },
          { header: "ESTADO", key: "estado", width: 14 },
        ],
        rows: rows.map((row) => ({
          id: Number(row.id || 0),
          nombre: row.nombre || "",
          codigo: row.codigo || "",
          categoria_nombre: row.categoria_nombre || "",
          tipo_mercaderia_nombre: row.tipo_mercaderia_nombre || "",
          zona: row.zona || "",
          unidad: row.unidad || "",
          tiene_lote: formatBooleanLabel(row.tiene_lote),
          tiene_vencimiento: formatBooleanLabel(row.tiene_vencimiento),
          lotes_count: Number(row.lotes_count || 0),
          estado: formatEstadoLabel(row.activo),
        })),
      });
    } catch (err) {
      console.error(err);
      res
        .status(err.statusCode || 500)
        .json({ ok: false, mensaje: err.message || "Error interno" });
    }
  },
);
router.get(
  "/skus/import/template",
  requireRol("superadmin", "admin"),
  async (req, res) => {
    try {
      const workbook = await buildSkusImportTemplateWorkbook(req);
      await sendWorkbook(res, workbook, `plantilla_carga_skus_${Date.now()}`);
    } catch (err) {
      console.error(err);
      res
        .status(err.statusCode || 500)
        .json({
          ok: false,
          mensaje: err.message || "No se pudo generar la plantilla de SKUs",
        });
    }
  },
);
router.post(
  "/skus/import/excel",
  requireRol("superadmin", "admin"),
  excelUpload.single("file"),
  async (req, res) => {
    const connection = await pool.getConnection();

    try {
      if (!req.file?.path) {
        return res
          .status(400)
          .json({
            ok: false,
            mensaje: "Debes adjuntar un archivo Excel .xlsx",
          });
      }

      const buffer = fs.readFileSync(req.file.path);
      const workbook = await readWorkbookFromBuffer(buffer);
      await connection.beginTransaction();
      const resumen = await importSkusFromWorkbook(connection, req, workbook);
      await connection.commit();

      res.status(201).json({
        ok: true,
        mensaje: "Carga masiva de SKUs completada",
        datos: resumen,
      });
    } catch (err) {
      await connection.rollback();
      console.error(err);
      res
        .status(err.statusCode || 400)
        .json({
          ok: false,
          mensaje: err.message || "No se pudo procesar la carga masiva de SKUs",
        });
    } finally {
      connection.release();
    }
  },
);

// Carga lotes desde la misma plantilla de SKUs usando la hoja Carga_Lotes.
router.post(
  "/lotes/import/excel",
  requireRol("superadmin", "admin"),
  excelUpload.single("file"),
  async (req, res) => {
    const connection = await pool.getConnection();

    try {
      if (!req.file?.path) {
        return res
          .status(400)
          .json({
            ok: false,
            mensaje: "Debes adjuntar un archivo Excel .xlsx",
          });
      }

      const empresaId = resolveEmpresaId(req) || req.empresa_id;
      if (!empresaId) {
        return res
          .status(400)
          .json({ ok: false, mensaje: "Empresa requerida" });
      }

      const buffer = fs.readFileSync(req.file.path);
      const workbook = await readWorkbookFromBuffer(buffer);
      if (!workbook.getWorksheet("Carga_Lotes")) {
        return res
          .status(400)
          .json({
            ok: false,
            mensaje:
              "La plantilla debe incluir la hoja Carga_Lotes del formato oficial.",
          });
      }

      await connection.beginTransaction();
      const resumen = await importLotesSheetFromWorkbook(
        connection,
        req,
        workbook,
      );
      if (!resumen.filas_procesadas) {
        throw new Error("La hoja Carga_Lotes no contiene filas para procesar.");
      }

      await connection.commit();
      res.status(201).json({
        ok: true,
        mensaje: "Carga de lotes completada",
        datos: resumen,
      });
    } catch (err) {
      await connection.rollback();
      console.error(err);
      res
        .status(err.statusCode || 400)
        .json({ ok: false, mensaje: err.message || "Error al importar lotes" });
    } finally {
      connection.release();
    }
  },
);

// ── LOTES CARGA MASIVA (desde hoja Carga_Lotes de la plantilla de SKUs) ──────
router.post(
  "/lotes/import/excel",
  requireRol("superadmin", "admin"),
  excelUpload.single("file"),
  async (req, res) => {
    const connection = await pool.getConnection();
    try {
      if (!req.file?.path) {
        return res
          .status(400)
          .json({
            ok: false,
            mensaje: "Debes adjuntar un archivo Excel .xlsx",
          });
      }

      const empresaId = resolveEmpresaId(req) || req.empresa_id;
      if (!empresaId) {
        return res
          .status(400)
          .json({ ok: false, mensaje: "Empresa requerida" });
      }

      const buffer = fs.readFileSync(req.file.path);
      const workbook = await readWorkbookFromBuffer(buffer);

      // Buscar hoja Carga_Lotes o la primera hoja
      const worksheet =
        workbook.getWorksheet("Carga_Lotes") || workbook.worksheets[0];
      if (!worksheet) {
        return res
          .status(400)
          .json({
            ok: false,
            mensaje: "El archivo no contiene hojas de trabajo",
          });
      }

      const rows = readWorksheetRows(worksheet);
      if (!rows.length) {
        return res
          .status(400)
          .json({
            ok: false,
            mensaje: "La hoja Carga_Lotes no contiene filas",
          });
      }

      // Cargar todos los SKUs de la empresa para matching por nombre
      const skus = await fetchSkus(req, { includeInactive: false });
      const duplicateSkuNames = buildDuplicateLookupSet(
        skus,
        (row) => row.nombre,
      );

      await connection.beginTransaction();

      let creados = 0;
      let omitidos = 0;
      const errores = [];

      for (const row of rows) {
        const rowNum = Number(row.__rowNum || 0);
        const skuRef = normalizeOptionalString(
          row.sku_referencia ||
            row.sku ||
            row.nombre_sku ||
            row.nombre_referencia,
        );
        const codigoLote = normalizeOptionalString(
          row.codigo_lote || row.lote || row.codigo,
        );
        const fechaVenc = normalizeOptionalString(
          row.fecha_vencimiento || row.vencimiento || row.fecha_venc,
        );

        if (!skuRef) {
          errores.push(`Fila ${rowNum}: SKU_REFERENCIA vacío`);
          continue;
        }
        if (!codigoLote) {
          errores.push(`Fila ${rowNum}: CODIGO_LOTE vacío`);
          continue;
        }

        // Buscar SKU por nombre o referencia
        const sku = resolveSingleSheetMatch(skus, {
          value: skuRef,
          rowNumber: rowNum,
          entityLabel: "SKUs",
          getMatchValues: [
            (item) => item.nombre,
            (item) => buildSkuReferenceLabel(item, duplicateSkuNames),
          ],
          describeRow: describeSku,
        });

        if (!sku) {
          errores.push(`Fila ${rowNum}: SKU "${skuRef}" no encontrado`);
          continue;
        }

        // Verificar si ya existe ese lote para ese SKU
        const [existing] = await connection.query(
          "SELECT id FROM lotes WHERE sku_id=? AND codigo_lote=? LIMIT 1",
          [sku.id, codigoLote],
        );

        if (existing.length) {
          omitidos++;
          continue;
        }

        // Parsear fecha de vencimiento
        let fechaVencParsed = null;
        if (fechaVenc) {
          // Soporte DD/MM/YYYY y YYYY-MM-DD
          const partsSlash = fechaVenc.split("/");
          const partsDash = fechaVenc.split("-");
          if (partsSlash.length === 3) {
            fechaVencParsed = `${partsSlash[2]}-${partsSlash[1].padStart(2, "0")}-${partsSlash[0].padStart(2, "0")}`;
          } else if (partsDash.length === 3) {
            fechaVencParsed = fechaVenc;
          }
        }

        await connection.query(
          "INSERT INTO lotes (sku_id, codigo_lote, fecha_vencimiento, activo) VALUES (?,?,?,1)",
          [sku.id, codigoLote, fechaVencParsed || null],
        );
        creados++;
      }

      if (errores.length && creados === 0) {
        await connection.rollback();
        return res
          .status(400)
          .json({ ok: false, mensaje: errores[0], errores });
      }

      await connection.commit();
      res.status(201).json({
        ok: true,
        mensaje: `Carga de lotes completada: ${creados} creados, ${omitidos} omitidos (ya existían).`,
        datos: { creados, omitidos, errores },
      });
    } catch (err) {
      await connection.rollback();
      console.error(err);
      res
        .status(err.statusCode || 400)
        .json({ ok: false, mensaje: err.message || "Error al importar lotes" });
    } finally {
      connection.release();
    }
  },
);

router.get("/skus/:id", async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM skus WHERE id=?", [
    req.params.id,
  ]);
  if (!rows.length)
    return res.status(404).json({ ok: false, mensaje: "SKU no encontrado" });
  res.json({ ok: true, datos: rows[0] });
});
router.post(
  "/skus",
  requireRol("superadmin", "admin"),
  [
    body("nombre").trim().notEmpty().withMessage("Nombre requerido"),
    body("categoria_id").isInt({ min: 1 }).withMessage("Categoría requerida"),
    body("zona").isIn(["LIMA", "PROVINCIA"]).withMessage("Zona inválida"),
  ],
  validate,
  async (req, res) => {
    const eid = resolveEmpresaId(req) || req.empresa_id;
    const {
      nombre,
      categoria_id,
      tipo_mercaderia_id,
      zona,
      codigo,
      unidad,
      tiene_lote,
      tiene_vencimiento,
    } = req.body;
    const [r] = await pool.query(
      "INSERT INTO skus (empresa_id, categoria_id, tipo_mercaderia_id, zona, codigo, nombre, unidad, tiene_lote, tiene_vencimiento) VALUES (?,?,?,?,?,?,?,?,?)",
      [
        eid,
        categoria_id,
        tipo_mercaderia_id || null,
        zona || "LIMA",
        codigo || null,
        nombre,
        unidad || null,
        tiene_lote ? 1 : 0,
        tiene_vencimiento ? 1 : 0,
      ],
    );
    res.status(201).json({ ok: true, id: r.insertId });
  },
);
router.put(
  "/skus/:id",
  requireRol("superadmin", "admin"),
  [param("id").isInt()],
  validate,
  async (req, res) => {
    const {
      nombre,
      categoria_id,
      tipo_mercaderia_id,
      zona,
      codigo,
      unidad,
      tiene_lote,
      tiene_vencimiento,
      activo,
    } = req.body;
    await pool.query(
      "UPDATE skus SET nombre=?, categoria_id=?, tipo_mercaderia_id=?, zona=?, codigo=?, unidad=?, tiene_lote=?, tiene_vencimiento=?, activo=? WHERE id=?",
      [
        nombre,
        categoria_id,
        tipo_mercaderia_id || null,
        zona || "LIMA",
        codigo || null,
        unidad || null,
        tiene_lote ? 1 : 0,
        tiene_vencimiento ? 1 : 0,
        activo ?? 1,
        req.params.id,
      ],
    );
    res.json({ ok: true });
  },
);
router.delete(
  "/skus/:id",
  requireRol("superadmin", "admin"),
  async (req, res) => {
    try {
      const empresaId = resolveEmpresaId(req);
      const sku = await getScopedSku(req.params.id, empresaId);
      if (!sku) {
        return res
          .status(404)
          .json({ ok: false, mensaje: "SKU no encontrado" });
      }

      const hasMovimientos = await skuHasMovimientos(req.params.id, empresaId);
      if (hasMovimientos) {
        return res.status(400).json({
          ok: false,
          mensaje:
            "No se puede eliminar este SKU porque ya tiene movimientos registrados",
        });
      }

      await pool.query("UPDATE skus SET activo=0 WHERE id=?", [req.params.id]);
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ ok: false, mensaje: "Error interno" });
    }
  },
);

// ── LOTES ─────────────────────────────────────────────────────────────────────
router.get("/lotes", async (req, res) => {
  try {
    const rows = await fetchLotes(req, {
      includeInactive: resolveIncludeInactive(req),
    });
    res.json({ ok: true, datos: rows });
  } catch (err) {
    console.error(err);
    res
      .status(err.statusCode || 500)
      .json({ ok: false, mensaje: err.message || "Error interno" });
  }
});
router.post(
  "/lotes",
  requireRol("superadmin", "admin", "almacenero"),
  [
    body("sku_id").isInt({ min: 1 }),
    body("codigo_lote").trim().notEmpty(),
    body("fecha_vencimiento")
      .optional({ checkFalsy: true, nullable: true })
      .isISO8601(),
  ],
  validate,
  async (req, res) => {
    try {
      const empresaId = resolveEmpresaId(req);
      const { sku_id, codigo_lote, fecha_vencimiento } = req.body;
      const normalizedCodigo = codigo_lote.trim();

      const sku = await getScopedSku(sku_id, empresaId);
      if (!sku) {
        return res
          .status(404)
          .json({ ok: false, mensaje: "SKU no encontrado" });
      }

      const [existentes] = await pool.query(
        "SELECT id, activo FROM lotes WHERE sku_id=? AND UPPER(codigo_lote)=UPPER(?) LIMIT 1",
        [sku_id, normalizedCodigo],
      );
      if (existentes[0]?.activo) {
        return res
          .status(400)
          .json({
            ok: false,
            mensaje:
              "Ya existe un lote activo con ese código para el SKU seleccionado",
          });
      }

      if (existentes.length) {
        await pool.query(
          "UPDATE lotes SET activo=1, fecha_vencimiento=? WHERE id=?",
          [fecha_vencimiento || null, existentes[0].id],
        );
        return res.status(201).json({
          ok: true,
          id: existentes[0].id,
          datos: {
            id: existentes[0].id,
            sku_id: Number(sku_id),
            codigo_lote: normalizedCodigo,
            fecha_vencimiento: fecha_vencimiento || null,
            activo: 1,
          },
        });
      }

      const [r] = await pool.query(
        "INSERT INTO lotes (sku_id, codigo_lote, fecha_vencimiento) VALUES (?,?,?)",
        [sku_id, normalizedCodigo, fecha_vencimiento || null],
      );
      res.status(201).json({
        ok: true,
        id: r.insertId,
        datos: {
          id: r.insertId,
          sku_id: Number(sku_id),
          codigo_lote: normalizedCodigo,
          fecha_vencimiento: fecha_vencimiento || null,
          activo: 1,
        },
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ ok: false, mensaje: "Error interno" });
    }
  },
);
router.put(
  "/lotes/:id",
  requireRol("superadmin", "admin"),
  [param("id").isInt()],
  validate,
  async (req, res) => {
    try {
      const empresaId = resolveEmpresaId(req);
      const lote = await getScopedLote(req.params.id, empresaId);
      if (!lote) {
        return res
          .status(404)
          .json({ ok: false, mensaje: "Lote no encontrado" });
      }

      const { codigo_lote, fecha_vencimiento, activo } = req.body;
      const nextCodigo = String(codigo_lote || "").trim();
      if (!nextCodigo) {
        return res
          .status(400)
          .json({ ok: false, mensaje: "Código de lote requerido" });
      }

      const [duplicados] = await pool.query(
        "SELECT id FROM lotes WHERE sku_id=? AND UPPER(codigo_lote)=UPPER(?) AND id<>? AND activo=1 LIMIT 1",
        [lote.sku_id, nextCodigo, req.params.id],
      );
      if (duplicados.length) {
        return res
          .status(400)
          .json({
            ok: false,
            mensaje: "Ya existe un lote activo con ese código para este SKU",
          });
      }

      await pool.query(
        "UPDATE lotes SET codigo_lote=?, fecha_vencimiento=?, activo=? WHERE id=?",
        [nextCodigo, fecha_vencimiento || null, activo ?? 1, req.params.id],
      );
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ ok: false, mensaje: "Error interno" });
    }
  },
);
router.delete(
  "/lotes/:id",
  requireRol("superadmin", "admin"),
  async (req, res) => {
    try {
      const empresaId = resolveEmpresaId(req);
      const lote = await getScopedLote(req.params.id, empresaId);
      if (!lote) {
        return res
          .status(404)
          .json({ ok: false, mensaje: "Lote no encontrado" });
      }

      const hasMovimientos = await loteHasMovimientos(req.params.id, empresaId);
      if (hasMovimientos) {
        return res.status(400).json({
          ok: false,
          mensaje:
            "No se puede eliminar este lote porque ya fue usado en movimientos",
        });
      }

      await pool.query("UPDATE lotes SET activo=0 WHERE id=?", [req.params.id]);
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ ok: false, mensaje: "Error interno" });
    }
  },
);

module.exports = router;
