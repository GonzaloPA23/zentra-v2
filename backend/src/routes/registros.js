const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { pool } = require("../db");
const {
  authMiddleware,
  requireRol,
  empresaMiddleware,
} = require("../middleware/auth");
const {
  getAssignedWarehouseIds,
  getWarehouseScope,
  recordMatchesAssignedWarehouses,
} = require("../utils/warehouseScope");
const {
  insertAuditLog,
  buildRegistroAuditSnapshot,
  parseAuditDetail,
} = require("../utils/audit");
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

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = process.env.UPLOAD_PATH || "./uploads";
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE || "", 10) || 5 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|pdf/;
    if (allowed.test(path.extname(file.originalname).toLowerCase()))
      cb(null, true);
    else cb(new Error("Solo se permiten JPG, PNG o PDF"));
  },
});

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

const ACCIONES = ["MERMA", "DESPACHO A CANJISTAS", "OTROS MOVIMIENTOS"];
const TIPOS_ACCION = ["ENTRADA", "SALIDA"];
const ESTADOS = ["pendiente", "en_transito", "aprobado", "rechazado"];
const ZONAS = ["LIMA", "PROVINCIA"];
const STOCK_MOVEMENT_EFFECTS = {
  APROBACION: { originDelta: -1, destinationDelta: 1 },
  SALIDA_TRANSITO: { originDelta: -1, destinationDelta: 0 },
  INGRESO_APROBADO: { originDelta: 0, destinationDelta: 1 },
  REVERSA_RECHAZO: { originDelta: 1, destinationDelta: 0 },
  STOCK_INITIAL: { originDelta: 0, destinationDelta: 1 },
  TG_INTERNO_SALIDA: { originDelta: -1, destinationDelta: 0 },
  TG_INTERNO_ENTRADA: { originDelta: 0, destinationDelta: 1 },
};
const STOCK_EPSILON = 0.000001;

const DETAIL_COUNT_EXPR =
  "COALESCE((SELECT COUNT(*) FROM registro_detalles rd_count WHERE rd_count.registro_id = r.id), 0)";
const TOTAL_CANTIDAD_EXPR =
  "COALESCE((SELECT SUM(rd_total.cantidad) FROM registro_detalles rd_total WHERE rd_total.registro_id = r.id), r.cantidad, 0)";
const PRIMARY_SKU_EXPR = `COALESCE((
  SELECT MIN(sk_detail.nombre)
  FROM registro_detalles rd_sku
  JOIN skus sk_detail ON sk_detail.id = rd_sku.sku_id
  WHERE rd_sku.registro_id = r.id
), sk.nombre, '')`;
function getZonaExpr(cityAlias = "ci") {
  return `CASE WHEN UPPER(${cityAlias}.nombre)='LIMA' THEN 'LIMA' ELSE 'PROVINCIA' END`;
}

const REGISTRO_SORT_FIELDS = {
  fecha: "r.fecha",
  almacen_origen: "ao.nombre",
  almacen_destino: "ad.nombre",
  categoria: "ca.nombre",
  tipo_accion: "r.tipo_accion",
  sku: PRIMARY_SKU_EXPR,
  cantidad: TOTAL_CANTIDAD_EXPR,
  estado: "r.estado",
  registrado_por: "u.nombre",
  nro_guia: "r.nro_guia",
};

function cleanupUploadedFile(fileName) {
  if (!fileName) return;
  const uploadDir = process.env.UPLOAD_PATH || "./uploads";
  const fullPath = path.resolve(uploadDir, fileName);
  fs.unlink(fullPath, () => {});
}

function sendBadRequest(res, mensaje) {
  return res.status(400).json({ ok: false, mensaje });
}

function sendForbidden(res, mensaje) {
  return res.status(403).json({ ok: false, mensaje });
}

function getZonaFromCityName(ciudadNombre) {
  return String(ciudadNombre || "").toUpperCase() === "LIMA"
    ? "LIMA"
    : "PROVINCIA";
}

function normalizeOptionalString(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized ? normalized : null;
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
    .replace(/[\u0300-\u036f]/g, "") // quitar tildes
    .replace(/[.,;:\-]/g, " ") // puntuacion -> espacio
    .replace(/\s+/g, " ") // colapsar espacios
    .trim()
    .toUpperCase();
}

function isTgMolitaliaIndicator(value) {
  return normalizeLookupText(value) === "TG MOLITALIA";
}

function isTgInternoIndicator(value) {
  const normalized = normalizeLookupText(value);
  return (
    normalized.includes("TG") &&
    normalized.includes("INTERNO") &&
    normalized.includes("ALMACEN")
  );
}

function isSalidaRegistro(registro = {}) {
  return String(registro.tipo_accion || "").trim().toUpperCase() === "SALIDA";
}

function isEntradaRegistro(registro = {}) {
  return String(registro.tipo_accion || "").trim().toUpperCase() === "ENTRADA";
}

function hasSameOriginDestination(registro = {}) {
  const originId = parsePositiveInt(registro.almacen_origen_id);
  const destinationId = parsePositiveInt(registro.almacen_destino_id);
  return !!originId && !!destinationId && originId === destinationId;
}

function shouldApplyApprovedDestinationStock(registro = {}) {
  return !(isSalidaRegistro(registro) && hasSameOriginDestination(registro));
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

function buildWarehouseReferenceLabel(
  row,
  duplicateWarehouseNames = new Set(),
) {
  const nombre = normalizeOptionalString(row.nombre) || "";
  if (!duplicateWarehouseNames.has(normalizeLookupText(nombre))) {
    return nombre;
  }
  return `${nombre} | ${row.ciudad_nombre || "SIN CIUDAD"}`;
}

function buildStockSkuReferenceLabel(row, duplicateSkuNames = new Set()) {
  const nombre = normalizeOptionalString(row.nombre) || "";
  if (!duplicateSkuNames.has(normalizeLookupText(nombre))) {
    return nombre;
  }
  const parts = [
    nombre,
    row.categoria_nombre || "SIN CATEGORIA",
    row.zona || "SIN ZONA",
  ];
  if (row.codigo) {
    parts.push(row.codigo);
  }
  return parts.join(" | ");
}

function formatRowSuffix(rowNumber) {
  return rowNumber ? ` en la fila ${rowNumber}` : "";
}

function describeWarehouse(row) {
  return `${row.nombre || ""} / ${row.ciudad_nombre || "SIN CIUDAD"} / ${row.zona || "SIN ZONA"}`;
}

function describeStockSku(row) {
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

function resolveSingleSheetMatch(
  rows,
  {
    value,
    rowNumber = null,
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
      `No se encontro ${entityLabel} "${value}"${formatRowSuffix(rowNumber)}.`,
    );
  }

  if (matches.length > 1) {
    const activeMatches = matches.filter((row) => Number(row.activo) === 1);
    if (activeMatches.length === 1) {
      return activeMatches[0];
    }

    const codedMatches = matches.filter((row) =>
      normalizeOptionalString(row.codigo),
    );
    if (codedMatches.length === 1) {
      return codedMatches[0];
    }

    const comparableKeys = new Set(
      matches.map((row) =>
        [
          normalizeLookupText(row.nombre),
          normalizeLookupText(row.categoria_nombre),
          normalizeLookupText(row.zona),
          normalizeLookupText(row.codigo),
        ].join("|"),
      ),
    );
    if (comparableKeys.size === 1) {
      return [...matches].sort((a, b) => Number(a.id || 0) - Number(b.id || 0))[0];
    }

    const examples = matches
      .slice(0, 3)
      .map((row) => describeRow(row))
      .filter(Boolean)
      .join(" | ");
    throw new Error(
      `Hay varios ${entityLabel} llamados "${value}"${formatRowSuffix(rowNumber)}. ` +
        `Usa el nombre exacto de la hoja de referencia.${examples ? ` Ejemplos: ${examples}` : ""}`,
    );
  }

  return matches[0];
}

function buildInstructionSheet(workbook, title, rows = []) {
  const worksheet = workbook.addWorksheet(title, {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  const columns = [
    { header: "CAMPO", key: "campo", width: 24 },
    { header: "DETALLE", key: "detalle", width: 98 },
  ];

  prepareWorksheet(worksheet, columns);
  addWorksheetRows(worksheet, columns, rows);
  return worksheet;
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function resolvePublicAppBaseUrl(req) {
  const originHeader = normalizeOptionalString(req?.headers?.origin);
  if (originHeader) {
    return trimTrailingSlash(originHeader);
  }

  const refererHeader = normalizeOptionalString(req?.headers?.referer);
  if (refererHeader) {
    try {
      return trimTrailingSlash(new URL(refererHeader).origin);
    } catch {
      // Continue with host-based fallback.
    }
  }

  const protocol = String(
    req?.headers?.["x-forwarded-proto"] || req?.protocol || "http",
  )
    .split(",")[0]
    .trim();
  const host = normalizeOptionalString(
    req?.headers?.["x-forwarded-host"] || req?.get?.("host"),
  );
  if (host) {
    return `${protocol}://${host}`;
  }

  const configuredBaseUrl = normalizeOptionalString(
    process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL,
  );
  return configuredBaseUrl ? trimTrailingSlash(configuredBaseUrl) : null;
}

function buildPublicFileUrl(req, fileName) {
  if (!req || !fileName) return null;
  const baseUrl = resolvePublicAppBaseUrl(req);
  if (!baseUrl) return null;
  return `${baseUrl}/uploads/${encodeURIComponent(fileName)}`;
}

function buildFotoGuiaCellValue(req, fileName) {
  const url = buildPublicFileUrl(req, fileName);
  if (!url) return "";
  return {
    text: url,
    hyperlink: url,
    tooltip: url,
  };
}

function padDateSegment(value) {
  return String(value).padStart(2, "0");
}

function buildIsoDateFromParts(year, month, day) {
  const parsedYear = Number(year);
  const parsedMonth = Number(month);
  const parsedDay = Number(day);

  if (
    !Number.isInteger(parsedYear) ||
    !Number.isInteger(parsedMonth) ||
    !Number.isInteger(parsedDay)
  ) {
    return null;
  }

  const date = new Date(Date.UTC(parsedYear, parsedMonth - 1, parsedDay));
  if (
    date.getUTCFullYear() !== parsedYear ||
    date.getUTCMonth() + 1 !== parsedMonth ||
    date.getUTCDate() !== parsedDay
  ) {
    return null;
  }

  return `${parsedYear}-${padDateSegment(parsedMonth)}-${padDateSegment(parsedDay)}`;
}

function normalizeDateInputValue(value) {
  if (value === null || value === undefined || value === "") return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return `${value.getUTCFullYear()}-${padDateSegment(value.getUTCMonth() + 1)}-${padDateSegment(value.getUTCDate())}`;
  }

  const raw = String(value).trim();
  if (!raw || raw === "0000-00-00" || raw === "0000-00-00 00:00:00")
    return null;

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return buildIsoDateFromParts(isoMatch[1], isoMatch[2], isoMatch[3]);
  }

  const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    return buildIsoDateFromParts(slashMatch[3], slashMatch[2], slashMatch[1]);
  }

  const dashMatch = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dashMatch) {
    return buildIsoDateFromParts(dashMatch[3], dashMatch[2], dashMatch[1]);
  }

  const compactIsoMatch = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compactIsoMatch) {
    return buildIsoDateFromParts(
      compactIsoMatch[1],
      compactIsoMatch[2],
      compactIsoMatch[3],
    );
  }

  if (/^\d+(\.\d+)?$/.test(raw)) {
    const serial = Number(raw);
    if (Number.isFinite(serial) && serial > 0) {
      const excelEpoch = Date.UTC(1899, 11, 30);
      const date = new Date(excelEpoch + Math.floor(serial) * 86400000);
      return `${date.getUTCFullYear()}-${padDateSegment(date.getUTCMonth() + 1)}-${padDateSegment(date.getUTCDate())}`;
    }
  }

  const parsedDate = new Date(raw);
  if (Number.isNaN(parsedDate.getTime())) return null;

  return `${parsedDate.getUTCFullYear()}-${padDateSegment(parsedDate.getUTCMonth() + 1)}-${padDateSegment(parsedDate.getUTCDate())}`;
}

function isValidDateInput(value) {
  return !!normalizeDateInputValue(value);
}

function parsePositiveInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parsePositiveFloat(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseNonNegativeFloat(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseFlag(value) {
  return value === true || value === 1 || value === "1";
}

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    return JSON.parse(value);
  }
  return [];
}

function buildFallbackDetailsFromBody(body = {}) {
  if (
    !body?.sku_id &&
    !body?.tipo_mercaderia_id &&
    !body?.lote_id &&
    !body?.cantidad
  ) {
    return [];
  }

  return [
    {
      tipo_mercaderia_id: body.tipo_mercaderia_id,
      sku_id: body.sku_id,
      lote_id: body.lote_id,
      fecha_vencimiento: body.fecha_vencimiento,
      cantidad: body.cantidad,
    },
  ];
}

function parseRegistroBody(body = {}, fallback = {}) {
  let detalles = [];

  try {
    detalles = ensureArray(body.detalles);
  } catch (error) {
    throw new Error("El detalle del registro no tiene un formato válido");
  }

  if (!detalles.length) {
    detalles = buildFallbackDetailsFromBody(body);
  }
  if (!detalles.length && Array.isArray(fallback.detalles)) {
    detalles = fallback.detalles;
  }

  return {
    fecha: String(body.fecha ?? fallback.fecha ?? "").trim(),
    zona: String(body.zona ?? fallback.zona ?? "")
      .trim()
      .toUpperCase(),
    ciudad_id: body.ciudad_id ?? fallback.ciudad_id ?? "",
    almacen_origen_id:
      body.almacen_origen_id ?? fallback.almacen_origen_id ?? "",
    almacen_destino_id:
      body.almacen_destino_id ?? fallback.almacen_destino_id ?? "",
    categoria_id: body.categoria_id ?? fallback.categoria_id ?? "",
    accion: String(body.accion ?? fallback.accion ?? "").trim(),
    tipo_accion: String(body.tipo_accion ?? fallback.tipo_accion ?? "")
      .trim()
      .toUpperCase(),
    personal_receptor_id:
      body.personal_receptor_id ?? fallback.personal_receptor_id ?? "",
    indicador_id: body.indicador_id ?? fallback.indicador_id ?? "",
    nro_guia: String(body.nro_guia ?? fallback.nro_guia ?? "").trim(),
    observaciones: String(
      body.observaciones ?? fallback.observaciones ?? "",
    ).trim(),
    detalles,
  };
}

function addLikeFilter(where, params, value, expression) {
  const term = String(value || "").trim();
  if (!term) return where;

  where += ` AND ${expression} LIKE ?`;
  params.push(`%${term}%`);
  return where;
}

async function getStockScope(req, alias = "sa", executor = pool) {
  if (
    !req?.usuario ||
    !["almacenero", "supervisor"].includes(req.usuario.rol)
  ) {
    return { clause: "", params: [] };
  }

  const ids = await getAssignedWarehouseIds(req.usuario.id, executor);
  if (!ids.length) return { clause: "", params: [] };

  const placeholders = ids.map(() => "?").join(",");
  return {
    clause: ` AND ${alias}.almacen_id IN (${placeholders})`,
    params: ids,
  };
}

async function buildRegistroQuery(req, executor = pool) {
  const {
    fecha_ini,
    fecha_fin,
    almacen_id,
    categoria_id,
    tipo_accion,
    estado,
    q_id,
    q_almacen_origen,
    q_almacen_destino,
    q_categoria,
    q_tipo_accion,
    q_sku,
    q_estado,
    q_zona,
    q_registrado_por,
    q_nro_guia,
    sort_by = "fecha",
    sort_dir = "desc",
    page = 1,
    limit = 50,
  } = req.query;

  const scope = await getWarehouseScope(req, "r", executor);
  const fromClause = `FROM registros r
    LEFT JOIN almacenes ao ON ao.id = r.almacen_origen_id
    LEFT JOIN almacenes ad ON ad.id = r.almacen_destino_id
    LEFT JOIN ciudades ci ON ci.id = r.ciudad_id
    LEFT JOIN categorias ca ON ca.id = r.categoria_id
    LEFT JOIN personal_receptor pr ON pr.id = r.personal_receptor_id
    LEFT JOIN indicadores ind ON ind.id = r.indicador_id
    LEFT JOIN usuarios u ON u.id = r.usuario_id
    LEFT JOIN skus sk ON sk.id = r.sku_id`;

  let where = req.empresa_id ? "WHERE r.empresa_id = ?" : "WHERE 1=1";
  const params = req.empresa_id ? [req.empresa_id] : [];
  where += " AND r.eliminado_at IS NULL";

  if (fecha_ini) {
    where += " AND r.fecha >= ?";
    params.push(fecha_ini);
  }
  if (fecha_fin) {
    where += " AND r.fecha <= ?";
    params.push(fecha_fin);
  }
  if (almacen_id) {
    where += " AND (r.almacen_origen_id = ? OR r.almacen_destino_id = ?)";
    params.push(almacen_id, almacen_id);
  }
  if (categoria_id) {
    where += " AND r.categoria_id = ?";
    params.push(categoria_id);
  }
  if (tipo_accion) {
    where += " AND r.tipo_accion = ?";
    params.push(tipo_accion);
  }
  if (estado) {
    where += " AND r.estado = ?";
    params.push(estado);
  }
  if (q_id) {
    const idTerm = Number.parseInt(q_id, 10);
    if (Number.isInteger(idTerm) && idTerm > 0) {
      where += " AND r.id = ?";
      params.push(idTerm);
    }
  }
  if (q_zona) {
    const zona = String(q_zona).trim().toUpperCase();
    if (ZONAS.includes(zona)) {
      where += ` AND ${getZonaExpr("ci")}=?`;
      params.push(zona);
    }
  }

  where = addLikeFilter(where, params, q_almacen_origen, "ao.nombre");
  where = addLikeFilter(where, params, q_almacen_destino, "ad.nombre");
  where = addLikeFilter(where, params, q_categoria, "ca.nombre");
  where = addLikeFilter(where, params, q_tipo_accion, "r.tipo_accion");
  where = addLikeFilter(where, params, q_estado, "r.estado");
  where = addLikeFilter(
    where,
    params,
    q_registrado_por,
    "CONCAT(COALESCE(u.nombre,''),' ',COALESCE(u.apellido,''))",
  );
  where = addLikeFilter(where, params, q_nro_guia, "r.nro_guia");

  const skuTerm = String(q_sku || "").trim();
  if (skuTerm) {
    where += ` AND (
      EXISTS (
        SELECT 1
        FROM registro_detalles rd_q
        JOIN skus sk_q ON sk_q.id = rd_q.sku_id
        WHERE rd_q.registro_id = r.id
          AND sk_q.nombre LIKE ?
      )
      OR (
        NOT EXISTS (SELECT 1 FROM registro_detalles rd_empty WHERE rd_empty.registro_id = r.id)
        AND sk.nombre LIKE ?
      )
    )`;
    params.push(`%${skuTerm}%`, `%${skuTerm}%`);
  }

  where += scope.clause;
  params.push(...scope.params);

  const sortField = REGISTRO_SORT_FIELDS[sort_by] || REGISTRO_SORT_FIELDS.fecha;
  const sortDirection =
    String(sort_dir).toLowerCase() === "asc" ? "ASC" : "DESC";

  return {
    fromClause,
    where,
    params,
    orderBy: `ORDER BY ${sortField} ${sortDirection}, r.id DESC`,
    page: Math.max(1, Number.parseInt(page, 10) || 1),
    limit: Math.min(500, Math.max(1, Number.parseInt(limit, 10) || 50)),
  };
}

async function attachRegistroDetails(executor, registros) {
  if (!Array.isArray(registros) || !registros.length) return registros;

  const ids = registros.map((registro) => Number(registro.id)).filter(Boolean);
  const placeholders = ids.map(() => "?").join(",");
  const detailsByRegistro = new Map();

  const [detailRows] = await executor.query(
    `SELECT rd.id, rd.registro_id, rd.tipo_mercaderia_id, rd.sku_id, rd.lote_id,
            rd.fecha_vencimiento, rd.cantidad,
            tm.nombre AS tipo_mercaderia_nombre,
            sk.nombre AS sku_nombre,
            sk.codigo AS sku_codigo,
            sk.tiene_lote,
            sk.tiene_vencimiento,
            lo.codigo_lote,
            lo.fecha_vencimiento AS lote_fecha_vencimiento
     FROM registro_detalles rd
     LEFT JOIN tipos_mercaderia tm ON tm.id = rd.tipo_mercaderia_id
     LEFT JOIN skus sk ON sk.id = rd.sku_id
     LEFT JOIN lotes lo ON lo.id = rd.lote_id
     WHERE rd.registro_id IN (${placeholders})
     ORDER BY rd.registro_id, rd.id`,
    ids,
  );

  detailRows.forEach((row) => {
    const list = detailsByRegistro.get(Number(row.registro_id)) || [];
    list.push({
      id: row.id,
      registro_id: Number(row.registro_id),
      tipo_mercaderia_id: row.tipo_mercaderia_id
        ? Number(row.tipo_mercaderia_id)
        : null,
      tipo_mercaderia_nombre: row.tipo_mercaderia_nombre || "",
      sku_id: row.sku_id ? Number(row.sku_id) : null,
      sku_nombre: row.sku_nombre || "",
      sku_codigo: row.sku_codigo || "",
      tiene_lote: row.tiene_lote,
      tiene_vencimiento: row.tiene_vencimiento,
      lote_id: row.lote_id ? Number(row.lote_id) : null,
      codigo_lote: row.codigo_lote || "",
      fecha_vencimiento:
        row.fecha_vencimiento || row.lote_fecha_vencimiento || null,
      cantidad: Number(row.cantidad || 0),
    });
    detailsByRegistro.set(Number(row.registro_id), list);
  });

  const registrosSinDetalle = ids.filter((id) => !detailsByRegistro.has(id));
  if (registrosSinDetalle.length) {
    const fallbackPlaceholders = registrosSinDetalle.map(() => "?").join(",");
    const [legacyRows] = await executor.query(
      `SELECT r.id AS registro_id, r.tipo_mercaderia_id, r.sku_id, r.lote_id, r.fecha_vencimiento, r.cantidad,
              tm.nombre AS tipo_mercaderia_nombre,
              sk.nombre AS sku_nombre,
              sk.codigo AS sku_codigo,
              sk.tiene_lote,
              sk.tiene_vencimiento,
              lo.codigo_lote,
              lo.fecha_vencimiento AS lote_fecha_vencimiento
       FROM registros r
       LEFT JOIN tipos_mercaderia tm ON tm.id = r.tipo_mercaderia_id
       LEFT JOIN skus sk ON sk.id = r.sku_id
       LEFT JOIN lotes lo ON lo.id = r.lote_id
       WHERE r.id IN (${fallbackPlaceholders})`,
      registrosSinDetalle,
    );

    legacyRows.forEach((row) => {
      detailsByRegistro.set(Number(row.registro_id), [
        {
          id: null,
          registro_id: Number(row.registro_id),
          tipo_mercaderia_id: row.tipo_mercaderia_id
            ? Number(row.tipo_mercaderia_id)
            : null,
          tipo_mercaderia_nombre: row.tipo_mercaderia_nombre || "",
          sku_id: row.sku_id ? Number(row.sku_id) : null,
          sku_nombre: row.sku_nombre || "",
          sku_codigo: row.sku_codigo || "",
          tiene_lote: row.tiene_lote,
          tiene_vencimiento: row.tiene_vencimiento,
          lote_id: row.lote_id ? Number(row.lote_id) : null,
          codigo_lote: row.codigo_lote || "",
          fecha_vencimiento:
            row.fecha_vencimiento || row.lote_fecha_vencimiento || null,
          cantidad: Number(row.cantidad || 0),
        },
      ]);
    });
  }

  return registros.map((registro) => {
    const detalles = detailsByRegistro.get(Number(registro.id)) || [];
    const cantidadTotal =
      detalles.reduce((acc, detail) => acc + Number(detail.cantidad || 0), 0) ||
      Number(registro.cantidad_total || 0);
    const skuPrincipal =
      detalles[0]?.sku_nombre || registro.sku_principal_nombre || "";
    const skuResumen = !detalles.length
      ? "-"
      : detalles.length === 1
        ? skuPrincipal
        : `${skuPrincipal} +${detalles.length - 1} más`;

    return {
      ...registro,
      cantidad_total: cantidadTotal,
      detalles_count:
        detalles.length || Number(registro.detalles_count || 0) || 1,
      sku_principal_nombre: skuPrincipal,
      sku_resumen: skuResumen,
      detalles,
    };
  });
}

async function fetchRegistroRows(executor, req, { paginate = true } = {}) {
  const { fromClause, where, params, orderBy, page, limit } =
    await buildRegistroQuery(req, executor);
  const baseSelect = `SELECT r.*,
      ao.nombre AS almacen_origen,
      ad.nombre AS almacen_destino,
      ci.nombre AS ciudad_nombre,
      ${getZonaExpr()} AS zona,
      ca.nombre AS categoria_nombre,
      pr.nombre AS personal_receptor_nombre,
      ind.nombre AS indicador_nombre,
      CONCAT(COALESCE(u.nombre,''),' ',COALESCE(u.apellido,'')) AS registrado_por,
      ${PRIMARY_SKU_EXPR} AS sku_principal_nombre,
      ${TOTAL_CANTIDAD_EXPR} AS cantidad_total,
      GREATEST(${DETAIL_COUNT_EXPR}, 1) AS detalles_count
    ${fromClause}
    ${where}
    ${orderBy}`;

  let rows = [];
  let paginacion = null;

  if (paginate) {
    const offset = (page - 1) * limit;
    const [[{ total }]] = await executor.query(
      `SELECT COUNT(*) AS total ${fromClause} ${where}`,
      params,
    );

    const [queryRows] = await executor.query(`${baseSelect} LIMIT ? OFFSET ?`, [
      ...params,
      limit,
      offset,
    ]);

    rows = queryRows;
    paginacion = {
      total: Number(total || 0),
      page,
      limit,
      pages: Math.max(1, Math.ceil(Number(total || 0) / limit)),
    };
  } else {
    const [queryRows] = await executor.query(baseSelect, params);
    rows = queryRows;
  }

  const enrichedRows = await attachRegistroDetails(executor, rows);
  return { rows: enrichedRows, paginacion };
}

async function getRegistroById(executor, req, id) {
  let query = `SELECT r.*,
      ao.nombre AS almacen_origen,
      ad.nombre AS almacen_destino,
      ci.nombre AS ciudad_nombre,
      ${getZonaExpr()} AS zona,
      ca.nombre AS categoria_nombre,
      pr.nombre AS personal_receptor_nombre,
      ind.nombre AS indicador_nombre,
      CONCAT(COALESCE(u.nombre,''),' ',COALESCE(u.apellido,'')) AS registrado_por
    FROM registros r
    LEFT JOIN almacenes ao ON ao.id = r.almacen_origen_id
    LEFT JOIN almacenes ad ON ad.id = r.almacen_destino_id
    LEFT JOIN ciudades ci ON ci.id = r.ciudad_id
    LEFT JOIN categorias ca ON ca.id = r.categoria_id
    LEFT JOIN personal_receptor pr ON pr.id = r.personal_receptor_id
    LEFT JOIN indicadores ind ON ind.id = r.indicador_id
    LEFT JOIN usuarios u ON u.id = r.usuario_id
    WHERE r.id=? AND r.eliminado_at IS NULL`;
  const params = [id];

  if (req.empresa_id) {
    query += " AND r.empresa_id=?";
    params.push(req.empresa_id);
  }

  const [rows] = await executor.query(query, params);
  if (!rows.length) return null;

  const scope = await getWarehouseScope(req, "r", executor);
  if (!recordMatchesAssignedWarehouses(rows[0], scope.ids)) {
    const error = new Error("Sin acceso a este registro");
    error.statusCode = 403;
    throw error;
  }

  const [registro] = await attachRegistroDetails(executor, rows);
  return registro;
}

async function getCurrentStockAmount(
  executor,
  { empresa_id, almacen_id, sku_id, lote_id },
) {
  if (!empresa_id || !almacen_id || !sku_id) {
    return 0;
  }

  const normalizedLoteId = parsePositiveInt(lote_id) || null;
  const lotePredicate = normalizedLoteId
    ? "sm.lote_id=?"
    : "sm.lote_id IS NULL";
  const jsonLotePredicate = normalizedLoteId
    ? "CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(detalle, '$.lote_id')), '') AS UNSIGNED)=?"
    : "(JSON_EXTRACT(detalle, '$.lote_id') IS NULL OR LOWER(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(detalle, '$.lote_id')), '')) IN ('', 'null'))";

  const [auditRows] = await executor.query(
    `SELECT COALESCE(SUM(CAST(COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(detalle, '$.cantidad')), ''), '0') AS DECIMAL(18,4))), 0) AS cantidad
     FROM audit_log
     WHERE accion='STOCK_INITIAL'
       AND tabla='stock_almacen'
       AND empresa_id=?
       AND CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(detalle, '$.almacen_id')), '') AS UNSIGNED)=?
       AND CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(detalle, '$.sku_id')), '') AS UNSIGNED)=?
       AND ${jsonLotePredicate}`,
    normalizedLoteId
      ? [empresa_id, almacen_id, sku_id, normalizedLoteId]
      : [empresa_id, almacen_id, sku_id],
  );

  const [movementRowsForItem] = await executor.query(
    `SELECT COALESCE(SUM(
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
             WHEN sm.almacen_origen_id=? AND sm.tipo_movimiento IN ('APROBACION', 'SALIDA_TRANSITO', 'TG_INTERNO_SALIDA') THEN -sm.cantidad
             WHEN sm.almacen_origen_id=? AND sm.tipo_movimiento='REVERSA_RECHAZO' THEN sm.cantidad
             ELSE 0
           END)
           +
           (CASE
             WHEN sm.almacen_destino_id=? AND sm.tipo_movimiento IN ('APROBACION', 'INGRESO_APROBADO', 'TG_INTERNO_ENTRADA') THEN sm.cantidad
             ELSE 0
           END)
       END
     ), 0) AS cantidad
     FROM stock_movimientos sm
     LEFT JOIN registros r ON r.id = sm.registro_id
     WHERE sm.empresa_id=?
       AND sm.sku_id=?
       AND ${lotePredicate}
       AND (sm.almacen_origen_id=? OR sm.almacen_destino_id=?)
       AND (r.id IS NULL OR r.eliminado_at IS NULL)`,
    normalizedLoteId
      ? [
          almacen_id,
          almacen_id,
          almacen_id,
          empresa_id,
          sku_id,
          normalizedLoteId,
          almacen_id,
          almacen_id,
        ]
      : [
          almacen_id,
          almacen_id,
          almacen_id,
          empresa_id,
          sku_id,
          almacen_id,
          almacen_id,
        ],
  );

  return Number(auditRows[0]?.cantidad || 0) + Number(movementRowsForItem[0]?.cantidad || 0);
}

async function upsertStock(
  executor,
  { empresa_id, almacen_id, sku_id, lote_id, cantidad },
) {
  if (!almacen_id || !sku_id || !cantidad) return;

  const normalizedCantidad = Number(cantidad || 0);
  if (!normalizedCantidad) return;

  const normalizedLoteId = parsePositiveInt(lote_id) || null;
  const [existingRows] = await executor.query(
    normalizedLoteId
      ? `SELECT id, cantidad
         FROM stock_almacen
         WHERE empresa_id=? AND almacen_id=? AND sku_id=? AND lote_id=?
         LIMIT 1
         FOR UPDATE`
      : `SELECT id, cantidad
         FROM stock_almacen
         WHERE empresa_id=? AND almacen_id=? AND sku_id=? AND lote_id IS NULL
         LIMIT 1
         FOR UPDATE`,
    normalizedLoteId
      ? [empresa_id, almacen_id, sku_id, normalizedLoteId]
      : [empresa_id, almacen_id, sku_id],
  );

  if (existingRows.length) {
    const stockId = existingRows[0].id;
    let baseCantidad = Number(existingRows[0].cantidad || 0);
    let nextCantidad = baseCantidad + normalizedCantidad;

    if (nextCantidad < -STOCK_EPSILON && normalizedCantidad < 0) {
      const realAvailable = await getCurrentStockAmount(executor, {
        empresa_id,
        almacen_id,
        sku_id,
        lote_id: normalizedLoteId,
      });
      if (realAvailable + normalizedCantidad >= -STOCK_EPSILON) {
        baseCantidad = realAvailable;
        nextCantidad = baseCantidad + normalizedCantidad;
      }
    }

    if (nextCantidad < -STOCK_EPSILON) {
      throw new Error("El stock final no puede quedar negativo");
    }

    if (Math.abs(nextCantidad) < STOCK_EPSILON) {
      await executor.query("DELETE FROM stock_almacen WHERE id=?", [stockId]);
      return;
    }

    await executor.query(
      "UPDATE stock_almacen SET cantidad=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
      [nextCantidad, stockId],
    );
    return;
  }

  if (normalizedCantidad < -STOCK_EPSILON) {
    const realAvailable = await getCurrentStockAmount(executor, {
      empresa_id,
      almacen_id,
      sku_id,
      lote_id: normalizedLoteId,
    });
    const nextCantidad = realAvailable + normalizedCantidad;
    if (nextCantidad < -STOCK_EPSILON) {
      throw new Error("El stock final no puede quedar negativo");
    }
    if (Math.abs(nextCantidad) < STOCK_EPSILON) {
      return;
    }
    await executor.query(
      `INSERT INTO stock_almacen (empresa_id, almacen_id, sku_id, lote_id, cantidad)
       VALUES (?,?,?,?,?)`,
      [empresa_id, almacen_id, sku_id, normalizedLoteId, nextCantidad],
    );
    return;
  }

  await executor.query(
    `INSERT INTO stock_almacen (empresa_id, almacen_id, sku_id, lote_id, cantidad)
     VALUES (?,?,?,?,?)`,
    [empresa_id, almacen_id, sku_id, normalizedLoteId, normalizedCantidad],
  );
}

async function ensureStockAvailabilityForBatch(
  executor,
  registro,
  tipoMovimiento,
  { previousRequiredByKey = new Map() } = {},
) {
  const detalles = Array.isArray(registro.detalles) ? registro.detalles : [];
  const effects = getMovementEffects(tipoMovimiento);

  if (
    !effects.originDelta ||
    effects.originDelta >= 0 ||
    !registro.almacen_origen_id
  ) {
    return;
  }

  const requiredByKey = new Map();

  detalles.forEach((detail) => {
    const cantidad = Number(detail.cantidad || 0);
    if (!cantidad || !detail.sku_id) return;

    const loteKey = parsePositiveInt(detail.lote_id) || "sin-lote";
    const key = `${registro.almacen_origen_id}|${detail.sku_id}|${loteKey}`;
    const current = requiredByKey.get(key) || {
      empresa_id: registro.empresa_id,
      almacen_id: registro.almacen_origen_id,
      sku_id: detail.sku_id,
      lote_id: parsePositiveInt(detail.lote_id) || null,
      sku_nombre: detail.sku_nombre || `SKU ${detail.sku_id}`,
      codigo_lote: detail.codigo_lote || "SIN LOTE",
      cantidad_requerida: 0,
    };

    current.cantidad_requerida += cantidad * Math.abs(effects.originDelta);
    requiredByKey.set(key, current);
  });

  for (const stockRequest of requiredByKey.values()) {
    const loteKey = parsePositiveInt(stockRequest.lote_id) || "sin-lote";
    const key = `${stockRequest.almacen_id}|${stockRequest.sku_id}|${loteKey}`;
    const previousRequired = Number(previousRequiredByKey.get(key) || 0);
    const netRequired = Math.max(0, stockRequest.cantidad_requerida - previousRequired);
    if (netRequired <= STOCK_EPSILON) {
      continue;
    }

    const available = await getCurrentStockAmount(executor, stockRequest);
    const finalStock = available - netRequired;

    if (finalStock < -STOCK_EPSILON) {
      const visibleAvailable = Math.max(0, available);
      const almacen =
        registro.almacen_origen || `almacen ${stockRequest.almacen_id}`;
      throw new Error(
        `Stock insuficiente para ${stockRequest.sku_nombre} (${stockRequest.codigo_lote}) en ${almacen}. Disponible: ${visibleAvailable}, salida solicitada: ${netRequired}`,
      );
    }
  }
}

function getMovementEffects(tipoMovimiento = "APROBACION") {
  return (
    STOCK_MOVEMENT_EFFECTS[tipoMovimiento] || STOCK_MOVEMENT_EFFECTS.APROBACION
  );
}

async function insertStockMovement(executor, movement) {
  await executor.query(
    `INSERT INTO stock_movimientos
     (empresa_id, registro_id, registro_detalle_id, almacen_origen_id, almacen_destino_id, sku_id, lote_id, cantidad, tipo_movimiento, usuario_id)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      movement.empresa_id,
      movement.registro_id,
      movement.registro_detalle_id || null,
      movement.almacen_origen_id,
      movement.almacen_destino_id,
      movement.sku_id,
      parsePositiveInt(movement.lote_id) || null,
      movement.cantidad,
      movement.tipo_movimiento,
      movement.usuario_id || null,
    ],
  );
}

async function applyStockMovementBatch(
  executor,
  registro,
  tipoMovimiento,
  usuarioId,
  options = {},
) {
  const detalles = Array.isArray(registro.detalles) ? registro.detalles : [];
  const effects = getMovementEffects(tipoMovimiento);

  await ensureStockAvailabilityForBatch(executor, registro, tipoMovimiento, options);

  for (const detail of detalles) {
    const cantidad = Number(detail.cantidad || 0);
    if (!cantidad) continue;

    if (effects.originDelta && registro.almacen_origen_id) {
      await upsertStock(executor, {
        empresa_id: registro.empresa_id,
        almacen_id: registro.almacen_origen_id,
        sku_id: detail.sku_id,
        lote_id: detail.lote_id,
        cantidad: cantidad * effects.originDelta,
      });
    }

    if (effects.destinationDelta && registro.almacen_destino_id) {
      await upsertStock(executor, {
        empresa_id: registro.empresa_id,
        almacen_id: registro.almacen_destino_id,
        sku_id: detail.sku_id,
        lote_id: detail.lote_id,
        cantidad: cantidad * effects.destinationDelta,
      });
    }

    await insertStockMovement(executor, {
      empresa_id: registro.empresa_id,
      registro_id: registro.id,
      registro_detalle_id: detail.id || null,
      almacen_origen_id: registro.almacen_origen_id,
      almacen_destino_id: registro.almacen_destino_id,
      sku_id: detail.sku_id,
      lote_id: detail.lote_id,
      cantidad,
      tipo_movimiento: tipoMovimiento,
      usuario_id: usuarioId || registro.usuario_id,
    });
  }
}

async function reverseRecordedStockMovements(executor, registroId) {
  const [movimientos] = await executor.query(
    "SELECT * FROM stock_movimientos WHERE registro_id=? ORDER BY id DESC",
    [registroId],
  );

  if (!movimientos.length) {
    return [];
  }

  for (const movimiento of movimientos) {
    const cantidad = Number(movimiento.cantidad || 0);
    const effects = getMovementEffects(movimiento.tipo_movimiento);

    if (effects.originDelta && movimiento.almacen_origen_id) {
      await upsertStock(executor, {
        empresa_id: movimiento.empresa_id,
        almacen_id: movimiento.almacen_origen_id,
        sku_id: movimiento.sku_id,
        lote_id: movimiento.lote_id,
        cantidad: cantidad * effects.originDelta * -1,
      });
    }

    if (effects.destinationDelta && movimiento.almacen_destino_id) {
      await upsertStock(executor, {
        empresa_id: movimiento.empresa_id,
        almacen_id: movimiento.almacen_destino_id,
        sku_id: movimiento.sku_id,
        lote_id: movimiento.lote_id,
        cantidad: cantidad * effects.destinationDelta * -1,
      });
    }
  }

  await executor.query("DELETE FROM stock_movimientos WHERE registro_id=?", [
    registroId,
  ]);

  return movimientos;
}

async function getRegistroStockMovements(executor, registroId) {
  const [movimientos] = await executor.query(
    "SELECT * FROM stock_movimientos WHERE registro_id=? ORDER BY id",
    [registroId],
  );
  return movimientos;
}

function buildPreviousOriginRequirements(movements = []) {
  const requiredByKey = new Map();

  movements.forEach((movement) => {
    const effects = getMovementEffects(movement.tipo_movimiento);
    if (!effects.originDelta || effects.originDelta >= 0 || !movement.almacen_origen_id) {
      return;
    }

    const loteKey = parsePositiveInt(movement.lote_id) || "sin-lote";
    const key = `${movement.almacen_origen_id}|${movement.sku_id}|${loteKey}`;
    requiredByKey.set(
      key,
      Number(requiredByKey.get(key) || 0) + Number(movement.cantidad || 0) * Math.abs(effects.originDelta),
    );
  });

  return requiredByKey;
}

function addStockDelta(deltaMap, keyParts, amount) {
  const normalizedAmount = Number(amount || 0);
  if (!normalizedAmount) return;

  const loteKey = parsePositiveInt(keyParts.lote_id) || "sin-lote";
  const key = [
    keyParts.empresa_id,
    keyParts.almacen_id,
    keyParts.sku_id,
    loteKey,
  ].join("|");
  const current = deltaMap.get(key) || {
    empresa_id: keyParts.empresa_id,
    almacen_id: keyParts.almacen_id,
    sku_id: keyParts.sku_id,
    lote_id: parsePositiveInt(keyParts.lote_id) || null,
    cantidad: 0,
  };

  current.cantidad += normalizedAmount;
  deltaMap.set(key, current);
}

function addMovementContributionDelta(deltaMap, movement, multiplier = 1) {
  const cantidad = Number(movement.cantidad || 0);
  if (!cantidad) return;

  const effects = getMovementEffects(movement.tipo_movimiento);
  if (effects.originDelta && movement.almacen_origen_id) {
    addStockDelta(
      deltaMap,
      {
        empresa_id: movement.empresa_id,
        almacen_id: movement.almacen_origen_id,
        sku_id: movement.sku_id,
        lote_id: movement.lote_id,
      },
      cantidad * effects.originDelta * multiplier,
    );
  }

  if (effects.destinationDelta && movement.almacen_destino_id) {
    addStockDelta(
      deltaMap,
      {
        empresa_id: movement.empresa_id,
        almacen_id: movement.almacen_destino_id,
        sku_id: movement.sku_id,
        lote_id: movement.lote_id,
      },
      cantidad * effects.destinationDelta * multiplier,
    );
  }
}

async function applyApprovedEntryStockDelta(
  executor,
  previousMovements,
  registro,
  usuarioId,
) {
  const deltaMap = new Map();

  previousMovements.forEach((movement) => {
    addMovementContributionDelta(deltaMap, movement, -1);
  });

  if (shouldApplyApprovedDestinationStock(registro)) {
    const detalles = Array.isArray(registro.detalles) ? registro.detalles : [];
    detalles.forEach((detail) => {
      addStockDelta(
        deltaMap,
        {
          empresa_id: registro.empresa_id,
          almacen_id: registro.almacen_destino_id,
          sku_id: detail.sku_id,
          lote_id: detail.lote_id,
        },
        Number(detail.cantidad || 0),
      );
    });
  }

  for (const delta of deltaMap.values()) {
    if (Math.abs(delta.cantidad) < STOCK_EPSILON) continue;
    await upsertStock(executor, delta);
  }

  await executor.query("DELETE FROM stock_movimientos WHERE registro_id=?", [
    registro.id,
  ]);

  if (shouldApplyApprovedDestinationStock(registro)) {
    const detalles = Array.isArray(registro.detalles) ? registro.detalles : [];
    for (const detail of detalles) {
      const cantidad = Number(detail.cantidad || 0);
      if (!cantidad) continue;
      await insertStockMovement(executor, {
        empresa_id: registro.empresa_id,
        registro_id: registro.id,
        registro_detalle_id: detail.id || null,
        almacen_origen_id: registro.almacen_origen_id,
        almacen_destino_id: registro.almacen_destino_id,
        sku_id: detail.sku_id,
        lote_id: detail.lote_id,
        cantidad,
        tipo_movimiento: "INGRESO_APROBADO",
        usuario_id: usuarioId || registro.usuario_id,
      });
    }
  }
}

function buildPreviousOriginRequirementsFromDetails(registro = {}) {
  const requiredByKey = new Map();
  const almacenOrigenId = parsePositiveInt(registro.almacen_origen_id);
  if (!almacenOrigenId) return requiredByKey;

  const detalles = Array.isArray(registro.detalles) ? registro.detalles : [];
  detalles.forEach((detail) => {
    const skuId = parsePositiveInt(detail.sku_id);
    const cantidad = Number(detail.cantidad || 0);
    if (!skuId || !cantidad) return;

    const loteKey = parsePositiveInt(detail.lote_id) || "sin-lote";
    const key = `${almacenOrigenId}|${skuId}|${loteKey}`;
    requiredByKey.set(key, Number(requiredByKey.get(key) || 0) + cantidad);
  });

  return requiredByKey;
}

async function buildPendingEditOriginRequirements(executor, registro = {}) {
  const requiredByKey = buildPreviousOriginRequirementsFromDetails(registro);
  const almacenOrigenId = parsePositiveInt(registro.almacen_origen_id);
  const registroId = parsePositiveInt(registro.id);
  if (!almacenOrigenId || !registroId) return requiredByKey;

  const [auditRows] = await executor.query(
    `SELECT detalle
     FROM audit_log
     WHERE tabla='registros'
       AND registro_id=?
       AND accion IN ('CREATE','UPDATE')
     ORDER BY id`,
    [registroId],
  );

  auditRows.forEach((row) => {
    const snapshot = parseAuditDetail(row.detalle);
    const detalles = Array.isArray(snapshot?.detalles) ? snapshot.detalles : [];
    detalles.forEach((detail) => {
      const skuId = parsePositiveInt(detail.sku_id);
      const cantidad = Number(detail.cantidad || 0);
      if (!skuId || !cantidad) return;

      const loteKey = parsePositiveInt(detail.lote_id) || "sin-lote";
      const key = `${almacenOrigenId}|${skuId}|${loteKey}`;
      requiredByKey.set(key, Math.max(Number(requiredByKey.get(key) || 0), cantidad));
    });
  });

  return requiredByKey;
}

async function insertApprovedRegistroChange(
  executor,
  {
    registroId,
    empresaId,
    accion,
    usuarioId,
    motivo = null,
    snapshotAntes = null,
    snapshotDespues = null,
    movimientosAntes = null,
    movimientosDespues = null,
  },
) {
  await executor.query(
    `INSERT INTO registro_aprobado_cambios
     (registro_id, empresa_id, accion, usuario_id, motivo, snapshot_antes, snapshot_despues, movimientos_antes, movimientos_despues)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      registroId,
      empresaId || null,
      accion,
      usuarioId || null,
      motivo || null,
      snapshotAntes ? JSON.stringify(snapshotAntes) : null,
      snapshotDespues ? JSON.stringify(snapshotDespues) : null,
      movimientosAntes ? JSON.stringify(movimientosAntes) : null,
      movimientosDespues ? JSON.stringify(movimientosDespues) : null,
    ],
  );
}

async function insertDeletedRegistroBackup(
  executor,
  {
    registro,
    usuarioId,
    motivo = null,
    movimientos = [],
    stockReversion = [],
  },
) {
  await executor.query(
    `INSERT INTO eliminado_registros
     (registro_id, empresa_id, eliminado_por, motivo, registro_snapshot, detalles_snapshot, movimientos_snapshot, stock_reversion_snapshot)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      registro.id,
      registro.empresa_id || null,
      usuarioId || null,
      motivo || null,
      JSON.stringify(registro),
      JSON.stringify(registro.detalles || []),
      JSON.stringify(movimientos || []),
      JSON.stringify(stockReversion || []),
    ],
  );
}

async function registroHasStockMovements(executor, registroId) {
  const [[row]] = await executor.query(
    "SELECT EXISTS(SELECT 1 FROM stock_movimientos WHERE registro_id=? LIMIT 1) AS has_movimientos",
    [registroId],
  );
  return !!row?.has_movimientos;
}

function ensureEstadoTransitionAllowed(actual, next) {
  if (actual === next) return;

  const allowedTransitions = {
    pendiente: ["en_transito", "aprobado", "rechazado"],
    en_transito: ["aprobado", "rechazado"],
    rechazado: [],
    aprobado: [],
  };

  if (!allowedTransitions[actual]?.includes(next)) {
    const error = new Error(`No se puede pasar de ${actual} a ${next}`);
    error.statusCode = 400;
    throw error;
  }
}

async function applyApprovalStock(executor, registro, options = {}) {
  const detalles = Array.isArray(registro.detalles) ? registro.detalles : [];
  if (!detalles.length) return;

  const isMolitaliaEntry = isTgMolitaliaIndicator(
    registro.indicador_nombre || registro.indicador || "",
  );

  if (!isMolitaliaEntry && !isEntradaRegistro(registro)) {
    await applyStockMovementBatch(
      executor,
      registro,
      "SALIDA_TRANSITO",
      registro.aprobado_por || registro.usuario_id,
      options,
    );
  }

  if (shouldApplyApprovedDestinationStock(registro)) {
    await applyStockMovementBatch(
      executor,
      registro,
      "INGRESO_APROBADO",
      registro.aprobado_por || registro.usuario_id,
    );
  }
}

async function reverseApprovalStock(executor, registro) {
  await reverseRecordedStockMovements(executor, registro.id);
}

function buildHeaderValues(payload, detalles) {
  const firstDetail = detalles[0] || {};
  const totalCantidad = detalles.reduce(
    (acc, detail) => acc + Number(detail.cantidad || 0),
    0,
  );

  return {
    fecha: payload.fecha,
    ciudad_id: payload.ciudad_id,
    almacen_origen_id: payload.almacen_origen_id,
    almacen_destino_id: payload.almacen_destino_id,
    categoria_id: payload.categoria_id,
    accion: payload.accion,
    tipo_accion: payload.tipo_accion,
    personal_receptor_id: payload.personal_receptor_id,
    indicador_id: payload.indicador_id,
    tipo_mercaderia_id: firstDetail.tipo_mercaderia_id || null,
    sku_id: firstDetail.sku_id || null,
    lote_id: firstDetail.lote_id || null,
    fecha_vencimiento: firstDetail.fecha_vencimiento || null,
    cantidad: totalCantidad,
    nro_guia: payload.nro_guia,
    observaciones: payload.observaciones,
  };
}

async function syncRegistroDetails(executor, registroId, detalles) {
  await executor.query("DELETE FROM registro_detalles WHERE registro_id=?", [
    registroId,
  ]);
  if (!detalles.length) return;

  const values = [];
  const placeholders = detalles
    .map((detail) => {
      values.push(
        registroId,
        detail.tipo_mercaderia_id,
        detail.sku_id,
        detail.lote_id,
        detail.fecha_vencimiento,
        detail.cantidad,
      );
      return "(?,?,?,?,?,?)";
    })
    .join(",");

  await executor.query(
    `INSERT INTO registro_detalles
     (registro_id, tipo_mercaderia_id, sku_id, lote_id, fecha_vencimiento, cantidad)
     VALUES ${placeholders}`,
    values,
  );
}

async function persistMissingLoteDates(executor, details) {
  const pendingUpdates = new Map();

  details.forEach((detail) => {
    if (
      detail.should_update_lote_fecha &&
      detail.lote_id &&
      detail.fecha_vencimiento
    ) {
      pendingUpdates.set(detail.lote_id, detail.fecha_vencimiento);
    }
  });

  for (const [loteId, fechaVencimiento] of pendingUpdates.entries()) {
    await executor.query(
      'UPDATE lotes SET fecha_vencimiento=? WHERE id=? AND (fecha_vencimiento IS NULL OR fecha_vencimiento="")',
      [fechaVencimiento, loteId],
    );
  }
}

async function updateRegistroHeaderAndDetails(
  executor,
  registroId,
  headerValues,
  detalles,
) {
  await executor.query(
    `UPDATE registros SET
       fecha=?,
       ciudad_id=?,
       almacen_origen_id=?,
       almacen_destino_id=?,
       categoria_id=?,
       accion=?,
       tipo_accion=?,
       personal_receptor_id=?,
       indicador_id=?,
       tipo_mercaderia_id=?,
       sku_id=?,
       lote_id=?,
       fecha_vencimiento=?,
       cantidad=?,
       nro_guia=?,
       observaciones=?
     WHERE id=?`,
    [
      headerValues.fecha,
      headerValues.ciudad_id,
      headerValues.almacen_origen_id,
      headerValues.almacen_destino_id,
      headerValues.categoria_id,
      headerValues.accion,
      headerValues.tipo_accion,
      headerValues.personal_receptor_id,
      headerValues.indicador_id,
      headerValues.tipo_mercaderia_id,
      headerValues.sku_id,
      headerValues.lote_id,
      headerValues.fecha_vencimiento,
      headerValues.cantidad,
      headerValues.nro_guia,
      headerValues.observaciones,
      registroId,
    ],
  );

  await syncRegistroDetails(executor, registroId, detalles);
  await persistMissingLoteDates(executor, detalles);
}

async function validateRegistroPayloadV2(
  executor,
  req,
  payload,
  {
    currentFotoGuia = null,
    previousOriginRequirements = new Map(),
    skipStockAvailability = false,
  } = {},
) {
  if (!isValidDateInput(payload.fecha)) {
    throw new Error("Fecha invalida");
  }
  if (!ZONAS.includes(payload.zona)) {
    throw new Error("Zona invalida");
  }
  if (!ACCIONES.includes(payload.accion)) {
    throw new Error("Accion invalida");
  }
  if (!TIPOS_ACCION.includes(payload.tipo_accion)) {
    throw new Error("Tipo de accion invalido");
  }

  const ciudadId = parsePositiveInt(payload.ciudad_id);
  const almacenOrigenId = parsePositiveInt(payload.almacen_origen_id);
  const almacenDestinoId = parsePositiveInt(payload.almacen_destino_id);
  const categoriaId = parsePositiveInt(payload.categoria_id);
  const personalReceptorId = parsePositiveInt(payload.personal_receptor_id);
  const indicadorId = parsePositiveInt(payload.indicador_id);

  if (!ciudadId) throw new Error("Ciudad requerida");
  if (!almacenOrigenId) throw new Error("Almacen origen requerido");
  if (!almacenDestinoId) throw new Error("Almacen destino requerido");
  if (!categoriaId) throw new Error("Categoria requerida");
  if (!personalReceptorId) throw new Error("Personal receptor requerido");
  if (!indicadorId) throw new Error("Indicador requerido");
  if (!normalizeOptionalString(payload.nro_guia))
    throw new Error("Numero de guia requerido");
  if (!req.file && !currentFotoGuia) throw new Error("Foto guia requerida");

  if (!Array.isArray(payload.detalles) || !payload.detalles.length) {
    throw new Error("Debe registrar al menos una linea de detalle");
  }

  const scope = await getWarehouseScope(req, "r", executor);
  if (
    scope.ids.length &&
    !scope.ids.some((id) => id === almacenOrigenId || id === almacenDestinoId)
  ) {
    const error = new Error(
      "El registro no pertenece a tus almacenes asignados",
    );
    error.statusCode = 403;
    throw error;
  }

  let cityQuery = `SELECT c.id, c.nombre,
                          CASE WHEN UPPER(c.nombre)='LIMA' THEN 'LIMA' ELSE 'PROVINCIA' END AS zona
                   FROM ciudades c
                   JOIN regiones r ON r.id = c.region_id
                   WHERE c.id=? AND c.activo=1`;
  const cityParams = [ciudadId];
  if (req.empresa_id) {
    cityQuery += " AND r.empresa_id=?";
    cityParams.push(req.empresa_id);
  }
  const [cityRows] = await executor.query(cityQuery, cityParams);
  const city = cityRows[0];
  if (!city) throw new Error("Ciudad no encontrada");
  if (city.zona !== payload.zona) {
    throw new Error("La ciudad seleccionada no pertenece a la zona indicada");
  }

  const warehouseIds = [...new Set([almacenOrigenId, almacenDestinoId])];
  const warehousePlaceholders = warehouseIds.map(() => "?").join(",");
  let warehouseQuery = `SELECT a.id, a.nombre, a.ciudad_id,
                               CASE WHEN UPPER(c.nombre)='LIMA' THEN 'LIMA' ELSE 'PROVINCIA' END AS zona
                        FROM almacenes a
                        JOIN ciudades c ON c.id = a.ciudad_id
                        JOIN regiones r ON r.id = c.region_id
                        WHERE a.id IN (${warehousePlaceholders}) AND a.activo=1`;
  const warehouseParams = [...warehouseIds];
  if (req.empresa_id) {
    warehouseQuery += " AND r.empresa_id=?";
    warehouseParams.push(req.empresa_id);
  }
  const [warehouseRows] = await executor.query(warehouseQuery, warehouseParams);
  const warehouseMap = new Map(
    warehouseRows.map((row) => [Number(row.id), row]),
  );
  if (!warehouseMap.has(almacenOrigenId))
    throw new Error("Almacen origen no encontrado");
  if (!warehouseMap.has(almacenDestinoId))
    throw new Error("Almacen destino no encontrado");
  if (Number(warehouseMap.get(almacenOrigenId).ciudad_id) !== ciudadId) {
    throw new Error("El almacen origen no pertenece a la ciudad seleccionada");
  }
  if (
    String(warehouseMap.get(almacenDestinoId).zona || "").toUpperCase() !==
    payload.zona
  ) {
    throw new Error("El almacen destino no pertenece a la zona seleccionada");
  }

  let categoryQuery = "SELECT id FROM categorias WHERE id=? AND activo=1";
  const categoryParams = [categoriaId];
  if (req.empresa_id) {
    categoryQuery += " AND empresa_id=?";
    categoryParams.push(req.empresa_id);
  }
  const [categoryRows] = await executor.query(categoryQuery, categoryParams);
  if (!categoryRows.length) throw new Error("Categoria no encontrada");

  let indicatorQuery =
    "SELECT id, nombre FROM indicadores WHERE id=? AND activo=1";
  const indicatorParams = [indicadorId];
  if (req.empresa_id) {
    indicatorQuery += " AND empresa_id=?";
    indicatorParams.push(req.empresa_id);
  }
  const [indicatorRows] = await executor.query(indicatorQuery, indicatorParams);
  if (!indicatorRows.length) throw new Error("Indicador no encontrado");
  const indicator = indicatorRows[0];
  const isMolitaliaEntry = isTgMolitaliaIndicator(indicator.nombre);

  console.log(
    "[DEBUG] Indicador:",
    indicator.nombre,
    "| Normalizado:",
    normalizeLookupText(indicator.nombre),
    "| isMolitalia:",
    isMolitaliaEntry,
    "| tipoAccion:",
    payload.tipo_accion,
    "| origen:",
    almacenOrigenId,
    "| destino:",
    almacenDestinoId,
  );

  if (
    isMolitaliaEntry &&
    String(payload.tipo_accion || "").toUpperCase() !== "ENTRADA"
  ) {
    throw new Error("Para TG MOLITALIA el tipo de acción debe ser ENTRADA");
  }
  if (isMolitaliaEntry && almacenOrigenId !== almacenDestinoId) {
    throw new Error(
      "Para TG MOLITALIA el almacén destino debe ser igual al almacén origen",
    );
  }

  const allowedPersonalWarehouseIds = [
    ...new Set([almacenOrigenId, almacenDestinoId]),
  ];
  let personalQuery = `SELECT id
                       FROM personal_receptor
                       WHERE id=? AND activo=1
                         AND almacen_id IN (${allowedPersonalWarehouseIds.map(() => "?").join(",")})
                         AND categoria_id=?`;
  const personalParams = [
    personalReceptorId,
    ...allowedPersonalWarehouseIds,
    categoriaId,
  ];
  if (req.empresa_id) {
    personalQuery += " AND empresa_id=?";
    personalParams.push(req.empresa_id);
  }
  const [personalRows] = await executor.query(personalQuery, personalParams);
  if (!personalRows.length) {
    throw new Error(
      "El personal receptor debe pertenecer al almacen origen o destino y a la categoria seleccionada",
    );
  }

  const normalizedDetails = [];
  const typeIds = [];
  const skuIds = [];
  const loteIds = [];

  payload.detalles.forEach((detail) => {
    if (detail?.tipo_mercaderia_id)
      typeIds.push(Number(detail.tipo_mercaderia_id));
    if (detail?.sku_id) skuIds.push(Number(detail.sku_id));
    if (detail?.lote_id) loteIds.push(Number(detail.lote_id));
  });

  const uniqueTypeIds = [...new Set(typeIds.filter(Boolean))];
  const uniqueSkuIds = [...new Set(skuIds.filter(Boolean))];
  const uniqueLoteIds = [...new Set(loteIds.filter(Boolean))];

  let typesMap = new Map();
  if (uniqueTypeIds.length) {
    const [typeRows] = await executor.query(
      `SELECT id, categoria_id, nombre
       FROM tipos_mercaderia
       WHERE id IN (${uniqueTypeIds.map(() => "?").join(",")}) AND activo=1`,
      uniqueTypeIds,
    );
    typesMap = new Map(typeRows.map((row) => [Number(row.id), row]));
  }

  let skuMap = new Map();
  if (uniqueSkuIds.length) {
    let skuQuery = `SELECT *
                    FROM skus
                    WHERE id IN (${uniqueSkuIds.map(() => "?").join(",")}) AND activo=1`;
    const skuParams = [...uniqueSkuIds];
    if (req.empresa_id) {
      skuQuery += " AND empresa_id=?";
      skuParams.push(req.empresa_id);
    }
    const [skuRows] = await executor.query(skuQuery, skuParams);
    skuMap = new Map(skuRows.map((row) => [Number(row.id), row]));
  }

  let loteMap = new Map();
  if (uniqueLoteIds.length) {
    let loteQuery = `SELECT l.*, s.empresa_id
                     FROM lotes l
                     JOIN skus s ON s.id = l.sku_id
                     WHERE l.id IN (${uniqueLoteIds.map(() => "?").join(",")}) AND l.activo=1`;
    const loteParams = [...uniqueLoteIds];
    if (req.empresa_id) {
      loteQuery += " AND s.empresa_id=?";
      loteParams.push(req.empresa_id);
    }
    const [loteRows] = await executor.query(loteQuery, loteParams);
    loteMap = new Map(loteRows.map((row) => [Number(row.id), row]));
  }

  payload.detalles.forEach((detail, index) => {
    const lineNumber = index + 1;
    const tipoMercaderiaId = parsePositiveInt(detail?.tipo_mercaderia_id);
    const skuId = parsePositiveInt(detail?.sku_id);
    const loteId = parsePositiveInt(detail?.lote_id);
    const cantidad = parsePositiveInt(detail?.cantidad);

    if (!tipoMercaderiaId)
      throw new Error(`Tipo de mercaderia requerido en la linea ${lineNumber}`);
    if (!skuId) throw new Error(`SKU requerido en la linea ${lineNumber}`);
    if (!cantidad)
      throw new Error(`Cantidad invalida en la linea ${lineNumber}`);

    const type = typesMap.get(tipoMercaderiaId);
    if (!type || Number(type.categoria_id) !== categoriaId) {
      throw new Error(`Tipo de mercaderia invalido en la linea ${lineNumber}`);
    }

    const sku = skuMap.get(skuId);
    if (!sku || Number(sku.categoria_id) !== categoriaId) {
      throw new Error(`SKU invalido en la linea ${lineNumber}`);
    }

    const skuManejaLote = parseFlag(sku.tiene_lote);
    const skuManejaVencimiento = parseFlag(sku.tiene_vencimiento);

    if (sku.zona !== payload.zona) {
      throw new Error(
        `El SKU de la linea ${lineNumber} no pertenece a la zona seleccionada`,
      );
    }
    if (
      sku.tipo_mercaderia_id &&
      Number(sku.tipo_mercaderia_id) !== tipoMercaderiaId
    ) {
      throw new Error(
        `El SKU de la linea ${lineNumber} no corresponde al tipo de mercaderia elegido`,
      );
    }

    let lote = null;
    let resolvedDate = null;

    if (skuManejaLote) {
      if (!loteId) {
        throw new Error(`Lote requerido en la linea ${lineNumber}`);
      }

      lote = loteMap.get(loteId);
      if (!lote || Number(lote.sku_id) !== skuId) {
        throw new Error(
          `El lote de la linea ${lineNumber} no pertenece al SKU seleccionado`,
        );
      }

      resolvedDate = normalizeDateInputValue(lote.fecha_vencimiento);
      if (skuManejaVencimiento) {
        if (!resolvedDate || !isValidDateInput(resolvedDate)) {
          throw new Error(
            `El lote de la linea ${lineNumber} debe tener fecha de vencimiento`,
          );
        }
      } else if (resolvedDate && !isValidDateInput(resolvedDate)) {
        throw new Error(
          `La fecha de vencimiento del lote en la linea ${lineNumber} no es valida`,
        );
      }
    }

    normalizedDetails.push({
      tipo_mercaderia_id: tipoMercaderiaId,
      tipo_mercaderia_nombre: type.nombre,
      sku_id: skuId,
      sku_nombre: sku.nombre,
      lote_id: skuManejaLote ? loteId : null,
      codigo_lote: lote?.codigo_lote || "",
      fecha_vencimiento: resolvedDate,
      cantidad,
      should_update_lote_fecha: false,
    });
  });

  if (
    !isMolitaliaEntry &&
    !isEntradaRegistro(payload) &&
    !skipStockAvailability
  ) {
    await ensureStockAvailabilityForBatch(
      executor,
      {
        empresa_id: req.empresa_id,
        almacen_origen_id: almacenOrigenId,
        almacen_origen:
          warehouseMap.get(almacenOrigenId)?.nombre ||
          `almacen ${almacenOrigenId}`,
        detalles: normalizedDetails,
      },
      "SALIDA_TRANSITO",
      { previousRequiredByKey: previousOriginRequirements },
    );
  }

  return {
    ...payload,
    ciudad_id: ciudadId,
    almacen_origen_id: almacenOrigenId,
    almacen_destino_id: almacenDestinoId,
    categoria_id: categoriaId,
    personal_receptor_id: personalReceptorId,
    indicador_id: indicadorId,
    nro_guia: normalizeOptionalString(payload.nro_guia),
    observaciones: normalizeOptionalString(payload.observaciones),
    detalles: normalizedDetails,
  };
}

async function validateRegistroPayload(
  executor,
  req,
  payload,
  {
    currentFotoGuia = null,
    previousOriginRequirements = new Map(),
    skipStockAvailability = false,
  } = {},
) {
  return validateRegistroPayloadV2(executor, req, payload, {
    currentFotoGuia,
    previousOriginRequirements,
    skipStockAvailability,
  });
  if (!isValidDateInput(payload.fecha)) {
    throw new Error("Fecha inválida");
  }
  if (!ZONAS.includes(payload.zona)) {
    throw new Error("Zona inválida");
  }
  if (!ACCIONES.includes(payload.accion)) {
    throw new Error("Acción inválida");
  }
  if (!TIPOS_ACCION.includes(payload.tipo_accion)) {
    throw new Error("Tipo de acción inválido");
  }

  const ciudadId = parsePositiveInt(payload.ciudad_id);
  const almacenOrigenId = parsePositiveInt(payload.almacen_origen_id);
  const almacenDestinoId = parsePositiveInt(payload.almacen_destino_id);
  const categoriaId = parsePositiveInt(payload.categoria_id);
  const personalReceptorId = parsePositiveInt(payload.personal_receptor_id);
  const indicadorId = parsePositiveInt(payload.indicador_id);

  if (!ciudadId) throw new Error("Ciudad requerida");
  if (!almacenOrigenId) throw new Error("Almacén origen requerido");
  if (!almacenDestinoId) throw new Error("Almacén destino requerido");
  if (!categoriaId) throw new Error("Categoría requerida");
  if (!personalReceptorId) throw new Error("Personal receptor requerido");
  if (!indicadorId) throw new Error("Indicador requerido");
  if (!normalizeOptionalString(payload.nro_guia))
    throw new Error("Número de guía requerido");
  if (!req.file && !currentFotoGuia) throw new Error("Foto guía requerida");

  if (!Array.isArray(payload.detalles) || !payload.detalles.length) {
    throw new Error("Debe registrar al menos una línea de detalle");
  }

  const scope = await getWarehouseScope(req, "r", executor);
  if (
    scope.ids.length &&
    !scope.ids.some((id) => id === almacenOrigenId || id === almacenDestinoId)
  ) {
    const error = new Error(
      "El registro no pertenece a tus almacenes asignados",
    );
    error.statusCode = 403;
    throw error;
  }

  let cityQuery = `SELECT c.id, c.nombre,
                      ${getZonaExpr("c")} AS zona
                   FROM ciudades c
                   JOIN regiones r ON r.id = c.region_id
                   WHERE c.id=? AND c.activo=1`;
  const cityParams = [ciudadId];
  if (req.empresa_id) {
    cityQuery += " AND r.empresa_id=?";
    cityParams.push(req.empresa_id);
  }
  const [cityRows] = await executor.query(cityQuery, cityParams);
  const city = cityRows[0];
  if (!city) throw new Error("Ciudad no encontrada");
  if (city.zona !== payload.zona) {
    throw new Error("La ciudad seleccionada no pertenece a la zona indicada");
  }

  const warehouseIds = [...new Set([almacenOrigenId, almacenDestinoId])];
  const warehousePlaceholders = warehouseIds.map(() => "?").join(",");
  let warehouseQuery = `SELECT a.id, a.ciudad_id
                        FROM almacenes a
                        JOIN ciudades c ON c.id = a.ciudad_id
                        JOIN regiones r ON r.id = c.region_id
                        WHERE a.id IN (${warehousePlaceholders}) AND a.activo=1`;
  const warehouseParams = [...warehouseIds];
  if (req.empresa_id) {
    warehouseQuery += " AND r.empresa_id=?";
    warehouseParams.push(req.empresa_id);
  }
  const [warehouseRows] = await executor.query(warehouseQuery, warehouseParams);
  const warehouseMap = new Map(
    warehouseRows.map((row) => [Number(row.id), row]),
  );
  if (!warehouseMap.has(almacenOrigenId))
    throw new Error("Almacén origen no encontrado");
  if (!warehouseMap.has(almacenDestinoId))
    throw new Error("Almacén destino no encontrado");
  if (Number(warehouseMap.get(almacenOrigenId).ciudad_id) !== ciudadId) {
    throw new Error("El almacén origen no pertenece a la ciudad seleccionada");
  }
  if (Number(warehouseMap.get(almacenDestinoId).ciudad_id) !== ciudadId) {
    throw new Error("El almacén destino no pertenece a la ciudad seleccionada");
  }

  let categoryQuery = "SELECT id FROM categorias WHERE id=? AND activo=1";
  const categoryParams = [categoriaId];
  if (req.empresa_id) {
    categoryQuery += " AND empresa_id=?";
    categoryParams.push(req.empresa_id);
  }
  const [categoryRows] = await executor.query(categoryQuery, categoryParams);
  if (!categoryRows.length) throw new Error("Categoría no encontrada");

  let indicatorQuery =
    "SELECT id, nombre FROM indicadores WHERE id=? AND activo=1";
  const indicatorParams = [indicadorId];
  if (req.empresa_id) {
    indicatorQuery += " AND empresa_id=?";
    indicatorParams.push(req.empresa_id);
  }
  const [indicatorRows] = await executor.query(indicatorQuery, indicatorParams);
  if (!indicatorRows.length) throw new Error("Indicador no encontrado");

  let personalQuery =
    "SELECT id FROM personal_receptor WHERE id=? AND activo=1 AND almacen_id=? AND categoria_id=?";
  const personalParams = [personalReceptorId, almacenDestinoId, categoriaId];
  if (req.empresa_id) {
    personalQuery += " AND empresa_id=?";
    personalParams.push(req.empresa_id);
  }
  const [personalRows] = await executor.query(personalQuery, personalParams);
  if (!personalRows.length) {
    throw new Error(
      "El personal receptor debe pertenecer al almacén destino y a la categoría seleccionada",
    );
  }

  const normalizedDetails = [];
  const typeIds = [];
  const skuIds = [];
  const loteIds = [];

  payload.detalles.forEach((detail) => {
    if (detail?.tipo_mercaderia_id)
      typeIds.push(Number(detail.tipo_mercaderia_id));
    if (detail?.sku_id) skuIds.push(Number(detail.sku_id));
    if (detail?.lote_id) loteIds.push(Number(detail.lote_id));
  });

  const uniqueTypeIds = [...new Set(typeIds.filter(Boolean))];
  const uniqueSkuIds = [...new Set(skuIds.filter(Boolean))];
  const uniqueLoteIds = [...new Set(loteIds.filter(Boolean))];

  let typesMap = new Map();
  if (uniqueTypeIds.length) {
    let typeQuery = `SELECT id, categoria_id, nombre
                     FROM tipos_mercaderia
                     WHERE id IN (${uniqueTypeIds.map(() => "?").join(",")}) AND activo=1`;
    const typeParams = [...uniqueTypeIds];
    const [typeRows] = await executor.query(typeQuery, typeParams);
    typesMap = new Map(typeRows.map((row) => [Number(row.id), row]));
  }

  let skuMap = new Map();
  if (uniqueSkuIds.length) {
    let skuQuery = `SELECT *
                    FROM skus
                    WHERE id IN (${uniqueSkuIds.map(() => "?").join(",")}) AND activo=1`;
    const skuParams = [...uniqueSkuIds];
    if (req.empresa_id) {
      skuQuery += " AND empresa_id=?";
      skuParams.push(req.empresa_id);
    }
    const [skuRows] = await executor.query(skuQuery, skuParams);
    skuMap = new Map(skuRows.map((row) => [Number(row.id), row]));
  }

  let loteMap = new Map();
  if (uniqueLoteIds.length) {
    let loteQuery = `SELECT l.*, s.empresa_id
                     FROM lotes l
                     JOIN skus s ON s.id = l.sku_id
                     WHERE l.id IN (${uniqueLoteIds.map(() => "?").join(",")}) AND l.activo=1`;
    const loteParams = [...uniqueLoteIds];
    if (req.empresa_id) {
      loteQuery += " AND s.empresa_id=?";
      loteParams.push(req.empresa_id);
    }
    const [loteRows] = await executor.query(loteQuery, loteParams);
    loteMap = new Map(loteRows.map((row) => [Number(row.id), row]));
  }

  payload.detalles.forEach((detail, index) => {
    const lineNumber = index + 1;
    const tipoMercaderiaId = parsePositiveInt(detail?.tipo_mercaderia_id);
    const skuId = parsePositiveInt(detail?.sku_id);
    const loteId = parsePositiveInt(detail?.lote_id);
    const cantidad = parsePositiveInt(detail?.cantidad);

    if (!tipoMercaderiaId)
      throw new Error(`Tipo de mercadería requerido en la línea ${lineNumber}`);
    if (!skuId) throw new Error(`SKU requerido en la línea ${lineNumber}`);
    if (!loteId) throw new Error(`Lote requerido en la línea ${lineNumber}`);
    if (!cantidad)
      throw new Error(`Cantidad inválida en la línea ${lineNumber}`);

    const type = typesMap.get(tipoMercaderiaId);
    if (!type || Number(type.categoria_id) !== categoriaId) {
      throw new Error(`Tipo de mercadería inválido en la línea ${lineNumber}`);
    }

    const sku = skuMap.get(skuId);
    if (!sku || Number(sku.categoria_id) !== categoriaId) {
      throw new Error(`SKU inválido en la línea ${lineNumber}`);
    }
    if (sku.zona !== payload.zona) {
      throw new Error(
        `El SKU de la línea ${lineNumber} no pertenece a la zona seleccionada`,
      );
    }
    if (
      sku.tipo_mercaderia_id &&
      Number(sku.tipo_mercaderia_id) !== tipoMercaderiaId
    ) {
      throw new Error(
        `El SKU de la línea ${lineNumber} no corresponde al tipo de mercadería elegido`,
      );
    }

    const lote = loteMap.get(loteId);
    if (!lote || Number(lote.sku_id) !== skuId) {
      throw new Error(
        `El lote de la línea ${lineNumber} no pertenece al SKU seleccionado`,
      );
    }

    const incomingDate = normalizeOptionalString(detail?.fecha_vencimiento);
    const resolvedDate = lote.fecha_vencimiento || incomingDate;
    if (!resolvedDate || !isValidDateInput(resolvedDate)) {
      throw new Error(
        `Fecha de vencimiento requerida en la línea ${lineNumber}`,
      );
    }

    normalizedDetails.push({
      tipo_mercaderia_id: tipoMercaderiaId,
      tipo_mercaderia_nombre: type.nombre,
      sku_id: skuId,
      sku_nombre: sku.nombre,
      lote_id: loteId,
      codigo_lote: lote.codigo_lote,
      fecha_vencimiento: resolvedDate,
      cantidad,
      should_update_lote_fecha: !lote.fecha_vencimiento && !!incomingDate,
    });
  });

  return {
    ...payload,
    ciudad_id: ciudadId,
    almacen_origen_id: almacenOrigenId,
    almacen_destino_id: almacenDestinoId,
    categoria_id: categoriaId,
    personal_receptor_id: personalReceptorId,
    indicador_id: indicadorId,
    nro_guia: normalizeOptionalString(payload.nro_guia),
    observaciones: normalizeOptionalString(payload.observaciones),
    detalles: normalizedDetails,
  };
}

async function validateStockInitializationPayload(
  executor,
  req,
  payload = {},
  { allowZeroQuantity = false, lookupContext = null, rowNumber = null } = {},
) {
  const suffix = formatRowSuffix(rowNumber);
  const almacenId = parsePositiveInt(payload.almacen_id);
  const almacenNombre = normalizeOptionalString(
    payload.almacen || payload.almacen_nombre,
  );
  const categoriaId = parsePositiveInt(payload.categoria_id);
  const categoriaNombre = normalizeOptionalString(
    payload.categoria || payload.categoria_nombre,
  );
  const skuId = parsePositiveInt(payload.sku_id);
  const skuNombre = normalizeOptionalString(
    payload.sku || payload.sku_nombre || payload.nombre,
  );
  const loteId = parsePositiveInt(payload.lote_id);
  const rawCantidad = Number(payload.cantidad);
  const cantidad =
    Number.isInteger(rawCantidad) && rawCantidad >= (allowZeroQuantity ? 0 : 1)
      ? rawCantidad
      : null;
  const observaciones = normalizeOptionalString(payload.observaciones);
  const codigoLote = normalizeOptionalString(
    payload.codigo_lote || payload.lote,
  );
  const fechaVencimientoInput = normalizeDateInputValue(
    payload.fecha_vencimiento,
  );

  if (!almacenId && !almacenNombre)
    throw new Error(`Almacen requerido${suffix}`);
  if (
    hasSpreadsheetValue(payload.categoria_id) &&
    !categoriaId &&
    !categoriaNombre
  ) {
    throw new Error(`Categoria invalida${suffix}`);
  }
  if (!skuId && !skuNombre) throw new Error(`SKU requerido${suffix}`);
  if (cantidad === null) throw new Error(`Cantidad invalida${suffix}`);

  const context =
    lookupContext || (await loadStockInitialLookupContext(executor, req));
  const {
    warehouses,
    categories,
    skus,
    duplicateWarehouseNames,
    duplicateSkuNames,
  } = context;

  const warehouse = almacenId
    ? warehouses.find((item) => Number(item.id) === Number(almacenId))
    : resolveSingleSheetMatch(warehouses, {
        value: almacenNombre,
        rowNumber,
        entityLabel: "almacenes",
        getMatchValues: [
          (item) => item.nombre,
          (item) => buildWarehouseReferenceLabel(item, duplicateWarehouseNames),
        ],
        describeRow: describeWarehouse,
      });

  if (!warehouse) {
    throw new Error(`Almacen no encontrado${suffix}`);
  }

  const categoria = categoriaId
    ? categories.find((item) => Number(item.id) === Number(categoriaId))
    : categoriaNombre
      ? resolveSingleSheetMatch(categories, {
          value: categoriaNombre,
          rowNumber,
          entityLabel: "categorias",
          getMatchValues: [(item) => item.nombre],
          describeRow: (item) => item.nombre || "",
        })
      : null;

  if ((categoriaId || categoriaNombre) && !categoria) {
    throw new Error(`Categoria no encontrada${suffix}`);
  }

  const zoneScopedSkus = skus.filter(
    (item) =>
      String(item.zona || "").toUpperCase() ===
      String(warehouse.zona || "").toUpperCase(),
  );
  const categoriaScopedSkus = categoria
    ? zoneScopedSkus.filter(
        (item) => Number(item.categoria_id) === Number(categoria.id),
      )
    : zoneScopedSkus;

  const sku = skuId
    ? skus.find((item) => Number(item.id) === Number(skuId))
    : resolveSingleSheetMatch(categoriaScopedSkus, {
        value: skuNombre,
        rowNumber,
        entityLabel: "SKUs",
        getMatchValues: [
          (item) => item.nombre,
          (item) => buildStockSkuReferenceLabel(item, duplicateSkuNames),
        ],
        describeRow: describeStockSku,
      });

  if (!sku) {
    throw new Error(`SKU no encontrado${suffix}`);
  }
  if (categoria && Number(sku.categoria_id) !== Number(categoria.id)) {
    throw new Error(`El SKU no pertenece a la categoria seleccionada${suffix}`);
  }
  if (
    String(sku.zona || "").toUpperCase() !==
    String(warehouse.zona || "").toUpperCase()
  ) {
    throw new Error(
      `El SKU no pertenece a la zona del almacen seleccionado${suffix}`,
    );
  }

  const categoriaFinal = categoria ||
    categories.find((item) => Number(item.id) === Number(sku.categoria_id)) || {
      id: Number(sku.categoria_id),
      nombre: sku.categoria_nombre || "",
    };

  const skuManejaLote = parseFlag(sku.tiene_lote);
  const skuManejaVencimiento = parseFlag(sku.tiene_vencimiento);
  let lote = null;
  let shouldCreateLote = false;
  let shouldReactivateLote = false;
  let shouldUpdateLoteFecha = false;
  let resolvedFechaVencimiento = null;

  if (skuManejaLote) {
    if (loteId) {
      let loteQuery = `SELECT
          l.id,
          l.sku_id,
          l.codigo_lote,
          l.fecha_vencimiento,
          l.activo
        FROM lotes l
        JOIN skus s ON s.id = l.sku_id
        WHERE l.id=? AND l.sku_id=?`;
      const loteParams = [loteId, sku.id];
      if (req.empresa_id) {
        loteQuery += " AND s.empresa_id=?";
        loteParams.push(req.empresa_id);
      }
      const [loteRows] = await executor.query(loteQuery, loteParams);
      lote = loteRows[0];

      if (!lote || !parseFlag(lote.activo)) {
        throw new Error(`El lote seleccionado no esta disponible${suffix}`);
      }

      const existingFechaVencimiento = normalizeDateInputValue(
        lote.fecha_vencimiento,
      );
      resolvedFechaVencimiento =
        fechaVencimientoInput || existingFechaVencimiento;
      shouldUpdateLoteFecha =
        !!fechaVencimientoInput &&
        fechaVencimientoInput !== existingFechaVencimiento;
    } else if (codigoLote) {
      let loteCodigoQuery = `SELECT
          l.id,
          l.sku_id,
          l.codigo_lote,
          l.fecha_vencimiento,
          l.activo
        FROM lotes l
        JOIN skus s ON s.id = l.sku_id
        WHERE l.sku_id=? AND l.codigo_lote=?`;
      const loteCodigoParams = [sku.id, codigoLote];
      if (req.empresa_id) {
        loteCodigoQuery += " AND s.empresa_id=?";
        loteCodigoParams.push(req.empresa_id);
      }
      loteCodigoQuery += " LIMIT 1";
      const [existingLoteRows] = await executor.query(
        loteCodigoQuery,
        loteCodigoParams,
      );
      lote = existingLoteRows[0] || null;

      if (lote) {
        shouldReactivateLote = !parseFlag(lote.activo);
        const existingFechaVencimiento = normalizeDateInputValue(
          lote.fecha_vencimiento,
        );
        resolvedFechaVencimiento =
          fechaVencimientoInput || existingFechaVencimiento;
        shouldUpdateLoteFecha =
          !!fechaVencimientoInput &&
          fechaVencimientoInput !== existingFechaVencimiento;
      } else {
        shouldCreateLote = true;
        resolvedFechaVencimiento = fechaVencimientoInput;
      }
    } else {
      // SKU maneja lote pero no pusieron codigo_lote ni lote_id
      throw new Error(
        `El SKU "${sku.nombre}" maneja lotes. Debes indicar CODIGO_LOTE${suffix}. ` +
          `Si el lote ya existe se reutiliza; si no existe se crea automaticamente.`,
      );
    }

    // Si es lote nuevo (shouldCreateLote) la fecha de vencimiento es obligatoria
    if (shouldCreateLote && skuManejaVencimiento && !resolvedFechaVencimiento) {
      throw new Error(
        `El SKU "${sku.nombre}" requiere FECHA_VENCIMIENTO porque el lote "${codigoLote}" ` +
          `no existe aun y sera creado${suffix}. Formato: DD/MM/YYYY o YYYY-MM-DD.`,
      );
    }

    // Si el lote existe pero no tiene fecha y el SKU la requiere, pedirla en la fila
    if (
      !shouldCreateLote &&
      skuManejaVencimiento &&
      !resolvedFechaVencimiento
    ) {
      throw new Error(
        `El lote "${lote?.codigo_lote || codigoLote}" no tiene FECHA_VENCIMIENTO registrada ` +
          `y el SKU "${sku.nombre}" la requiere${suffix}. Indica la fecha en la columna FECHA_VENCIMIENTO.`,
      );
    }
  }

  return {
    almacen_id: Number(warehouse.id),
    almacen_nombre: warehouse.nombre || "",
    ciudad_id: warehouse.ciudad_id || null,
    ciudad_nombre: warehouse.ciudad_nombre || "",
    zona: warehouse.zona || "",
    sku_id: Number(sku.id),
    sku_nombre: sku.nombre || "",
    sku_codigo: sku.codigo || "",
    categoria_id: Number(categoriaFinal.id || sku.categoria_id || 0) || null,
    categoria_nombre: categoriaFinal.nombre || sku.categoria_nombre || "",
    tipo_mercaderia_id: sku.tipo_mercaderia_id || null,
    tipo_mercaderia_nombre: sku.tipo_mercaderia_nombre || "",
    cantidad,
    observaciones,
    sku_maneja_lote: skuManejaLote,
    lote_id: lote?.id ? Number(lote.id) : null,
    codigo_lote: lote?.codigo_lote || codigoLote || null,
    fecha_vencimiento: resolvedFechaVencimiento,
    should_create_lote: shouldCreateLote,
    should_reactivate_lote: shouldReactivateLote,
    should_update_lote_fecha: shouldUpdateLoteFecha,
  };
}

async function applyStockInitializationEntry(
  executor,
  req,
  validated,
  {
    operacion = "SUMAR",
    origenCarga = "MANUAL",
    archivo = null,
    filaExcel = null,
  } = {},
) {
  const normalizedOperacion =
    String(operacion || "SUMAR")
      .trim()
      .toUpperCase() === "REEMPLAZAR"
      ? "REEMPLAZAR"
      : "SUMAR";

  let loteId = validated.lote_id;
  if (validated.sku_maneja_lote && validated.should_create_lote) {
    const [result] = await executor.query(
      `INSERT INTO lotes (sku_id, codigo_lote, fecha_vencimiento, activo)
       VALUES (?,?,?,1)`,
      [
        validated.sku_id,
        validated.codigo_lote,
        validated.fecha_vencimiento || null,
      ],
    );
    loteId = result.insertId;
  } else if (
    validated.sku_maneja_lote &&
    validated.should_reactivate_lote &&
    loteId
  ) {
    await executor.query(
      `UPDATE lotes
       SET activo=1,
           fecha_vencimiento=COALESCE(fecha_vencimiento, ?)
       WHERE id=?`,
      [validated.fecha_vencimiento || null, loteId],
    );
  }

  if (
    validated.sku_maneja_lote &&
    validated.should_update_lote_fecha &&
    loteId
  ) {
    await executor.query(
      "UPDATE lotes SET fecha_vencimiento=? WHERE id=?",
      [validated.fecha_vencimiento, loteId],
    );
  }

  const stockAnterior = await getCurrentStockAmount(executor, {
    empresa_id: req.empresa_id,
    almacen_id: validated.almacen_id,
    sku_id: validated.sku_id,
    lote_id: loteId,
  });

  const cantidadObjetivo = Number(validated.cantidad || 0);
  const cantidadAplicada =
    normalizedOperacion === "REEMPLAZAR"
      ? cantidadObjetivo - stockAnterior
      : cantidadObjetivo;

  await upsertStock(executor, {
    empresa_id: req.empresa_id,
    almacen_id: validated.almacen_id,
    sku_id: validated.sku_id,
    lote_id: loteId,
    cantidad: cantidadAplicada,
  });

  const stockActual = await getCurrentStockAmount(executor, {
    empresa_id: req.empresa_id,
    almacen_id: validated.almacen_id,
    sku_id: validated.sku_id,
    lote_id: loteId,
  });

  await insertAuditLog(executor, {
    empresa_id: req.empresa_id,
    usuario_id: req.usuario.id,
    accion: "STOCK_INITIAL",
    tabla: "stock_almacen",
    registro_id: null,
    detalle: {
      summary:
        normalizedOperacion === "REEMPLAZAR"
          ? "Actualizacion stock inicial"
          : "Registro stock inicial",
      origen_carga: origenCarga,
      archivo,
      fila_excel: filaExcel,
      operacion_stock: normalizedOperacion,
      almacen_id: validated.almacen_id,
      almacen_nombre: validated.almacen_nombre,
      ciudad_id: validated.ciudad_id,
      ciudad_nombre: validated.ciudad_nombre,
      zona: validated.zona,
      categoria_id: validated.categoria_id,
      categoria_nombre: validated.categoria_nombre,
      tipo_mercaderia_id: validated.tipo_mercaderia_id,
      tipo_mercaderia_nombre: validated.tipo_mercaderia_nombre,
      sku_id: validated.sku_id,
      sku_nombre: validated.sku_nombre,
      sku_codigo: validated.sku_codigo,
      lote_id: loteId,
      codigo_lote: validated.codigo_lote,
      fecha_vencimiento: validated.fecha_vencimiento,
      cantidad: cantidadAplicada,
      cantidad_objetivo:
        normalizedOperacion === "REEMPLAZAR" ? cantidadObjetivo : null,
      stock_anterior: stockAnterior,
      stock_actual: stockActual,
      observaciones: validated.observaciones,
    },
    ip: req.ip,
  });

  return {
    lote_id: loteId,
    stock_anterior: stockAnterior,
    stock_actual: stockActual,
    cantidad_aplicada: cantidadAplicada,
    cantidad_objetivo: cantidadObjetivo,
    operacion: normalizedOperacion,
  };
}

async function loadStockInitialLookupContext(executor, req) {
  const scope = await getWarehouseScope(req, "r", executor);

  let warehouseQuery = `SELECT
      a.id,
      a.nombre,
      a.ciudad_id,
      c.nombre AS ciudad_nombre,
      ${getZonaExpr("c")} AS zona
    FROM almacenes a
    JOIN ciudades c ON c.id = a.ciudad_id
    JOIN regiones r ON r.id = c.region_id
    WHERE a.activo=1`;
  const warehouseParams = [];
  if (req.empresa_id) {
    warehouseQuery += " AND r.empresa_id=?";
    warehouseParams.push(req.empresa_id);
  }
  if (scope.ids.length) {
    warehouseQuery += ` AND a.id IN (${scope.ids.map(() => "?").join(",")})`;
    warehouseParams.push(...scope.ids);
  }
  warehouseQuery += " ORDER BY zona, ciudad_nombre, a.nombre";
  const [warehouses] = await executor.query(warehouseQuery, warehouseParams);

  let categoriaQuery =
    "SELECT id, nombre, descripcion, activo FROM categorias WHERE activo=1";
  const categoriaParams = [];
  if (req.empresa_id) {
    categoriaQuery += " AND empresa_id=?";
    categoriaParams.push(req.empresa_id);
  }
  categoriaQuery += " ORDER BY nombre";
  const [categories] = await executor.query(categoriaQuery, categoriaParams);

  let skuQuery = `SELECT
      s.id,
      s.codigo,
      s.nombre,
      s.categoria_id,
      c.nombre AS categoria_nombre,
      s.tipo_mercaderia_id,
      tm.nombre AS tipo_mercaderia_nombre,
      s.zona,
      s.tiene_lote,
      s.tiene_vencimiento
    FROM skus s
    JOIN categorias c ON c.id = s.categoria_id
    LEFT JOIN tipos_mercaderia tm ON tm.id = s.tipo_mercaderia_id
    WHERE s.activo=1`;
  const skuParams = [];
  if (req.empresa_id) {
    skuQuery += " AND s.empresa_id=?";
    skuParams.push(req.empresa_id);
  }
  skuQuery += " ORDER BY c.nombre, s.nombre";
  const [skus] = await executor.query(skuQuery, skuParams);

  return {
    warehouses,
    categories,
    skus,
    duplicateWarehouseNames: buildDuplicateLookupSet(
      warehouses,
      (row) => row.nombre,
    ),
    duplicateSkuNames: buildDuplicateLookupSet(skus, (row) => row.nombre),
  };
}

async function buildStockInitialImportTemplateWorkbook(req, executor = pool) {
  const workbook = createWorkbook();
  const templateSheet = workbook.addWorksheet("Carga_Stock_Inicial", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  const templateColumns = [
    { header: "OPERACION", key: "operacion", width: 16 },
    { header: "ALMACEN", key: "almacen", width: 30 },
    { header: "CATEGORIA", key: "categoria", width: 24 },
    { header: "SKU", key: "sku", width: 36 },
    { header: "CODIGO_LOTE", key: "codigo_lote", width: 18 },
    { header: "FECHA_VENCIMIENTO", key: "fecha_vencimiento", width: 18 },
    { header: "CANTIDAD", key: "cantidad", width: 14 },
    { header: "OBSERVACIONES", key: "observaciones", width: 34 },
  ];
  prepareWorksheet(templateSheet, templateColumns);

  // Filas de ejemplo para guiar al usuario
  function addExampleRow(sheet, values, fgColor) {
    const r = sheet.addRow(values);
    r.eachCell((cell) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: fgColor },
      };
      cell.alignment = { vertical: "middle", horizontal: "left" };
      cell.border = {
        top: { style: "thin", color: { argb: "E5E7EB" } },
        left: { style: "thin", color: { argb: "E5E7EB" } },
        bottom: { style: "thin", color: { argb: "E5E7EB" } },
        right: { style: "thin", color: { argb: "E5E7EB" } },
      };
    });
    r.height = 20;
  }

  // Fila nota/paso
  function addNoteRow(sheet, text, ncols, fgColor = "FEF9C3") {
    const r = sheet.addRow({});
    sheet.mergeCells(r.number, 1, r.number, ncols);
    const cell = sheet.getCell(r.number, 1);
    cell.value = text;
    cell.font = { bold: true, color: { argb: "92400E" }, size: 10 };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: fgColor },
    };
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    r.height = 26;
  }

  const NC = templateColumns.length;
  addNoteRow(
    templateSheet,
    "PASO 1 a 7: Lee la hoja Instrucciones antes de llenar. " +
      "Azul = SKU sin lote. Verde = SKU con lote existente. Naranja = SKU con lote nuevo a crear.",
    NC,
    "FEF9C3",
  );

  // Ejemplo 1: SKU sin lote
  addExampleRow(
    templateSheet,
    {
      operacion: "SUMAR",
      almacen: "ALMACEN TRES REGIONES",
      categoria: "ABARROTES",
      sku: "AFICHE ENMICADO ABARROTES",
      codigo_lote: "",
      fecha_vencimiento: "",
      cantidad: 50,
      observaciones: "SKU sin lote - dejar CODIGO_LOTE vacio",
    },
    "DBEAFE",
  );

  // Ejemplo 2: SKU con lote existente
  addExampleRow(
    templateSheet,
    {
      operacion: "SUMAR",
      almacen: "ALMACEN TRES REGIONES",
      categoria: "ABARROTES",
      sku: "AVENA 3 OSITOS CANELA 24X100GR",
      codigo_lote: "LOTE-2024-001",
      fecha_vencimiento: "",
      cantidad: 120,
      observaciones:
        "Lote existente - fecha_vencimiento vacia si ya la tiene registrada",
    },
    "DCFCE7",
  );

  // Ejemplo 3: SKU con lote NUEVO (fecha obligatoria)
  addExampleRow(
    templateSheet,
    {
      operacion: "SUMAR",
      almacen: "ALMACEN CHICLAYO",
      categoria: "CONFITES",
      sku: "GALLETA CHOCODONUTS BLANCA 14X6X83GR",
      codigo_lote: "GCH-2024-A",
      fecha_vencimiento: "31/12/2025",
      cantidad: 200,
      observaciones: "Lote NUEVO - FECHA_VENCIMIENTO obligatoria",
    },
    "FED7AA",
  );

  // Ejemplo 4: REEMPLAZAR stock
  addExampleRow(
    templateSheet,
    {
      operacion: "REEMPLAZAR",
      almacen: "ALMACEN HUAMANTANGA",
      categoria: "",
      sku: "POLO ROJO FANNY",
      codigo_lote: "",
      fecha_vencimiento: "",
      cantidad: 30,
      observaciones: "REEMPLAZAR fija el stock exacto en 30",
    },
    "DBEAFE",
  );

  buildInstructionSheet(workbook, "Instrucciones", [
    {
      campo: "PASO 1 - OPERACION",
      detalle:
        "SUMAR: agrega la cantidad al stock actual. REEMPLAZAR: deja el stock exactamente en la cantidad indicada.",
    },
    {
      campo: "PASO 2 - ALMACEN",
      detalle:
        "Copia el nombre exactamente como aparece en la hoja Almacenes. No inventes nombres.",
    },
    {
      campo: "PASO 3 - CATEGORIA",
      detalle:
        "Opcional pero recomendada. Si la dejas vacia el sistema usa la categoria del SKU.",
    },
    {
      campo: "PASO 4 - SKU",
      detalle:
        "Copia el nombre exactamente como aparece en la hoja SKUs. Revisa la columna MANEJA_LOTE para saber si necesitas CODIGO_LOTE.",
    },
    {
      campo: "PASO 5 - CODIGO_LOTE",
      detalle:
        "OBLIGATORIO si el SKU tiene MANEJA_LOTE=SI. Si el lote ya existe se reutiliza. Si no existe se crea automaticamente. Si el SKU no maneja lotes, deja esta celda VACIA.",
    },
    {
      campo: "PASO 6 - FECHA_VENCIMIENTO",
      detalle:
        "OBLIGATORIA si el lote no existe aun (se va a crear). Si el lote ya existe y tiene fecha registrada, se usa esa. Formato: DD/MM/YYYY.",
    },
    {
      campo: "PASO 7 - CANTIDAD",
      detalle:
        "En SUMAR debe ser mayor a 0. En REEMPLAZAR puede ser 0 o mayor.",
    },
    {
      campo: "CONSEJO",
      detalle:
        "Si un SKU aparece con el mismo nombre en varias zonas o categorias, usa el valor de SKU_REFERENCIA de la hoja SKUs (incluye zona y categoria al final).",
    },
  ]);

  const lookupContext = await loadStockInitialLookupContext(executor, req);
  const {
    warehouses: almacenes,
    categories: categorias,
    skus,
    duplicateWarehouseNames,
    duplicateSkuNames,
  } = lookupContext;

  let lotesQuery = `SELECT
      l.id,
      l.sku_id,
      l.codigo_lote,
      l.fecha_vencimiento,
      s.nombre AS sku_nombre,
      s.codigo AS sku_codigo
    FROM lotes l
    JOIN skus s ON s.id = l.sku_id
    WHERE l.activo=1`;
  const lotesParams = [];
  if (req.empresa_id) {
    lotesQuery += " AND s.empresa_id=?";
    lotesParams.push(req.empresa_id);
  }
  lotesQuery += " ORDER BY s.nombre, l.codigo_lote";
  const [lotes] = await executor.query(lotesQuery, lotesParams);

  const almacenesSheet = workbook.addWorksheet("Almacenes", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  const almacenesColumns = [
    { header: "ALMACEN_REFERENCIA", key: "almacen_referencia", width: 34 },
    { header: "ALMACEN", key: "nombre", width: 28 },
    { header: "CIUDAD", key: "ciudad_nombre", width: 18 },
    { header: "ZONA", key: "zona", width: 14 },
    { header: "ID", key: "id", width: 10 },
  ];
  prepareWorksheet(almacenesSheet, almacenesColumns);
  addWorksheetRows(
    almacenesSheet,
    almacenesColumns,
    almacenes.map((row) => ({
      almacen_referencia: buildWarehouseReferenceLabel(
        row,
        duplicateWarehouseNames,
      ),
      nombre: row.nombre || "",
      ciudad_nombre: row.ciudad_nombre || "",
      zona: row.zona || "",
      id: Number(row.id || 0),
    })),
  );

  const categoriasSheet = workbook.addWorksheet("Categorias", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  const categoriasColumns = [
    { header: "CATEGORIA", key: "nombre", width: 28 },
    { header: "DESCRIPCION", key: "descripcion", width: 40 },
    { header: "ID", key: "id", width: 10 },
  ];
  prepareWorksheet(categoriasSheet, categoriasColumns);
  addWorksheetRows(
    categoriasSheet,
    categoriasColumns,
    categorias.map((row) => ({
      nombre: row.nombre || "",
      descripcion: row.descripcion || "",
      id: Number(row.id || 0),
    })),
  );

  const skusSheet = workbook.addWorksheet("SKUs", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  const skusColumns = [
    { header: "SKU_REFERENCIA", key: "sku_referencia", width: 40 },
    { header: "SKU", key: "nombre", width: 32 },
    { header: "CODIGO", key: "codigo", width: 16 },
    { header: "CATEGORIA", key: "categoria_nombre", width: 24 },
    { header: "TIPO_MERCADERIA", key: "tipo_mercaderia_nombre", width: 24 },
    { header: "ZONA", key: "zona", width: 14 },
    { header: "MANEJA_LOTE", key: "tiene_lote", width: 14 },
    { header: "TIENE_VENCIMIENTO", key: "tiene_vencimiento", width: 18 },
    { header: "CATEGORIA_ID", key: "categoria_id", width: 14 },
    { header: "TIPO_MERCADERIA_ID", key: "tipo_mercaderia_id", width: 18 },
    { header: "ID", key: "id", width: 10 },
  ];
  prepareWorksheet(skusSheet, skusColumns);
  addWorksheetRows(
    skusSheet,
    skusColumns,
    skus.map((row) => ({
      sku_referencia: buildStockSkuReferenceLabel(row, duplicateSkuNames),
      nombre: row.nombre || "",
      codigo: row.codigo || "",
      categoria_nombre: row.categoria_nombre || "",
      tipo_mercaderia_nombre: row.tipo_mercaderia_nombre || "",
      zona: row.zona || "",
      tiene_lote: parseFlag(row.tiene_lote) ? "SI" : "NO",
      tiene_vencimiento: parseFlag(row.tiene_vencimiento) ? "SI" : "NO",
      categoria_id: Number(row.categoria_id || 0),
      tipo_mercaderia_id: row.tipo_mercaderia_id
        ? Number(row.tipo_mercaderia_id)
        : "",
      id: Number(row.id || 0),
    })),
  );

  const lotesSheet = workbook.addWorksheet("Lotes_Activos", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  const lotesColumns = [
    { header: "SKU_REFERENCIA", key: "sku_referencia", width: 40 },
    { header: "SKU", key: "sku_nombre", width: 30 },
    { header: "CODIGO_SKU", key: "sku_codigo", width: 16 },
    { header: "CODIGO_LOTE", key: "codigo_lote", width: 18 },
    {
      header: "FECHA_VENCIMIENTO",
      key: "fecha_vencimiento",
      width: 18,
      type: "date",
    },
    { header: "SKU_ID", key: "sku_id", width: 12 },
    { header: "ID", key: "id", width: 10 },
  ];
  prepareWorksheet(lotesSheet, lotesColumns);
  addWorksheetRows(
    lotesSheet,
    lotesColumns,
    lotes.map((row) => ({
      sku_referencia: buildStockSkuReferenceLabel(
        {
          nombre: row.sku_nombre,
          categoria_nombre:
            skus.find((sku) => Number(sku.id) === Number(row.sku_id))
              ?.categoria_nombre || "",
          zona:
            skus.find((sku) => Number(sku.id) === Number(row.sku_id))?.zona ||
            "",
        },
        duplicateSkuNames,
      ),
      sku_nombre: row.sku_nombre || "",
      sku_codigo: row.sku_codigo || "",
      codigo_lote: row.codigo_lote || "",
      fecha_vencimiento: row.fecha_vencimiento
        ? new Date(row.fecha_vencimiento)
        : null,
      sku_id: Number(row.sku_id || 0),
      id: Number(row.id || 0),
    })),
  );

  return workbook;
}

async function importStockInitialFromWorkbook(
  executor,
  req,
  workbook,
  { archivo = "Carga_Stock_Inicial" } = {},
) {
  const worksheet =
    workbook.getWorksheet("Carga_Stock_Inicial") || workbook.worksheets[0];
  if (!worksheet) {
    throw new Error("El archivo no contiene hojas de trabajo");
  }

  const rows = readWorksheetRows(worksheet);
  if (!rows.length) {
    throw new Error("La plantilla no contiene filas para procesar");
  }
  const lookupContext = await loadStockInitialLookupContext(executor, req);

  let sumados = 0;
  let reemplazados = 0;
  let omitidos = 0;

  for (const row of rows) {
    const rowNumber = Number(row.__rowNum || 0);
    const operacion =
      String(row.operacion || "")
        .trim()
        .toUpperCase() || "SUMAR";

    if (!["SUMAR", "REEMPLAZAR"].includes(operacion)) {
      throw new Error(
        `Operacion invalida en la fila ${rowNumber}. Usa SUMAR o REEMPLAZAR.`,
      );
    }

    const cantidadRaw = row.cantidad;
    const cantidadNumber =
      typeof cantidadRaw === "number"
        ? cantidadRaw
        : Number(String(cantidadRaw ?? "").trim().replace(",", "."));
    if (operacion === "SUMAR" && Number.isInteger(cantidadNumber) && cantidadNumber === 0) {
      omitidos += 1;
      continue;
    }

    const validated = await validateStockInitializationPayload(
      executor,
      req,
      {
        almacen_id: row.almacen_id,
        almacen: row.almacen || row.almacen_nombre,
        categoria_id: row.categoria_id,
        categoria: row.categoria || row.categoria_nombre,
        sku_id: row.sku_id,
        sku: row.sku || row.sku_nombre || row.nombre,
        lote_id: row.lote_id,
        lote: row.lote,
        codigo_lote: row.codigo_lote,
        fecha_vencimiento: row.fecha_vencimiento,
        cantidad: row.cantidad,
        observaciones: row.observaciones,
      },
      {
        allowZeroQuantity: operacion === "REEMPLAZAR",
        lookupContext,
        rowNumber,
      },
    );

    await applyStockInitializationEntry(executor, req, validated, {
      operacion,
      origenCarga: "EXCEL",
      archivo,
      filaExcel: rowNumber,
    });

    if (operacion === "REEMPLAZAR") {
      reemplazados += 1;
    } else {
      sumados += 1;
    }
  }

  return {
    filas_procesadas: rows.length,
    sumados,
    reemplazados,
    omitidos,
  };
}

function mapRegistroExportRows(registros = [], { req } = {}) {
  const rows = [];

  registros.forEach((registro) => {
    const detalles =
      Array.isArray(registro.detalles) && registro.detalles.length
        ? registro.detalles
        : [
            {
              tipo_mercaderia_nombre: "",
              sku_nombre: registro.sku_principal_nombre || "",
              codigo_lote: "",
              fecha_vencimiento: registro.fecha_vencimiento || null,
              cantidad: Number(registro.cantidad_total || 0),
            },
          ];

    detalles.forEach((detail, index) => {
      rows.push({
        id: Number(registro.id || 0),
        fecha: registro.fecha ? new Date(registro.fecha) : null,
        zona: registro.zona || getZonaFromCityName(registro.ciudad_nombre),
        ciudad: registro.ciudad_nombre || "",
        almacen_origen: registro.almacen_origen || "",
        almacen_destino: registro.almacen_destino || "",
        categoria: registro.categoria_nombre || "",
        accion: registro.accion || "",
        tipo_accion: registro.tipo_accion || "",
        personal_receptor: registro.personal_receptor_nombre || "",
        indicador: registro.indicador_nombre || "",
        item: index + 1,
        total_items: detalles.length,
        tipo_mercaderia: detail.tipo_mercaderia_nombre || "",
        sku: detail.sku_nombre || "",
        lote: detail.codigo_lote || "",
        fecha_vencimiento: detail.fecha_vencimiento
          ? new Date(detail.fecha_vencimiento)
          : null,
        cantidad: Number(detail.cantidad || 0),
        nro_guia: registro.nro_guia || "",
        estado: registro.estado || "",
        registrado_por: registro.registrado_por || "",
        observaciones: registro.observaciones || "",
        foto_guia: buildFotoGuiaCellValue(req, registro.foto_guia),
      });
    });
  });

  return rows;
}

function toStockReportInteger(value) {
  return Math.trunc(Number(value || 0));
}

function getStockReportDirection(row, delta, sameWarehouse = false) {
  const tipoMovimiento = String(row.tipo_movimiento || "").toUpperCase();
  if (tipoMovimiento === "TG_INTERNO_ENTRADA") return "INGRESO";
  if (tipoMovimiento === "TG_INTERNO_SALIDA") return "SALIDA";

  if (sameWarehouse) {
    const tipoAccion = String(row.tipo_accion || "")
      .trim()
      .toUpperCase();
    return tipoAccion === "ENTRADA" ? "INGRESO" : "SALIDA";
  }

  return Number(delta || 0) < 0 ? "SALIDA" : "INGRESO";
}

function shouldIncludeSameWarehouseMovement(movement) {
  const tipoMovimiento = String(movement.tipo_movimiento || "").toUpperCase();
  if (tipoMovimiento === "STOCK_INITIAL") return true;
  if (["TG_INTERNO_ENTRADA", "TG_INTERNO_SALIDA"].includes(tipoMovimiento)) {
    return true;
  }

  const tipoAccion = String(movement.tipo_accion || "")
    .trim()
    .toUpperCase();

  if (tipoAccion === "ENTRADA") {
    return ["INGRESO_APROBADO", "APROBACION"].includes(tipoMovimiento);
  }
  return ["SALIDA_TRANSITO", "APROBACION"].includes(tipoMovimiento);
}

function buildStockReportMovementLabel(row, delta, sameWarehouse = false) {
  if (String(row.tipo_movimiento || "").toUpperCase() === "STOCK_INITIAL") {
    return "CARGA STOCK INICIAL";
  }
  if (
    ["TG_INTERNO_ENTRADA", "TG_INTERNO_SALIDA"].includes(
      String(row.tipo_movimiento || "").toUpperCase(),
    )
  ) {
    return `${getStockReportDirection(row, delta, sameWarehouse)} TG - INTERNO`;
  }

  const accion = String(row.accion || "")
    .trim()
    .toUpperCase();
  const indicador = String(row.indicador_nombre || "")
    .trim()
    .toUpperCase();

  const direction = getStockReportDirection(row, delta, sameWarehouse);

  if (accion === "MERMA") {
    return "MERMA";
  }
  if (indicador) {
    return `${direction} ${indicador}`;
  }
  if (accion) {
    return `${direction} ${accion}`;
  }
  return direction;
}

function toMovementDateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isBeforeDate(date, isoDate) {
  if (!date || !isoDate) return false;
  return date < new Date(`${isoDate}T00:00:00`);
}

function isAfterDate(date, isoDate) {
  if (!date || !isoDate) return false;
  return date > new Date(`${isoDate}T23:59:59.999`);
}

function normalizeAuditFilterText(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function matchesAuditFilter(values = [], term = "") {
  const normalizedTerm = normalizeAuditFilterText(term);
  if (!normalizedTerm) return true;

  const haystack = values
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(normalizedTerm);
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
    query += " AND sk.empresa_id=?";
    params.push(empresaId);
  }

  const [rows] = await executor.query(query, params);
  return new Map(rows.map((row) => [Number(row.id), row]));
}

function applySkuReference(detail = {}, skuReferenceMap = new Map()) {
  const skuId = parsePositiveInt(detail.sku_id);
  const skuReference = skuId ? skuReferenceMap.get(Number(skuId)) : null;
  if (!skuReference) return detail;

  return {
    ...detail,
    sku_codigo: skuReference.codigo || detail.sku_codigo || "",
    sku_nombre: skuReference.nombre || detail.sku_nombre || "",
    categoria_id: skuReference.categoria_id || detail.categoria_id || null,
    categoria_nombre: skuReference.categoria_nombre || detail.categoria_nombre || "",
    tipo_mercaderia_id: skuReference.tipo_mercaderia_id || detail.tipo_mercaderia_id || null,
    tipo_mercaderia_nombre: skuReference.tipo_mercaderia_nombre || detail.tipo_mercaderia_nombre || "",
  };
}

function buildStockInitialReportMovements(
  auditRows = [],
  {
    categoriaId = null,
    requestedWarehouseId = null,
    scopedWarehouseIds = [],
    zona = "",
    skuTerm = "",
    loteTerm = "",
    skuReferenceMap = new Map(),
  } = {},
) {
  const scopedWarehouseSet =
    Array.isArray(scopedWarehouseIds) && scopedWarehouseIds.length
      ? new Set(scopedWarehouseIds.map((id) => Number(id)))
      : null;

  return auditRows
    .map((auditRow) => {
      const parsedDetail = parseAuditDetail(auditRow.detalle);
      if (!parsedDetail) return null;
      const detail = applySkuReference(parsedDetail, skuReferenceMap);

      const cantidad = Number(detail.cantidad || 0);
      const almacenId = parsePositiveInt(detail.almacen_id);
      const skuId = parsePositiveInt(detail.sku_id);
      const loteId = parsePositiveInt(detail.lote_id) || null;
      const detailCategoriaId = parsePositiveInt(detail.categoria_id);

      if (!cantidad || !almacenId || !skuId) {
        return null;
      }
      if (categoriaId && detailCategoriaId !== categoriaId) {
        return null;
      }
      if (zona && String(detail.zona || "").toUpperCase() !== zona) {
        return null;
      }
      if (
        skuTerm &&
        !matchesAuditFilter([detail.sku_nombre, detail.sku_codigo], skuTerm)
      ) {
        return null;
      }
      if (
        loteTerm &&
        !matchesAuditFilter([detail.codigo_lote || "SIN LOTE"], loteTerm)
      ) {
        return null;
      }
      if (requestedWarehouseId && almacenId !== requestedWarehouseId) {
        return null;
      }
      if (scopedWarehouseSet && !scopedWarehouseSet.has(almacenId)) {
        return null;
      }

      return {
        id: `audit-${auditRow.id}`,
        movimiento_fecha: auditRow.created_at,
        tipo_movimiento: "STOCK_INITIAL",
        cantidad,
        almacen_origen_id: null,
        almacen_destino_id: almacenId,
        sku_id: skuId,
        lote_id: loteId,
        accion: "STOCK INICIAL",
        tipo_accion: "ENTRADA",
        indicador_nombre: "STOCK INICIAL",
        sku_codigo: String(detail.sku_codigo || ""),
        sku_nombre: String(detail.sku_nombre || ""),
        categoria_nombre: String(detail.categoria_nombre || ""),
        tipo_mercaderia_nombre: String(detail.tipo_mercaderia_nombre || ""),
        codigo_lote: String(detail.codigo_lote || ""),
        lote_fecha_vencimiento: detail.fecha_vencimiento || null,
        almacen_origen_nombre: "",
        almacen_destino_nombre: String(detail.almacen_nombre || ""),
        zona: String(detail.zona || ""),
      };
    })
    .filter(Boolean);
}

function buildStockInitialAuditRows(
  auditRows = [],
  {
    requestedWarehouseId = null,
    requestedCategoryId = null,
    scopedWarehouseIds = [],
    qUsuario = "",
    qAlmacen = "",
    qCategoria = "",
    qSku = "",
    skuReferenceMap = new Map(),
  } = {},
) {
  const scopedWarehouseSet =
    Array.isArray(scopedWarehouseIds) && scopedWarehouseIds.length
      ? new Set(scopedWarehouseIds.map((id) => Number(id)))
      : null;

  return auditRows
    .map((auditRow) => {
      const parsedDetail = parseAuditDetail(auditRow.detalle);
      if (!parsedDetail) return null;
      const detail = applySkuReference(parsedDetail, skuReferenceMap);

      const almacenId = parsePositiveInt(detail.almacen_id);
      const categoriaId = parsePositiveInt(detail.categoria_id);
      if (!almacenId) return null;
      if (requestedWarehouseId && almacenId !== requestedWarehouseId)
        return null;
      if (requestedCategoryId && categoriaId !== requestedCategoryId)
        return null;
      if (scopedWarehouseSet && !scopedWarehouseSet.has(almacenId)) return null;

      const usuarioNombre =
        [auditRow.usuario_nombre, auditRow.usuario_apellido]
          .map((value) => String(value || "").trim())
          .filter(Boolean)
          .join(" ") || "Sistema";

      const row = {
        fecha: auditRow.created_at ? new Date(auditRow.created_at) : null,
        usuario: usuarioNombre,
        email: auditRow.usuario_email || "",
        rol: auditRow.usuario_rol || "",
        almacen: detail.almacen_nombre || "",
        ciudad: detail.ciudad_nombre || "",
        zona: detail.zona || "",
        categoria: detail.categoria_nombre || "",
        tipo_mercaderia: detail.tipo_mercaderia_nombre || "",
        operacion_stock: detail.operacion_stock || "SUMAR",
        sku_codigo: detail.sku_codigo || "",
        sku: detail.sku_nombre || "",
        lote: detail.codigo_lote || "SIN LOTE",
        fecha_vencimiento: detail.fecha_vencimiento
          ? new Date(detail.fecha_vencimiento)
          : null,
        cantidad_cargada: Math.trunc(Number(detail.cantidad || 0)),
        cantidad_objetivo:
          detail.cantidad_objetivo !== null &&
          detail.cantidad_objetivo !== undefined
            ? Math.trunc(Number(detail.cantidad_objetivo || 0))
            : null,
        stock_anterior: Math.trunc(Number(detail.stock_anterior || 0)),
        stock_actual: Math.trunc(Number(detail.stock_actual || 0)),
        observaciones: detail.observaciones || "",
        ip: auditRow.ip || "",
      };

      if (!matchesAuditFilter([row.usuario, row.email, row.rol], qUsuario))
        return null;
      if (!matchesAuditFilter([row.almacen, row.ciudad, row.zona], qAlmacen))
        return null;
      if (!matchesAuditFilter([row.categoria], qCategoria)) return null;
      if (
        !matchesAuditFilter(
          [row.sku, row.sku_codigo, row.categoria, row.tipo_mercaderia],
          qSku,
        )
      )
        return null;

      return row;
    })
    .filter(Boolean)
    .sort((left, right) => {
      const leftDate = left.fecha?.getTime() || 0;
      const rightDate = right.fecha?.getTime() || 0;
      return rightDate - leftDate;
    });
}

function buildStockReportRows(
  movements = [],
  { fechaIni = "", fechaFin = "", warehouseScopeIds = [] } = {},
) {
  const scopedWarehouseIds =
    Array.isArray(warehouseScopeIds) && warehouseScopeIds.length
      ? new Set(warehouseScopeIds.map((id) => Number(id)))
      : null;
  const reportMap = new Map();
  const movementLabels = [];
  const movementLabelSet = new Set();

  movements.forEach((movement) => {
    const movementDate = toMovementDateTime(movement.movimiento_fecha);
    const effects = getMovementEffects(movement.tipo_movimiento);
    const quantity = toStockReportInteger(movement.cantidad);
    if (!quantity) return;

    const warehouseEntries = [];
    const originId = Number(movement.almacen_origen_id || 0);
    const destinationId = Number(movement.almacen_destino_id || 0);
    const sameWarehouse =
      originId && destinationId && originId === destinationId;

    if (sameWarehouse) {
      if (!shouldIncludeSameWarehouseMovement(movement)) return;

      const direction = getStockReportDirection(movement, 0, true);
      warehouseEntries.push({
        almacen_id: originId,
        almacen_nombre:
          movement.almacen_origen_nombre ||
          movement.almacen_destino_nombre ||
          "",
        delta: direction === "INGRESO" ? quantity : quantity * -1,
        sameWarehouse: true,
      });
    } else if (effects.originDelta && movement.almacen_origen_id) {
      warehouseEntries.push({
        almacen_id: originId,
        almacen_nombre: movement.almacen_origen_nombre || "",
        delta: quantity * effects.originDelta,
      });
    }
    if (
      !sameWarehouse &&
      effects.destinationDelta &&
      movement.almacen_destino_id
    ) {
      warehouseEntries.push({
        almacen_id: destinationId,
        almacen_nombre: movement.almacen_destino_nombre || "",
        delta: quantity * effects.destinationDelta,
      });
    }

    warehouseEntries.forEach((entry) => {
      if (
        scopedWarehouseIds &&
        !scopedWarehouseIds.has(Number(entry.almacen_id))
      ) {
        return;
      }

      const loteKey = movement.lote_id ? String(movement.lote_id) : "sin-lote";
      const key = [entry.almacen_id, movement.sku_id, loteKey].join("|");

      if (!reportMap.has(key)) {
        reportMap.set(key, {
          almacen: entry.almacen_nombre || "",
          zona: movement.zona || "",
          categoria: movement.categoria_nombre || "",
          tipo_mercaderia: movement.tipo_mercaderia_nombre || "",
          sku_codigo: movement.sku_codigo || "",
          sku: movement.sku_nombre || "",
          lote: movement.codigo_lote || "SIN LOTE",
          fecha_vencimiento: movement.lote_fecha_vencimiento
            ? new Date(movement.lote_fecha_vencimiento)
            : null,
          stock_inicial: 0,
          stock_final: 0,
          _period_delta: 0,
        });
      }

      const reportRow = reportMap.get(key);
      if (!reportRow.sku_codigo && movement.sku_codigo) {
        reportRow.sku_codigo = movement.sku_codigo;
      }
      if (!reportRow.sku && movement.sku_nombre) {
        reportRow.sku = movement.sku_nombre;
      }
      if (!reportRow.categoria && movement.categoria_nombre) {
        reportRow.categoria = movement.categoria_nombre;
      }
      if (!reportRow.tipo_mercaderia && movement.tipo_mercaderia_nombre) {
        reportRow.tipo_mercaderia = movement.tipo_mercaderia_nombre;
      }

      if (isBeforeDate(movementDate, fechaIni)) {
        reportRow.stock_inicial += entry.delta;
        return;
      }
      if (isAfterDate(movementDate, fechaFin)) {
        return;
      }

      const label = buildStockReportMovementLabel(
        movement,
        entry.delta,
        entry.sameWarehouse,
      );
      if (!movementLabelSet.has(label)) {
        movementLabelSet.add(label);
        movementLabels.push(label);
      }

      reportRow[label] =
        toStockReportInteger(reportRow[label]) + Math.abs(entry.delta);
      reportRow._period_delta += entry.delta;
    });
  });

  const rows = [...reportMap.values()]
    .map((row) => ({
      ...row,
      stock_inicial: toStockReportInteger(row.stock_inicial),
      stock_final: toStockReportInteger(
        Number(row.stock_inicial || 0) + Number(row._period_delta || 0),
      ),
    }))
    .filter((row) => {
      const hasMovementValues = movementLabels.some(
        (label) => Number(row[label] || 0) !== 0,
      );
      return (
        hasMovementValues ||
        Number(row.stock_inicial || 0) !== 0 ||
        Number(row.stock_final || 0) !== 0
      );
    })
    .sort(
      (a, b) =>
        String(a.almacen).localeCompare(String(b.almacen)) ||
        String(a.sku).localeCompare(String(b.sku)) ||
        String(a.lote).localeCompare(String(b.lote)) ||
        String(a.categoria).localeCompare(String(b.categoria)) ||
        String(a.tipo_mercaderia).localeCompare(String(b.tipo_mercaderia)),
    );

  return { rows, movementLabels };
}

router.get("/", async (req, res) => {
  try {
    const { rows, paginacion } = await fetchRegistroRows(pool, req, {
      paginate: true,
    });
    res.json({
      ok: true,
      datos: rows,
      paginacion,
    });
  } catch (err) {
    console.error(err);
    res
      .status(err.statusCode || 500)
      .json({ ok: false, mensaje: err.message || "Error interno" });
  }
});

router.get(
  "/export/lotes/excel",
  requireRol("superadmin", "admin", "supervisor"),
  async (req, res) => {
    try {
      const stockScope = await getStockScope(req, "sa");
      let query = `SELECT
        sa.almacen_id,
        sa.sku_id,
        sa.lote_id,
        GREATEST(sa.cantidad - COALESCE(dup.cantidad, 0), 0) AS cantidad,
        a.nombre AS almacen_nombre,
        c.nombre AS ciudad_nombre,
        ${"CASE WHEN UPPER(c.nombre)='LIMA' THEN 'LIMA' ELSE 'PROVINCIA' END"} AS zona,
        ca.nombre AS categoria_nombre,
        tm.nombre AS tipo_mercaderia_nombre,
        sk.nombre AS sku_nombre,
        lo.codigo_lote,
        lo.fecha_vencimiento
      FROM stock_almacen sa
      JOIN almacenes a ON a.id = sa.almacen_id
      JOIN ciudades c ON c.id = a.ciudad_id
      JOIN skus sk ON sk.id = sa.sku_id
      JOIN categorias ca ON ca.id = sk.categoria_id
      LEFT JOIN tipos_mercaderia tm ON tm.id = sk.tipo_mercaderia_id
      JOIN lotes lo ON lo.id = sa.lote_id
      LEFT JOIN (
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
        AND (dup.lote_id <=> sa.lote_id)
      WHERE sa.cantidad <> 0`;
      const params = [];

      if (req.empresa_id) {
        query += " AND sa.empresa_id = ?";
        params.push(req.empresa_id);
      }

      query += stockScope.clause;
      params.push(...stockScope.params);

      query +=
        " HAVING cantidad > 0 ORDER BY zona, ciudad_nombre, almacen_nombre, categoria_nombre, sku_nombre, codigo_lote";

      const [rows] = await pool.query(query, params);
      await sendExcelWorkbook(res, {
        fileName: `zentra_lotes_${Date.now()}`,
        sheetName: "Lotes",
        columns: [
          { header: "ZONA", key: "zona", width: 14 },
          { header: "CIUDAD", key: "ciudad", width: 18 },
          { header: "ALMACEN", key: "almacen", width: 24 },
          { header: "CATEGORIA", key: "categoria", width: 18 },
          { header: "TIPO MERCADERIA", key: "tipo_mercaderia", width: 20 },
          { header: "SKU", key: "sku", width: 34 },
          { header: "LOTE", key: "lote", width: 18 },
          {
            header: "FECHA VENCIMIENTO",
            key: "fecha_vencimiento",
            width: 18,
            type: "date",
          },
          {
            header: "STOCK ACTUAL",
            key: "stock_actual",
            width: 14,
            type: "number",
          },
        ],
        rows: rows.map((row) => ({
          zona: row.zona,
          ciudad: row.ciudad_nombre,
          almacen: row.almacen_nombre,
          categoria: row.categoria_nombre,
          tipo_mercaderia: row.tipo_mercaderia_nombre || "",
          sku: row.sku_nombre,
          lote: row.codigo_lote,
          fecha_vencimiento: row.fecha_vencimiento
            ? new Date(row.fecha_vencimiento)
            : null,
          stock_actual: Number(row.cantidad || 0),
        })),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ ok: false, mensaje: "Error al exportar lotes" });
    }
  },
);

router.get(
  "/export/excel",
  requireRol("superadmin", "admin", "supervisor"),
  async (req, res) => {
    try {
      const { rows } = await fetchRegistroRows(pool, req, { paginate: false });
      const estadoBase = String(req.query.estado || "").toLowerCase();
      const exportName =
        estadoBase === "en_transito"
          ? "guias_en_camino"
          : estadoBase === "pendiente"
            ? "aprobacion_ingresos"
            : "registros";

      await sendExcelWorkbook(res, {
        fileName: `zentra_${exportName}_${Date.now()}`,
        sheetName:
          estadoBase === "en_transito"
            ? "Guias En Camino"
            : estadoBase === "pendiente"
              ? "Aprobacion Ingresos"
              : "Registros",
        columns: [
          { header: "ID", key: "id", width: 10, type: "integer" },
          { header: "FECHA", key: "fecha", width: 14, type: "date" },
          { header: "ZONA", key: "zona", width: 14 },
          { header: "CIUDAD", key: "ciudad", width: 18 },
          { header: "ALMACEN ORIGEN", key: "almacen_origen", width: 24 },
          { header: "ALMACEN DESTINO", key: "almacen_destino", width: 24 },
          { header: "CATEGORIA", key: "categoria", width: 18 },
          { header: "ACCION", key: "accion", width: 24 },
          { header: "TIPO ACCION", key: "tipo_accion", width: 16 },
          { header: "PERSONAL RECEPTOR", key: "personal_receptor", width: 26 },
          { header: "INDICADOR", key: "indicador", width: 28 },
          { header: "ITEM", key: "item", width: 10, type: "integer" },
          {
            header: "TOTAL ITEMS",
            key: "total_items",
            width: 12,
            type: "integer",
          },
          { header: "TIPO MERCADERIA", key: "tipo_mercaderia", width: 20 },
          { header: "SKU", key: "sku", width: 36 },
          { header: "LOTE", key: "lote", width: 18 },
          {
            header: "FECHA VENCIMIENTO",
            key: "fecha_vencimiento",
            width: 18,
            type: "date",
          },
          { header: "CANTIDAD", key: "cantidad", width: 14, type: "number" },
          { header: "NRO GUIA", key: "nro_guia", width: 18 },
          { header: "ESTADO", key: "estado", width: 16 },
          { header: "REGISTRADO POR", key: "registrado_por", width: 24 },
          { header: "OBSERVACION", key: "observaciones", width: 34 },
          { header: "FOTO GUIA", key: "foto_guia", width: 64, type: "link" },
        ],
        rows: mapRegistroExportRows(rows, { req }),
      });
    } catch (err) {
      console.error(err);
      res
        .status(500)
        .json({ ok: false, mensaje: "Error al exportar registros" });
    }
  },
);

router.get(
  "/export/stock/excel",
  requireRol("superadmin", "admin", "supervisor"),
  async (req, res) => {
    try {
      const fechaIni = String(req.query.fecha_ini || "").trim();
      const fechaFin = String(req.query.fecha_fin || "").trim();
      const categoriaId = parsePositiveInt(req.query.categoria_id);
      const tipoMercaderiaId = parsePositiveInt(req.query.tipo_mercaderia_id);
      const requestedWarehouseId = parsePositiveInt(req.query.almacen_id);
      const zona = String(req.query.zona || "").trim().toUpperCase();
      const skuTerm = String(req.query.sku || "").trim();
      const loteTerm = String(req.query.lote || "").trim();

      if (fechaIni && !isValidDateInput(fechaIni)) {
        return sendBadRequest(res, "Fecha inicial invalida");
      }
      if (fechaFin && !isValidDateInput(fechaFin)) {
        return sendBadRequest(res, "Fecha final invalida");
      }

      let query = `SELECT
        sm.id,
        COALESCE(r.fecha, sm.created_at) AS movimiento_fecha,
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
        COALESCE(ind.nombre,
          CASE WHEN sm.tipo_movimiento IN ('TG_INTERNO_ENTRADA','TG_INTERNO_SALIDA') THEN 'TG - INTERNO'
               ELSE NULL END
        ) AS indicador_nombre,
        sk.codigo AS sku_codigo,
        sk.nombre AS sku_nombre,
        ca.nombre AS categoria_nombre,
        tm.nombre AS tipo_mercaderia_nombre,
        lo.codigo_lote,
        lo.fecha_vencimiento AS lote_fecha_vencimiento,
        ao.nombre AS almacen_origen_nombre,
        ad.nombre AS almacen_destino_nombre,
        CASE
          WHEN UPPER(COALESCE(co.nombre, cd.nombre, ''))='LIMA' THEN 'LIMA'
          ELSE 'PROVINCIA'
        END AS zona
      FROM stock_movimientos sm
      LEFT JOIN registros r ON r.id = sm.registro_id
      JOIN skus sk ON sk.id = sm.sku_id
      JOIN categorias ca ON ca.id = sk.categoria_id
      LEFT JOIN tipos_mercaderia tm ON tm.id = sk.tipo_mercaderia_id
      LEFT JOIN indicadores ind ON ind.id = r.indicador_id
      LEFT JOIN lotes lo ON lo.id = sm.lote_id
      LEFT JOIN almacenes ao ON ao.id = sm.almacen_origen_id
      LEFT JOIN almacenes ad ON ad.id = sm.almacen_destino_id
      LEFT JOIN ciudades co ON co.id = ao.ciudad_id
      LEFT JOIN ciudades cd ON cd.id = ad.ciudad_id
      WHERE (r.id IS NULL OR r.eliminado_at IS NULL)`;
      const params = [];

      if (req.empresa_id) {
        query += " AND sm.empresa_id=?";
        params.push(req.empresa_id);
      }
      if (categoriaId) {
        query += " AND sk.categoria_id=?";
        params.push(categoriaId);
      }
      if (tipoMercaderiaId) {
        query += " AND sk.tipo_mercaderia_id=?";
        params.push(tipoMercaderiaId);
      }
      if (requestedWarehouseId) {
        query += " AND (sm.almacen_origen_id=? OR sm.almacen_destino_id=?)";
        params.push(requestedWarehouseId, requestedWarehouseId);
      }
      if (zona) {
        query += " AND (CASE WHEN UPPER(COALESCE(co.nombre, cd.nombre, ''))='LIMA' THEN 'LIMA' ELSE 'PROVINCIA' END)=?";
        params.push(zona);
      }
      if (skuTerm) {
        query += " AND (sk.nombre LIKE ? OR sk.codigo LIKE ?)";
        params.push(`%${skuTerm}%`, `%${skuTerm}%`);
      }
      if (loteTerm) {
        query += " AND COALESCE(lo.codigo_lote, 'SIN LOTE') LIKE ?";
        params.push(`%${loteTerm}%`);
      }
      if (req.query.vencimiento_desde) {
        query += " AND lo.fecha_vencimiento >= ?";
        params.push(req.query.vencimiento_desde);
      }
      if (req.query.vencimiento_hasta) {
        query += " AND lo.fecha_vencimiento <= ?";
        params.push(req.query.vencimiento_hasta);
      }
      if (fechaFin) {
        query += " AND DATE(COALESCE(r.fecha, sm.created_at)) <= ?";
        params.push(fechaFin);
      }

      const scopedWarehouseIds = ["almacenero", "supervisor"].includes(
        req.usuario.rol,
      )
        ? await getAssignedWarehouseIds(req.usuario.id, pool)
        : [];
      if (scopedWarehouseIds.length) {
        const placeholders = scopedWarehouseIds.map(() => "?").join(",");
        query += ` AND (sm.almacen_origen_id IN (${placeholders}) OR sm.almacen_destino_id IN (${placeholders}))`;
        params.push(...scopedWarehouseIds, ...scopedWarehouseIds);
      }

      query += " ORDER BY sm.created_at, sm.id";

      const [stockMovements] = await pool.query(query, params);

      let stockInitialQuery = `SELECT id, created_at, detalle
                             FROM audit_log
                             WHERE accion='STOCK_INITIAL' AND tabla='stock_almacen'`;
      const stockInitialParams = [];
      if (req.empresa_id) {
        stockInitialQuery += " AND empresa_id=?";
        stockInitialParams.push(req.empresa_id);
      }
      if (fechaFin) {
        stockInitialQuery += " AND DATE(created_at) <= ?";
        stockInitialParams.push(fechaFin);
      }
      stockInitialQuery += " ORDER BY created_at, id";

      const [stockInitialAuditRows] = await pool.query(
        stockInitialQuery,
        stockInitialParams,
      );
      const skuReferenceMap = await loadSkuReferenceMap(pool, req.empresa_id);
      const effectiveWarehouseScopeIds = requestedWarehouseId
        ? scopedWarehouseIds.length
          ? scopedWarehouseIds.filter(
              (id) => Number(id) === requestedWarehouseId,
            )
          : [requestedWarehouseId]
        : scopedWarehouseIds;

      const stockInitialMovements = buildStockInitialReportMovements(
        stockInitialAuditRows,
        {
          categoriaId,
          requestedWarehouseId,
          scopedWarehouseIds,
          zona,
          skuTerm,
          loteTerm,
          skuReferenceMap,
        },
      );
      const movements = [...stockMovements, ...stockInitialMovements].sort(
        (left, right) => {
          const leftDate =
            toMovementDateTime(left.movimiento_fecha)?.getTime() || 0;
          const rightDate =
            toMovementDateTime(right.movimiento_fecha)?.getTime() || 0;
          if (leftDate !== rightDate) return leftDate - rightDate;
          return String(left.id || "").localeCompare(String(right.id || ""));
        },
      );

      const { rows, movementLabels } = buildStockReportRows(movements, {
        fechaIni,
        fechaFin,
        warehouseScopeIds: effectiveWarehouseScopeIds,
      });

      const columns = [
        { header: "ZONA", key: "zona", width: 14 },
        { header: "ALMACEN", key: "almacen", width: 24 },
        { header: "CATEGORIA", key: "categoria", width: 18 },
        { header: "TIPO MERCADERIA", key: "tipo_mercaderia", width: 22 },
        { header: "COD. SKU", key: "sku_codigo", width: 14 },
        { header: "SKU", key: "sku", width: 34 },
        { header: "LOTE", key: "lote", width: 18 },
        {
          header: "FECHA VENCIMIENTO",
          key: "fecha_vencimiento",
          width: 18,
          type: "date",
        },
        {
          header: "SALDO INICIAL",
          key: "stock_inicial",
          width: 14,
          type: "integer",
        },
        ...movementLabels.map((label) => ({
          header: label,
          key: label,
          width: Math.max(16, label.length + 4),
          type: "integer",
        })),
        {
          header: "STOCK FINAL",
          key: "stock_final",
          width: 14,
          type: "integer",
        },
      ];

      await sendExcelWorkbook(res, {
        fileName: `zentra_stock_sku_lote_${Date.now()}`,
        sheetName: "Stock SKU Lote",
        columns,
        rows: rows.map((row) => {
          const exportRow = { ...row };
          movementLabels.forEach((label) => {
            exportRow[label] = toStockReportInteger(row[label]);
          });
          return exportRow;
        }),
      });
    } catch (err) {
      console.error(err);
      res
        .status(500)
        .json({ ok: false, mensaje: "Error al exportar el reporte de stock" });
    }
  },
);

router.get(
  "/export/stock-inicial/excel",
  requireRol("superadmin", "admin", "supervisor"),
  async (req, res) => {
    try {
      const fechaIni = String(req.query.fecha_ini || "").trim();
      const fechaFin = String(req.query.fecha_fin || "").trim();
      const requestedWarehouseId = parsePositiveInt(req.query.almacen_id);
      const requestedCategoryId = parsePositiveInt(req.query.categoria_id);
      const qUsuario = String(
        req.query.q_usuario || req.query.q_registrado_por || "",
      ).trim();
      const qAlmacen = [
        req.query.q_almacen,
        req.query.q_almacen_origen,
        req.query.q_almacen_destino,
      ]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .join(" ");
      const qCategoria = String(req.query.q_categoria || "").trim();
      const qSku = String(req.query.q_sku || "").trim();

      if (fechaIni && !isValidDateInput(fechaIni)) {
        return sendBadRequest(res, "Fecha inicial invalida");
      }
      if (fechaFin && !isValidDateInput(fechaFin)) {
        return sendBadRequest(res, "Fecha final invalida");
      }

      let query = `SELECT
        a.id,
        a.created_at,
        a.detalle,
        a.ip,
        u.nombre AS usuario_nombre,
        u.apellido AS usuario_apellido,
        u.email AS usuario_email,
        u.rol AS usuario_rol
      FROM audit_log a
      LEFT JOIN usuarios u ON u.id = a.usuario_id
      WHERE a.accion='STOCK_INITIAL' AND a.tabla='stock_almacen'`;
      const params = [];

      if (req.empresa_id) {
        query += " AND a.empresa_id=?";
        params.push(req.empresa_id);
      }
      if (fechaIni) {
        query += " AND DATE(a.created_at) >= ?";
        params.push(fechaIni);
      }
      if (fechaFin) {
        query += " AND DATE(a.created_at) <= ?";
        params.push(fechaFin);
      }

      query += " ORDER BY a.created_at DESC, a.id DESC";

      const [auditRows] = await pool.query(query, params);
      const skuReferenceMap = await loadSkuReferenceMap(pool, req.empresa_id);
      const scopedWarehouseIds = ["almacenero", "supervisor"].includes(
        req.usuario.rol,
      )
        ? await getAssignedWarehouseIds(req.usuario.id, pool)
        : [];
      const rows = buildStockInitialAuditRows(auditRows, {
        requestedWarehouseId,
        requestedCategoryId,
        scopedWarehouseIds,
        qUsuario,
        qAlmacen,
        qCategoria,
        qSku,
        skuReferenceMap,
      });

      await sendExcelWorkbook(res, {
        fileName: `zentra_stock_inicial_${Date.now()}`,
        sheetName: "Stock Inicial",
        columns: [
          { header: "FECHA", key: "fecha", width: 18, type: "datetime" },
          { header: "USUARIO", key: "usuario", width: 26 },
          { header: "EMAIL", key: "email", width: 30 },
          { header: "ROL", key: "rol", width: 16 },
          { header: "ALMACEN", key: "almacen", width: 24 },
          { header: "CIUDAD", key: "ciudad", width: 18 },
          { header: "ZONA", key: "zona", width: 14 },
          { header: "OPERACION", key: "operacion_stock", width: 14 },
          { header: "CATEGORIA", key: "categoria", width: 18 },
          { header: "TIPO MERCADERIA", key: "tipo_mercaderia", width: 22 },
          { header: "COD. SKU", key: "sku_codigo", width: 14 },
          { header: "SKU", key: "sku", width: 34 },
          { header: "LOTE", key: "lote", width: 18 },
          {
            header: "FECHA VENCIMIENTO",
            key: "fecha_vencimiento",
            width: 18,
            type: "date",
          },
          {
            header: "CANTIDAD CARGADA",
            key: "cantidad_cargada",
            width: 18,
            type: "number",
          },
          {
            header: "STOCK OBJETIVO",
            key: "cantidad_objetivo",
            width: 16,
            type: "number",
          },
          {
            header: "STOCK ANTERIOR",
            key: "stock_anterior",
            width: 16,
            type: "number",
          },
          {
            header: "STOCK ACTUAL",
            key: "stock_actual",
            width: 16,
            type: "number",
          },
          { header: "OBSERVACIONES", key: "observaciones", width: 34 },
          { header: "IP", key: "ip", width: 18 },
        ],
        rows,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({
        ok: false,
        mensaje: "Error al exportar el reporte de stock inicial",
      });
    }
  },
);

// GET /registros/stock-inicial/almacenes?categoria_id=X
// Retorna almacenes que tienen stock del categoria indicada (o todos si no hay categoria)
router.get(
  "/stock-inicial/almacenes",
  requireRol("superadmin", "admin", "almacenero"),
  async (req, res) => {
    try {
      const categoriaId = parsePositiveInt(req.query.categoria_id);
      const scope = await getWarehouseScope(req, "sa", pool);

      let query;
      let params = [];

      if (categoriaId) {
        // Almacenes que tienen stock de esa categoria
        query = `SELECT DISTINCT
          a.id,
          a.nombre,
          a.ciudad_id,
          c.nombre AS ciudad_nombre,
          ${getZonaExpr("c")} AS zona,
          COALESCE(SUM(sa.cantidad), 0) AS stock_total
        FROM almacenes a
        JOIN ciudades c ON c.id = a.ciudad_id
        JOIN regiones r ON r.id = c.region_id
        LEFT JOIN stock_almacen sa ON sa.almacen_id = a.id
        LEFT JOIN skus sk ON sk.id = sa.sku_id AND sk.categoria_id = ?
        WHERE a.activo = 1`;
        params.push(categoriaId);

        if (req.empresa_id) {
          query += " AND r.empresa_id = ?";
          params.push(req.empresa_id);
        }
        if (scope.ids.length) {
          query += ` AND a.id IN (${scope.ids.map(() => "?").join(",")})`;
          params.push(...scope.ids);
        }

        query += ` GROUP BY a.id, a.nombre, a.ciudad_id, c.nombre
                 ORDER BY zona, c.nombre, a.nombre`;
      } else {
        // Sin filtro de categoria: todos los almacenes activos
        query = `SELECT
          a.id,
          a.nombre,
          a.ciudad_id,
          c.nombre AS ciudad_nombre,
          ${getZonaExpr("c")} AS zona
        FROM almacenes a
        JOIN ciudades c ON c.id = a.ciudad_id
        JOIN regiones r ON r.id = c.region_id
        WHERE a.activo = 1`;

        if (req.empresa_id) {
          query += " AND r.empresa_id = ?";
          params.push(req.empresa_id);
        }
        if (scope.ids.length) {
          query += ` AND a.id IN (${scope.ids.map(() => "?").join(",")})`;
          params.push(...scope.ids);
        }
        query += " ORDER BY zona, c.nombre, a.nombre";
      }

      const [rows] = await pool.query(query, params);
      res.json({ ok: true, datos: rows });
    } catch (err) {
      console.error(err);
      res
        .status(500)
        .json({ ok: false, mensaje: "Error al obtener almacenes" });
    }
  },
);

router.get(
  "/stock-inicial/import/template",
  requireRol("superadmin", "admin", "almacenero"),
  async (req, res) => {
    try {
      const workbook = await buildStockInitialImportTemplateWorkbook(req, pool);
      await sendWorkbook(
        res,
        workbook,
        `plantilla_stock_inicial_${Date.now()}`,
      );
    } catch (err) {
      console.error(err);
      res.status(err.statusCode || 500).json({
        ok: false,
        mensaje:
          err.message || "No se pudo generar la plantilla de stock inicial",
      });
    }
  },
);

router.post(
  "/stock-inicial/import/excel",
  requireRol("superadmin", "admin", "almacenero"),
  excelUpload.single("file"),
  async (req, res) => {
    const connection = await pool.getConnection();

    try {
      if (!req.file?.path) {
        return res.status(400).json({
          ok: false,
          mensaje: "Debes adjuntar un archivo Excel .xlsx",
        });
      }

      const buffer = fs.readFileSync(req.file.path);
      const workbook = await readWorkbookFromBuffer(buffer);
      await connection.beginTransaction();
      const resumen = await importStockInitialFromWorkbook(
        connection,
        req,
        workbook,
        {
          archivo: req.file.originalname || "Carga_Stock_Inicial",
        },
      );
      await connection.commit();

      res.status(201).json({
        ok: true,
        mensaje: "Carga masiva de stock inicial completada",
        datos: resumen,
      });
    } catch (err) {
      await connection.rollback();
      console.error(err);
      res.status(err.statusCode || 400).json({
        ok: false,
        mensaje:
          err.message || "No se pudo procesar la carga masiva de stock inicial",
      });
    } finally {
      connection.release();
    }
  },
);

router.post(
  "/stock-inicial",
  requireRol("superadmin", "admin", "almacenero"),
  async (req, res) => {
    const connection = await pool.getConnection();

    try {
      const validated = await validateStockInitializationPayload(
        connection,
        req,
        req.body || {},
      );

      await connection.beginTransaction();
      const result = await applyStockInitializationEntry(
        connection,
        req,
        validated,
        {
          operacion: "SUMAR",
          origenCarga: "MANUAL",
        },
      );

      await connection.commit();
      res.status(201).json({
        ok: true,
        mensaje: "Stock inicial registrado",
        datos: {
          almacen_id: validated.almacen_id,
          sku_id: validated.sku_id,
          lote_id: result.lote_id,
          cantidad: validated.cantidad,
          stock_actual: result.stock_actual,
        },
      });
    } catch (err) {
      await connection.rollback();
      console.error(err);
      res.status(err.statusCode || 400).json({
        ok: false,
        mensaje: err.message || "No se pudo registrar el stock inicial",
      });
    } finally {
      connection.release();
    }
  },
);

router.get("/:id", async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) return sendBadRequest(res, "Id inválido");

    const registro = await getRegistroById(pool, req, id);
    if (!registro) {
      return res
        .status(404)
        .json({ ok: false, mensaje: "Registro no encontrado" });
    }

    res.json({ ok: true, datos: registro });
  } catch (err) {
    console.error(err);
    res
      .status(err.statusCode || 500)
      .json({ ok: false, mensaje: err.message || "Error interno" });
  }
});

router.get("/:id/export/excel", async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) return sendBadRequest(res, "Id inválido");

    const registro = await getRegistroById(pool, req, id);
    if (!registro) {
      return res
        .status(404)
        .json({ ok: false, mensaje: "Registro no encontrado" });
    }

    await sendExcelWorkbook(res, {
      fileName: `zentra_registro_${registro.id}_${Date.now()}`,
      sheetName: `Registro ${registro.id}`,
      columns: [
        { header: "ID", key: "id", width: 10, type: "integer" },
        { header: "FECHA", key: "fecha", width: 14, type: "date" },
        { header: "ZONA", key: "zona", width: 14 },
        { header: "CIUDAD", key: "ciudad", width: 18 },
        { header: "ALMACEN ORIGEN", key: "almacen_origen", width: 24 },
        { header: "ALMACEN DESTINO", key: "almacen_destino", width: 24 },
        { header: "CATEGORIA", key: "categoria", width: 18 },
        { header: "ACCION", key: "accion", width: 24 },
        { header: "TIPO ACCION", key: "tipo_accion", width: 16 },
        { header: "PERSONAL RECEPTOR", key: "personal_receptor", width: 26 },
        { header: "INDICADOR", key: "indicador", width: 28 },
        { header: "ITEM", key: "item", width: 10, type: "integer" },
        {
          header: "TOTAL ITEMS",
          key: "total_items",
          width: 12,
          type: "integer",
        },
        { header: "TIPO MERCADERIA", key: "tipo_mercaderia", width: 20 },
        { header: "SKU", key: "sku", width: 36 },
        { header: "LOTE", key: "lote", width: 18 },
        {
          header: "FECHA VENCIMIENTO",
          key: "fecha_vencimiento",
          width: 18,
          type: "date",
        },
        { header: "CANTIDAD", key: "cantidad", width: 14, type: "number" },
        { header: "NRO GUIA", key: "nro_guia", width: 18 },
        { header: "ESTADO", key: "estado", width: 16 },
        { header: "REGISTRADO POR", key: "registrado_por", width: 24 },
        { header: "OBSERVACION", key: "observaciones", width: 34 },
        { header: "FOTO GUIA", key: "foto_guia", width: 64, type: "link" },
      ],
      rows: mapRegistroExportRows([registro], { req }),
    });
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({
      ok: false,
      mensaje: err.message || "Error al exportar el detalle",
    });
  }
});

router.post(
  "/",
  requireRol("superadmin", "admin", "almacenero"),
  upload.single("foto_guia"),
  async (req, res) => {
    const uploadedFileName = req.file?.filename || null;
    const connection = await pool.getConnection();

    try {
      const payload = parseRegistroBody(req.body);
      const validated = await validateRegistroPayload(
        connection,
        req,
        payload,
        { currentFotoGuia: null },
      );

      await connection.beginTransaction();

      const headerValues = buildHeaderValues(validated, validated.detalles);
      const [result] = await connection.query(
        `INSERT INTO registros
       (empresa_id, almacen_origen_id, almacen_destino_id, usuario_id, fecha, ciudad_id,
        categoria_id, accion, tipo_accion, personal_receptor_id, indicador_id,
        tipo_mercaderia_id, sku_id, lote_id, fecha_vencimiento, cantidad,
        nro_guia, foto_guia, observaciones, estado)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          req.empresa_id,
          headerValues.almacen_origen_id,
          headerValues.almacen_destino_id,
          req.usuario.id,
          headerValues.fecha,
          headerValues.ciudad_id,
          headerValues.categoria_id,
          headerValues.accion,
          headerValues.tipo_accion,
          headerValues.personal_receptor_id,
          headerValues.indicador_id,
          headerValues.tipo_mercaderia_id,
          headerValues.sku_id,
          headerValues.lote_id,
          headerValues.fecha_vencimiento,
          headerValues.cantidad,
          headerValues.nro_guia,
          uploadedFileName,
          headerValues.observaciones,
          "pendiente",
        ],
      );

      await syncRegistroDetails(
        connection,
        result.insertId,
        validated.detalles,
      );
      await persistMissingLoteDates(connection, validated.detalles);

      const createdRegistro = await getRegistroById(
        connection,
        req,
        result.insertId,
      );

      await insertAuditLog(connection, {
        empresa_id: req.empresa_id,
        usuario_id: req.usuario.id,
        accion: "CREATE",
        tabla: "registros",
        registro_id: result.insertId,
        detalle: buildRegistroAuditSnapshot(createdRegistro, {
          summary: "Creo un registro",
          estado: "pendiente",
        }),
        ip: req.ip,
      });

      await connection.commit();
      res.status(201).json({
        ok: true,
        id: result.insertId,
        mensaje: "Registro creado exitosamente",
      });
    } catch (err) {
      await connection.rollback();
      if (uploadedFileName) cleanupUploadedFile(uploadedFileName);
      console.error(err);
      res.status(err.statusCode || 400).json({
        ok: false,
        mensaje: err.message || "No se pudo crear el registro",
      });
    } finally {
      connection.release();
    }
  },
);

router.put(
  "/:id",
  requireRol("superadmin", "admin"),
  upload.single("foto_guia"),
  async (req, res) => {
    const uploadedFileName = req.file?.filename || null;
    const connection = await pool.getConnection();

    try {
      const id = parsePositiveInt(req.params.id);
      if (!id) return sendBadRequest(res, "Id inválido");

      const existing = await getRegistroById(connection, req, id);
      if (!existing) {
        if (uploadedFileName) cleanupUploadedFile(uploadedFileName);
        return res
          .status(404)
          .json({ ok: false, mensaje: "Registro no encontrado" });
      }
      const isApprovedEdit = existing.estado === "aprobado";
      if (!isApprovedEdit && (await registroHasStockMovements(connection, id))) {
        if (uploadedFileName) cleanupUploadedFile(uploadedFileName);
        return sendForbidden(
          res,
          "No se puede editar un registro que ya movio stock",
        );
      }

      const payload = parseRegistroBody(req.body, existing);

      await connection.beginTransaction();

      let approvedMovementsBefore = [];
      let previousOriginRequirements = new Map();
      const useApprovedEntryDelta = isApprovedEdit && isEntradaRegistro(existing);
      if (isApprovedEdit) {
        approvedMovementsBefore = await getRegistroStockMovements(connection, id);
        previousOriginRequirements = buildPreviousOriginRequirements(approvedMovementsBefore);
        if (!useApprovedEntryDelta) {
          await reverseRecordedStockMovements(connection, id);
        }
      } else {
        previousOriginRequirements = await buildPendingEditOriginRequirements(
          connection,
          existing,
        );
      }

      const validated = await validateRegistroPayload(
        connection,
        req,
        payload,
        {
          currentFotoGuia: existing.foto_guia || null,
          previousOriginRequirements,
        },
      );

      const headerValues = buildHeaderValues(validated, validated.detalles);
      await connection.query(
        `UPDATE registros SET
         fecha=?,
         ciudad_id=?,
         almacen_origen_id=?,
         almacen_destino_id=?,
         categoria_id=?,
         accion=?,
         tipo_accion=?,
         personal_receptor_id=?,
         indicador_id=?,
         tipo_mercaderia_id=?,
         sku_id=?,
         lote_id=?,
         fecha_vencimiento=?,
         cantidad=?,
         nro_guia=?,
         foto_guia=?,
         observaciones=?
       WHERE id=?`,
        [
          headerValues.fecha,
          headerValues.ciudad_id,
          headerValues.almacen_origen_id,
          headerValues.almacen_destino_id,
          headerValues.categoria_id,
          headerValues.accion,
          headerValues.tipo_accion,
          headerValues.personal_receptor_id,
          headerValues.indicador_id,
          headerValues.tipo_mercaderia_id,
          headerValues.sku_id,
          headerValues.lote_id,
          headerValues.fecha_vencimiento,
          headerValues.cantidad,
          headerValues.nro_guia,
          uploadedFileName || existing.foto_guia || null,
          headerValues.observaciones,
          id,
        ],
      );

      await syncRegistroDetails(connection, id, validated.detalles);
      await persistMissingLoteDates(connection, validated.detalles);

      let updatedRegistro = await getRegistroById(connection, req, id);
      let approvedMovementsAfter = [];

      if (isApprovedEdit) {
        if (useApprovedEntryDelta) {
          await applyApprovedEntryStockDelta(
            connection,
            approvedMovementsBefore,
            updatedRegistro,
            req.usuario.id,
          );
        } else {
          await applyApprovalStock(connection, updatedRegistro, {
            previousRequiredByKey: previousOriginRequirements,
          });
        }
        approvedMovementsAfter = await getRegistroStockMovements(connection, id);
        updatedRegistro = await getRegistroById(connection, req, id);

        await insertApprovedRegistroChange(connection, {
          registroId: id,
          empresaId: existing.empresa_id || req.empresa_id,
          accion: "EDITAR",
          usuarioId: req.usuario.id,
          motivo: normalizeOptionalString(req.body?.motivo_edicion_aprobado),
          snapshotAntes: existing,
          snapshotDespues: updatedRegistro,
          movimientosAntes: approvedMovementsBefore,
          movimientosDespues: approvedMovementsAfter,
        });
      }

      await insertAuditLog(connection, {
        empresa_id: req.empresa_id,
        usuario_id: req.usuario.id,
        accion: isApprovedEdit ? "UPDATE_APPROVED" : "UPDATE",
        tabla: "registros",
        registro_id: id,
        detalle: buildRegistroAuditSnapshot(updatedRegistro, {
          summary: isApprovedEdit
            ? "Edito un registro aprobado y recalculo stock"
            : "Edito un registro",
          previous_estado: existing.estado,
          stock_recalculado: isApprovedEdit,
        }),
        ip: req.ip,
      });

      await connection.commit();
      res.json({ ok: true, mensaje: "Registro actualizado" });
    } catch (err) {
      await connection.rollback();
      if (uploadedFileName) cleanupUploadedFile(uploadedFileName);
      console.error(err);
      res.status(err.statusCode || 400).json({
        ok: false,
        mensaje: err.message || "No se pudo actualizar el registro",
      });
    } finally {
      connection.release();
    }
  },
);

router.patch(
  "/:id/aprobacion-detalles",
  requireRol("superadmin", "admin", "almacenero"),
  async (req, res) => {
    const connection = await pool.getConnection();

    try {
      const id = parsePositiveInt(req.params.id);
      if (!id) return sendBadRequest(res, "Id invalido");

      const existing = await getRegistroById(connection, req, id);
      if (!existing) {
        return res
          .status(404)
          .json({ ok: false, mensaje: "Registro no encontrado" });
      }
      if (!["pendiente", "en_transito"].includes(existing.estado)) {
        return sendForbidden(
          res,
          "Solo se puede editar antes de aprobar o rechazar",
        );
      }

      const payload = parseRegistroBody(
        {
          fecha: req.body?.fecha,
          detalles: req.body?.detalles,
        },
        existing,
      );

      await connection.beginTransaction();

      const hadStockMovements = await registroHasStockMovements(connection, id);
      if (hadStockMovements) {
        await reverseRecordedStockMovements(connection, id);
      }

      const validated = await validateRegistroPayload(
        connection,
        req,
        payload,
        { currentFotoGuia: existing.foto_guia || null },
      );
      const headerValues = buildHeaderValues(validated, validated.detalles);

      await updateRegistroHeaderAndDetails(
        connection,
        id,
        headerValues,
        validated.detalles,
      );

      const isMolitaliaEntry = isTgMolitaliaIndicator(
        existing.indicador_nombre || existing.indicador || "",
      );
      if (existing.estado === "en_transito" && !isMolitaliaEntry) {
        const updatedForStock = await getRegistroById(connection, req, id);
        await applyStockMovementBatch(
          connection,
          updatedForStock,
          "SALIDA_TRANSITO",
          req.usuario.id,
        );
      }

      const updatedRegistro = await getRegistroById(connection, req, id);
      await insertAuditLog(connection, {
        empresa_id: req.empresa_id,
        usuario_id: req.usuario.id,
        accion: "UPDATE",
        tabla: "registros",
        registro_id: id,
        detalle: buildRegistroAuditSnapshot(updatedRegistro, {
          summary: "Edito detalle antes de aprobacion",
          previous_estado: existing.estado,
        }),
        ip: req.ip,
      });

      await connection.commit();
      res.json({
        ok: true,
        mensaje: "Detalle actualizado para aprobacion",
        datos: updatedRegistro,
      });
    } catch (err) {
      await connection.rollback();
      console.error(err);
      res.status(err.statusCode || 400).json({
        ok: false,
        mensaje: err.message || "No se pudo actualizar el detalle",
      });
    } finally {
      connection.release();
    }
  },
);

router.patch(
  "/:id/estado",
  requireRol("superadmin", "admin", "almacenero"),
  async (req, res) => {
    const connection = await pool.getConnection();

    try {
      const id = parsePositiveInt(req.params.id);
      const estado = String(req.body?.estado || "").trim();
      if (!id) return sendBadRequest(res, "Id inválido");
      if (!ESTADOS.includes(estado))
        return sendBadRequest(res, "Estado inválido");

      const existing = await getRegistroById(connection, req, id);
      if (!existing) {
        return res
          .status(404)
          .json({ ok: false, mensaje: "Registro no encontrado" });
      }
      ensureEstadoTransitionAllowed(existing.estado, estado);

      await connection.beginTransaction();

      if (existing.estado !== estado) {
        // Detectar si el registro corresponde a TG MOLITALIA
        const isMolitaliaEntry = isTgMolitaliaIndicator(
          existing.indicador_nombre || existing.indicador || "",
        );

        // Para registros TG MOLITALIA no aplicamos SALIDA_TRANSITO (solo ingreso)
        if (existing.estado === "pendiente" && estado === "en_transito") {
          if (!isMolitaliaEntry && !isEntradaRegistro(existing)) {
            await applyStockMovementBatch(
              connection,
              existing,
              "SALIDA_TRANSITO",
              req.usuario.id,
            );
          }
        } else if (existing.estado === "pendiente" && estado === "aprobado") {
          if (isMolitaliaEntry || isEntradaRegistro(existing)) {
            // Entradas y TG MOLITALIA solo registran ingreso aprobado.
            if (shouldApplyApprovedDestinationStock(existing)) {
              await applyStockMovementBatch(
                connection,
                existing,
                "INGRESO_APROBADO",
                req.usuario.id,
              );
            }
          } else {
            await applyStockMovementBatch(
              connection,
              existing,
              "SALIDA_TRANSITO",
              req.usuario.id,
            );
            if (shouldApplyApprovedDestinationStock(existing)) {
              await applyStockMovementBatch(
                connection,
                existing,
                "INGRESO_APROBADO",
                req.usuario.id,
              );
            }
          }
        } else if (existing.estado === "en_transito" && estado === "aprobado") {
          if (shouldApplyApprovedDestinationStock(existing)) {
            await applyStockMovementBatch(
              connection,
              existing,
              "INGRESO_APROBADO",
              req.usuario.id,
            );
          }
        } else if (
          existing.estado === "en_transito" &&
          estado === "rechazado"
        ) {
          await applyStockMovementBatch(
            connection,
            existing,
            "REVERSA_RECHAZO",
            req.usuario.id,
          );
        }
      }

      const actorEstado = ["aprobado", "rechazado"].includes(estado)
        ? req.usuario.id
        : null;
      const fechaEstado = ["aprobado", "rechazado"].includes(estado)
        ? "NOW()"
        : "NULL";

      await connection.query(
        `UPDATE registros
       SET estado=?, aprobado_por=?, fecha_aprobacion=${fechaEstado}
       WHERE id=?${req.empresa_id ? " AND empresa_id=?" : ""}`,
        req.empresa_id
          ? [estado, actorEstado, id, req.empresa_id]
          : [estado, actorEstado, id],
      );

      await insertAuditLog(connection, {
        empresa_id: req.empresa_id,
        usuario_id: req.usuario.id,
        accion: "STATUS_CHANGE",
        tabla: "registros",
        registro_id: id,
        detalle: buildRegistroAuditSnapshot(existing, {
          summary: `Cambio el estado a ${estado}`,
          from: existing.estado,
          to: estado,
          estado,
        }),
        ip: req.ip,
      });

      await connection.commit();
      res.json({ ok: true, mensaje: `Estado actualizado a: ${estado}` });
    } catch (err) {
      await connection.rollback();
      console.error(err);
      res.status(err.statusCode || 400).json({
        ok: false,
        mensaje: err.message || "No se pudo actualizar el estado",
      });
    } finally {
      connection.release();
    }
  },
);

router.delete("/:id", requireRol("superadmin", "admin"), async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) return sendBadRequest(res, "Id inválido");

    const existing = await getRegistroById(connection, req, id);
    if (!existing) {
      return res
        .status(404)
        .json({ ok: false, mensaje: "Registro no encontrado" });
    }
    await connection.beginTransaction();

    const movimientosBefore = await getRegistroStockMovements(connection, id);
    let reversedMovements = [];
    if (await registroHasStockMovements(connection, id)) {
      reversedMovements = await reverseRecordedStockMovements(connection, id);
    }

    const motivo = normalizeOptionalString(req.body?.motivo_eliminacion);
    await insertDeletedRegistroBackup(connection, {
      registro: existing,
      usuarioId: req.usuario.id,
      motivo,
      movimientos: movimientosBefore,
      stockReversion: reversedMovements,
    });

    if (existing.estado === "aprobado") {
      await insertApprovedRegistroChange(connection, {
        registroId: id,
        empresaId: existing.empresa_id || req.empresa_id,
        accion: "ELIMINAR",
        usuarioId: req.usuario.id,
        motivo,
        snapshotAntes: existing,
        snapshotDespues: {
          ...existing,
          eliminado_at: new Date().toISOString(),
          eliminado_por: req.usuario.id,
          eliminado_motivo: motivo,
        },
        movimientosAntes: movimientosBefore,
        movimientosDespues: [],
      });
    }

    await connection.query(
      `UPDATE registros
       SET eliminado_at=NOW(), eliminado_por=?, eliminado_motivo=?
       WHERE id=?${req.empresa_id ? " AND empresa_id=?" : ""}`,
      req.empresa_id
        ? [req.usuario.id, motivo, id, req.empresa_id]
        : [req.usuario.id, motivo, id],
    );

    await insertAuditLog(connection, {
      empresa_id: req.empresa_id,
      usuario_id: req.usuario.id,
      accion: existing.estado === "aprobado" ? "DELETE_APPROVED" : "DELETE",
      tabla: "registros",
      registro_id: id,
      detalle: buildRegistroAuditSnapshot(existing, {
        summary:
          existing.estado === "aprobado"
            ? "Elimino logicamente un registro aprobado y reverso stock"
            : "Elimino logicamente un registro",
        logical_delete: true,
        stock_reversado: reversedMovements.length > 0,
        motivo,
      }),
      ip: req.ip,
    });

    await connection.commit();
    res.json({ ok: true, mensaje: "Registro eliminado logicamente" });
  } catch (err) {
    await connection.rollback();
    console.error(err);
    res.status(err.statusCode || 400).json({
      ok: false,
      mensaje: err.message || "No se pudo eliminar el registro",
    });
  } finally {
    connection.release();
  }
});

module.exports = router;
