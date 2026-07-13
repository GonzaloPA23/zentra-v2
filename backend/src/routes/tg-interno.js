const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { authMiddleware, empresaMiddleware, requireRol } = require("../middleware/auth");
const { pool } = require("../db");
const { sendExcelWorkbook } = require("../utils/excel");

const router = express.Router();
const STOCK_EPSILON = 0.000001;

// Aplicar middlewares globales
router.use(authMiddleware);
router.use(empresaMiddleware);

const uploadStorage = multer.diskStorage({
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
  storage: uploadStorage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE || "", 10) || 5 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|pdf/;
    if (allowed.test(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error("Solo se permiten JPG, PNG o PDF"));
  },
});

function parsePositiveInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parsePositiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parsePositiveIntegerQuantity(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseBooleanFlag(value) {
  return value === true || value === 1 || value === "1";
}

function cleanupUploadedFile(fileName) {
  if (!fileName) return;
  const uploadDir = process.env.UPLOAD_PATH || "./uploads";
  fs.unlink(path.resolve(uploadDir, fileName), () => {});
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) return JSON.parse(value);
  return [];
}

async function resolveEmpresaIdForWarehouse(executor, req, almacenId) {
  if (req.empresa_id) return req.empresa_id;
  const [rows] = await executor.query(
    `SELECT r.empresa_id
     FROM almacenes a
     JOIN ciudades c ON c.id = a.ciudad_id
     JOIN regiones r ON r.id = c.region_id
     WHERE a.id=?
     LIMIT 1`,
    [almacenId],
  );
  return rows[0]?.empresa_id || null;
}

function normalizeSkuName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

async function ensureTgInternoStockSchema(executor) {
  const [columns] = await executor.query(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'stock_movimientos'
       AND COLUMN_NAME IN ('tg_interno_transferencia_id')`,
  );

  if (!columns.some((column) => column.COLUMN_NAME === "tg_interno_transferencia_id")) {
    await executor.query(
      "ALTER TABLE `stock_movimientos` ADD COLUMN `tg_interno_transferencia_id` int(10) UNSIGNED DEFAULT NULL AFTER `registro_detalle_id`",
    );
  }

  const [registroColumnRows] = await executor.query(
    `SELECT IS_NULLABLE
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'stock_movimientos'
       AND COLUMN_NAME = 'registro_id'
     LIMIT 1`,
  );

  if (registroColumnRows[0]?.IS_NULLABLE === "NO") {
    await executor.query(
      "ALTER TABLE `stock_movimientos` MODIFY `registro_id` int(10) UNSIGNED DEFAULT NULL",
    );
  }
}

async function ensureTgInternoColumns(executor) {
  const [columns] = await executor.query(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'tg_interno_transferencias'
       AND COLUMN_NAME IN ('sku_origen_id','lote_origen_id','foto_guia')`,
  );
  const existing = new Set(columns.map((column) => column.COLUMN_NAME));

  if (!existing.has("sku_origen_id")) {
    await executor.query(
      "ALTER TABLE `tg_interno_transferencias` ADD COLUMN `sku_origen_id` int(10) UNSIGNED DEFAULT NULL AFTER `categoria_origen_id`",
    );
  }
  if (!existing.has("lote_origen_id")) {
    await executor.query(
      "ALTER TABLE `tg_interno_transferencias` ADD COLUMN `lote_origen_id` int(10) UNSIGNED DEFAULT NULL AFTER `sku_origen_id`",
    );
  }
  if (!existing.has("foto_guia")) {
    await executor.query(
      "ALTER TABLE `tg_interno_transferencias` ADD COLUMN `foto_guia` varchar(255) DEFAULT NULL AFTER `observaciones`",
    );
  }

  const [detailColumns] = await executor.query(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'tg_interno_detalle'
       AND COLUMN_NAME IN ('sku_destino_id','lote_destino_id')`,
  );
  const detailExisting = new Set(detailColumns.map((column) => column.COLUMN_NAME));

  if (!detailExisting.has("sku_destino_id")) {
    await executor.query(
      "ALTER TABLE `tg_interno_detalle` ADD COLUMN `sku_destino_id` int(10) UNSIGNED DEFAULT NULL AFTER `categoria_destino_id`",
    );
  }
  if (!detailExisting.has("lote_destino_id")) {
    await executor.query(
      "ALTER TABLE `tg_interno_detalle` ADD COLUMN `lote_destino_id` int(10) UNSIGNED DEFAULT NULL AFTER `sku_destino_id`",
    );
  }
}

async function getCurrentStockAmount(
  executor,
  { empresa_id, almacen_id, sku_id, lote_id },
) {
  const normalizedLoteId = parsePositiveInt(lote_id);
  const [rows] = await executor.query(
    normalizedLoteId
      ? `SELECT cantidad
         FROM stock_almacen
         WHERE empresa_id=? AND almacen_id=? AND sku_id=? AND lote_id=?
         LIMIT 1
         FOR UPDATE`
      : `SELECT cantidad
         FROM stock_almacen
         WHERE empresa_id=? AND almacen_id=? AND sku_id=? AND lote_id IS NULL
         LIMIT 1
         FOR UPDATE`,
    normalizedLoteId
      ? [empresa_id, almacen_id, sku_id, normalizedLoteId]
      : [empresa_id, almacen_id, sku_id],
  );
  const stockAmount = Number(rows[0]?.cantidad || 0);

  return stockAmount;
}

async function upsertStock(
  executor,
  { empresa_id, almacen_id, sku_id, lote_id, cantidad },
) {
  const normalizedCantidad = Number(cantidad || 0);
  if (!empresa_id || !almacen_id || !sku_id || !normalizedCantidad) return;

  const normalizedLoteId = parsePositiveInt(lote_id);
  const current = await getCurrentStockAmount(executor, {
    empresa_id,
    almacen_id,
    sku_id,
    lote_id: normalizedLoteId,
  });
  const nextCantidad = current + normalizedCantidad;

  if (nextCantidad < -STOCK_EPSILON) {
    throw new Error("El stock final no puede quedar negativo");
  }

  const [existingRows] = await executor.query(
    normalizedLoteId
      ? `SELECT id FROM stock_almacen
         WHERE empresa_id=? AND almacen_id=? AND sku_id=? AND lote_id=?
         LIMIT 1`
      : `SELECT id FROM stock_almacen
         WHERE empresa_id=? AND almacen_id=? AND sku_id=? AND lote_id IS NULL
         LIMIT 1`,
    normalizedLoteId
      ? [empresa_id, almacen_id, sku_id, normalizedLoteId]
      : [empresa_id, almacen_id, sku_id],
  );

  if (existingRows.length) {
    if (Math.abs(nextCantidad) < STOCK_EPSILON) {
      await executor.query("DELETE FROM stock_almacen WHERE id=?", [existingRows[0].id]);
      return;
    }

    await executor.query(
      "UPDATE stock_almacen SET cantidad=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
      [nextCantidad, existingRows[0].id],
    );
    return;
  }

  if (Math.abs(nextCantidad) >= STOCK_EPSILON) {
    await executor.query(
      `INSERT INTO stock_almacen
       (empresa_id, almacen_id, sku_id, lote_id, cantidad)
       VALUES (?,?,?,?,?)`,
      [empresa_id, almacen_id, sku_id, normalizedLoteId || null, nextCantidad],
    );
  }
}

async function insertTgStockMovement(executor, movement) {
  await executor.query(
    `INSERT INTO stock_movimientos
     (empresa_id, registro_id, tg_interno_transferencia_id, registro_detalle_id,
      almacen_origen_id, almacen_destino_id, sku_id, lote_id, cantidad, tipo_movimiento, usuario_id)
     VALUES (?, NULL, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
    [
      movement.empresa_id,
      movement.tg_interno_transferencia_id,
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

async function validateSkuCategory(executor, { sku_id, categoria_id, empresa_id }) {
  const [rows] = await executor.query(
    `SELECT id, codigo, nombre, zona, tiene_lote
     FROM skus
     WHERE id=? AND categoria_id=? AND activo=1
       AND (? IS NULL OR empresa_id=?)
     LIMIT 1`,
    [sku_id, categoria_id, empresa_id || null, empresa_id || null],
  );
  return rows[0] || null;
}

async function findEquivalentSkuByName(
  executor,
  { sku_nombre, sku_codigo, sku_zona, categoria_id, empresa_id },
) {
  const [rows] = await executor.query(
    `SELECT id, codigo, nombre, zona, tiene_lote
     FROM skus
     WHERE categoria_id=? AND activo=1
       AND (? IS NULL OR empresa_id=?)
     ORDER BY id`,
    [
      categoria_id,
      empresa_id || null,
      empresa_id || null,
    ],
  );

  const normalizedName = normalizeSkuName(sku_nombre);
  const normalizedCode = String(sku_codigo || "").trim();
  const normalizedZona = normalizeSkuName(sku_zona);
  return rows.find((row) => {
    if (normalizeSkuName(row.nombre) !== normalizedName) return false;
    if (normalizedCode && String(row.codigo || "").trim() !== normalizedCode) return false;
    if (normalizedZona && normalizeSkuName(row.zona) !== normalizedZona) return false;
    return true;
  }) || null;
}

async function validateLoteSku(executor, { lote_id, sku_id }) {
  if (!lote_id) return true;
  const [rows] = await executor.query(
    "SELECT id FROM lotes WHERE id=? AND sku_id=? AND activo=1 LIMIT 1",
    [lote_id, sku_id],
  );
  return rows.length > 0;
}

router.get("/stock", async (req, res) => {
  try {
    const almacenId = parsePositiveInt(req.query.almacen_id);
    const categoriaId = parsePositiveInt(req.query.categoria_id);

    if (!almacenId) {
      return res.status(400).json({ mensaje: "almacen_id requerido" });
    }

    const params = [almacenId];
    let where = "sa.almacen_id=? AND sa.cantidad > 0";
    if (req.empresa_id) {
      where += " AND sa.empresa_id=?";
      params.push(req.empresa_id);
    }
    if (categoriaId) {
      where += " AND sk.categoria_id=?";
      params.push(categoriaId);
    }

    const [rows] = await pool.query(
      `SELECT
        sa.almacen_id,
        sa.sku_id,
        sa.lote_id,
        sa.cantidad AS stock_disponible,
        sk.codigo AS sku_codigo,
        sk.nombre AS sku_nombre,
        sk.categoria_id,
        ca.nombre AS categoria_nombre,
        lo.codigo_lote,
        lo.fecha_vencimiento
       FROM stock_almacen sa
       JOIN skus sk ON sk.id = sa.sku_id
       JOIN categorias ca ON ca.id = sk.categoria_id
       LEFT JOIN lotes lo ON lo.id = sa.lote_id
       WHERE ${where}
       HAVING stock_disponible > 0
       ORDER BY ca.nombre, sk.nombre, lo.fecha_vencimiento IS NULL, lo.fecha_vencimiento, lo.codigo_lote`,
      params,
    );

    res.json({ datos: rows });
  } catch (error) {
    console.error("[TG INTERNO STOCK]", error);
    res.status(500).json({ mensaje: "Error al obtener stock disponible" });
  }
});

// GET - Listar todas las transferencias
router.get("/", async (req, res) => {
  try {
    await ensureTgInternoColumns(pool);
    const [transferencias] = await pool.query(
      `SELECT 
        t.id,
        t.empresa_id,
        t.almacen_id,
        t.categoria_origen_id,
        t.sku_origen_id,
        t.lote_origen_id,
        t.cantidad_origen,
        t.usuario_id,
        t.observaciones,
        t.foto_guia,
        t.activo,
        t.created_at,
        u.nombre as usuario_nombre,
        sk.nombre as sku_origen_nombre,
        sk.codigo as sku_origen_codigo,
        lo.codigo_lote as lote_origen_codigo,
        COUNT(DISTINCT d.id) as detalles_count
      FROM tg_interno_transferencias t
      LEFT JOIN usuarios u ON t.usuario_id = u.id
      LEFT JOIN skus sk ON sk.id = t.sku_origen_id
      LEFT JOIN lotes lo ON lo.id = t.lote_origen_id
      LEFT JOIN tg_interno_detalle d ON t.id = d.tg_interno_transferencia_id
      WHERE (? IS NULL OR t.empresa_id = ?)
      GROUP BY t.id
      ORDER BY t.created_at DESC`,
      [req.empresa_id || null, req.empresa_id || null]
    );

    res.json({ datos: transferencias });
  } catch (error) {
    console.error("[TG INTERNO GET]", error);
    res.status(500).json({ mensaje: "Error al listar transferencias" });
  }
});

// GET - Exportar a Excel (debe ir ANTES de /:id para evitar conflictos)
router.get(["/export", "/export/xlsx"], async (req, res) => {
  try {
    await ensureTgInternoColumns(pool);
    const [transferencias] = await pool.query(
      `SELECT 
        t.id,
        a.nombre as almacen,
        c1.nombre as categoria_origen,
        sk.codigo as sku_origen_codigo,
        sk.nombre as sku_origen,
        lo.codigo_lote as lote_origen,
        lo.fecha_vencimiento as fecha_vencimiento_origen,
        t.cantidad_origen,
        t.observaciones,
        t.foto_guia,
        CONCAT_WS(' ', u.nombre, u.apellido) as usuario,
        t.created_at,
        t.activo,
        d.id as detalle_id,
        c2.nombre as categoria_destino,
        skd.codigo as sku_destino_codigo,
        skd.nombre as sku_destino,
        lod.codigo_lote as lote_destino,
        lod.fecha_vencimiento as fecha_vencimiento_destino,
        d.cantidad as cantidad_destino
      FROM tg_interno_transferencias t
      LEFT JOIN almacenes a ON t.almacen_id = a.id
      LEFT JOIN categorias c1 ON t.categoria_origen_id = c1.id
      LEFT JOIN skus sk ON sk.id = t.sku_origen_id
      LEFT JOIN lotes lo ON lo.id = t.lote_origen_id
      LEFT JOIN usuarios u ON t.usuario_id = u.id
      LEFT JOIN tg_interno_detalle d ON d.tg_interno_transferencia_id = t.id
      LEFT JOIN categorias c2 ON c2.id = d.categoria_destino_id
      LEFT JOIN skus skd ON skd.id = d.sku_destino_id
      LEFT JOIN lotes lod ON lod.id = d.lote_destino_id
      WHERE (? IS NULL OR t.empresa_id = ?) AND t.activo = 1
      ORDER BY t.created_at DESC, t.id DESC, d.id ASC`,
      [req.empresa_id || null, req.empresa_id || null]
    );

    return await sendExcelWorkbook(res, {
      fileName: `tg_interno_${Date.now()}`,
      sheetName: "TG INTERNO",
      columns: [
        { header: "ID", key: "id", width: 10, type: "integer" },
        { header: "FECHA", key: "fecha", width: 18, type: "datetime" },
        { header: "ALMACEN", key: "almacen", width: 28 },
        { header: "CATEGORIA ORIGEN", key: "categoria_origen", width: 22 },
        { header: "COD. SKU ORIGEN", key: "sku_origen_codigo", width: 16 },
        { header: "SKU ORIGEN", key: "sku_origen", width: 38 },
        { header: "LOTE ORIGEN", key: "lote_origen", width: 18 },
        { header: "VENCIMIENTO ORIGEN", key: "fecha_vencimiento_origen", width: 18, type: "date" },
        { header: "CANTIDAD ORIGEN", key: "cantidad_origen", width: 16, type: "integer" },
        { header: "CATEGORIA DESTINO", key: "categoria_destino", width: 22 },
        { header: "COD. SKU DESTINO", key: "sku_destino_codigo", width: 16 },
        { header: "SKU DESTINO", key: "sku_destino", width: 38 },
        { header: "LOTE DESTINO", key: "lote_destino", width: 18 },
        { header: "VENCIMIENTO DESTINO", key: "fecha_vencimiento_destino", width: 18, type: "date" },
        { header: "CANTIDAD DESTINO", key: "cantidad_destino", width: 16, type: "integer" },
        { header: "ESTADO", key: "estado", width: 12 },
        { header: "USUARIO", key: "usuario", width: 24 },
        { header: "OBSERVACIONES", key: "observaciones", width: 36 },
        { header: "FOTO GUIA", key: "foto_guia", width: 34 },
      ],
      rows: transferencias.map((row) => ({
        id: Number(row.id || 0),
        fecha: row.created_at ? new Date(row.created_at) : null,
        almacen: row.almacen || "",
        categoria_origen: row.categoria_origen || "",
        sku_origen_codigo: row.sku_origen_codigo || "",
        sku_origen: row.sku_origen || "",
        lote_origen: row.lote_origen || "SIN LOTE",
        fecha_vencimiento_origen: row.fecha_vencimiento_origen ? new Date(row.fecha_vencimiento_origen) : null,
        cantidad_origen: Number(row.cantidad_origen || 0),
        categoria_destino: row.categoria_destino || "",
        sku_destino_codigo: row.sku_destino_codigo || "",
        sku_destino: row.sku_destino || "",
        lote_destino: row.lote_destino || "SIN LOTE",
        fecha_vencimiento_destino: row.fecha_vencimiento_destino ? new Date(row.fecha_vencimiento_destino) : null,
        cantidad_destino: Number(row.cantidad_destino || 0),
        estado: row.activo ? "ACTIVO" : "ANULADO",
        usuario: row.usuario || "",
        observaciones: row.observaciones || "",
        foto_guia: row.foto_guia || "",
      })),
    });

    res.json({
      datos: transferencias,
      mensaje: "Use una librería como xlsx para procesar",
    });
  } catch (error) {
    console.error("[TG INTERNO EXPORT]", error);
    res.status(500).json({ mensaje: "Error al exportar" });
  }
});

// GET - Obtener detalle de una transferencia
router.get("/:id", async (req, res) => {
  try {
    await ensureTgInternoColumns(pool);
    const [transferencias] = await pool.query(
      `SELECT
        t.*,
        CONCAT_WS(' ', u.nombre, u.apellido) AS usuario_nombre,
        sk.nombre AS sku_origen_nombre,
        sk.codigo AS sku_origen_codigo,
        lo.codigo_lote AS lote_origen_codigo
       FROM tg_interno_transferencias t
       LEFT JOIN usuarios u ON u.id = t.usuario_id
       LEFT JOIN skus sk ON sk.id = t.sku_origen_id
       LEFT JOIN lotes lo ON lo.id = t.lote_origen_id
       WHERE t.id = ? AND (? IS NULL OR t.empresa_id = ?)`,
      [req.params.id, req.empresa_id || null, req.empresa_id || null]
    );

    if (!transferencias.length) {
      return res.status(404).json({ mensaje: "Transferencia no encontrada" });
    }

    const [detalles] = await pool.query(
      `SELECT 
        d.id,
        d.categoria_destino_id,
        d.sku_destino_id,
        d.lote_destino_id,
        d.cantidad,
        c.nombre as categoria_nombre,
        sk.nombre as sku_destino_nombre,
        sk.codigo as sku_destino_codigo,
        lo.codigo_lote as lote_destino_codigo
      FROM tg_interno_detalle d
      LEFT JOIN categorias c ON d.categoria_destino_id = c.id
      LEFT JOIN skus sk ON sk.id = d.sku_destino_id
      LEFT JOIN lotes lo ON lo.id = d.lote_destino_id
      WHERE d.tg_interno_transferencia_id = ?`,
      [req.params.id]
    );

    res.json({
      dato: {
        ...transferencias[0],
        detalles,
      },
    });
  } catch (error) {
    console.error("[TG INTERNO GET DETALLE]", error);
    res.status(500).json({ mensaje: "Error al obtener transferencia" });
  }
});

// POST - Crear nueva transferencia
router.post("/", upload.single("foto_guia"), async (req, res) => {
  const uploadedFileName = req.file?.filename || null;
  const {
    almacen_id,
    categoria_origen_id,
    sku_origen_id,
    lote_origen_id,
    cantidad_origen,
    observaciones,
    detalles: detallesRaw,
  } = req.body;
  let detalles = [];
  try {
    detalles = parseJsonArray(detallesRaw);
  } catch {
    if (uploadedFileName) cleanupUploadedFile(uploadedFileName);
    return res.status(400).json({ mensaje: "El detalle de destinos no tiene un formato valido" });
  }

  // Validaciones
  if (!almacen_id || !categoria_origen_id || !sku_origen_id || !cantidad_origen) {
    return res.status(400).json({ mensaje: "Faltan datos requeridos" });
  }
  if (!uploadedFileName) {
    return res.status(400).json({ mensaje: "Foto guia requerida" });
  }

  if (!Array.isArray(detalles) || detalles.length < 1) {
    return res.status(400).json({ mensaje: "Debe haber mínimo 1 destino" });
  }

  const detalleInvalido = detalles.some((detalle) => (
    !detalle.categoria_destino_id ||
    !Number.isInteger(Number(detalle.cantidad)) ||
    Number(detalle.cantidad) <= 0
  ));
  if (detalleInvalido) {
    return res.status(400).json({ mensaje: "Cada destino requiere categoría y cantidad mayor a 0" });
  }

  const sumaDestinos = detalles.reduce((sum, d) => sum + Number(d.cantidad), 0);
  if (!Number.isInteger(Number(cantidad_origen)) || Number(cantidad_origen) <= 0) {
    return res
      .status(400)
      .json({ mensaje: "La cantidad a trasladar debe ser un entero mayor a 0" });
  }
  if (sumaDestinos !== Number(cantidad_origen)) {
    return res
      .status(400)
      .json({ mensaje: "La suma de destinos debe ser igual al origen" });
  }

  try {
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      await ensureTgInternoColumns(connection);
      await ensureTgInternoStockSchema(connection);

      const almacenId = parsePositiveInt(almacen_id);
      const categoriaOrigenId = parsePositiveInt(categoria_origen_id);
      const skuOrigenId = parsePositiveInt(sku_origen_id);
      const loteOrigenId = parsePositiveInt(lote_origen_id);
      const cantidadOrigenNumber = parsePositiveIntegerQuantity(cantidad_origen);
      const empresaId = await resolveEmpresaIdForWarehouse(connection, req, almacenId);
      if (!empresaId) {
        throw new Error("No se pudo resolver la empresa del almacen seleccionado");
      }
      if (!cantidadOrigenNumber) {
        throw new Error("La cantidad a trasladar debe ser un entero mayor a 0");
      }

      const skuOrigen = await validateSkuCategory(connection, {
        sku_id: skuOrigenId,
        categoria_id: categoriaOrigenId,
        empresa_id: empresaId,
      });
      if (!skuOrigen) {
        throw new Error("El SKU origen no pertenece a la categoria seleccionada");
      }
      if (!(await validateLoteSku(connection, { lote_id: loteOrigenId, sku_id: skuOrigenId }))) {
        throw new Error("El lote origen no pertenece al SKU seleccionado");
      }

      const stockDisponible = await getCurrentStockAmount(connection, {
        empresa_id: empresaId,
        almacen_id: almacenId,
        sku_id: skuOrigenId,
        lote_id: loteOrigenId,
      });
      if (stockDisponible - cantidadOrigenNumber < -STOCK_EPSILON) {
        throw new Error(
          `Stock insuficiente para ${skuOrigen.nombre}. Disponible: ${Math.max(0, stockDisponible)}, salida solicitada: ${cantidadOrigenNumber}`,
        );
      }

      for (const detalle of detalles) {
        const categoriaDestinoId = parsePositiveInt(detalle.categoria_destino_id);
        let skuDestinoId = parsePositiveInt(detalle.sku_destino_id);
        const loteDestinoId = parsePositiveInt(detalle.lote_destino_id);
        if (categoriaDestinoId === categoriaOrigenId) {
          throw new Error("La categoria destino debe ser distinta a la categoria origen");
        }

        let skuDestino = skuDestinoId
          ? await validateSkuCategory(connection, {
              sku_id: skuDestinoId,
              categoria_id: categoriaDestinoId,
              empresa_id: empresaId,
            })
          : null;
        if (!skuDestino) {
          skuDestino = await findEquivalentSkuByName(connection, {
            sku_nombre: skuOrigen.nombre,
            sku_codigo: skuOrigen.codigo,
            sku_zona: skuOrigen.zona,
            categoria_id: categoriaDestinoId,
            empresa_id: empresaId,
          });
          skuDestinoId = skuDestino?.id || null;
        }
        if (!skuDestino) {
          throw new Error(`No existe ${skuOrigen.nombre} en una categoria destino seleccionada`);
        }
        if (normalizeSkuName(skuDestino.nombre) !== normalizeSkuName(skuOrigen.nombre)) {
          throw new Error(
            `El SKU destino debe ser el mismo SKU que el origen (${skuOrigen.nombre}), solo en otra categoria`,
          );
        }
        if (skuOrigen.codigo && String(skuDestino.codigo || "") !== String(skuOrigen.codigo)) {
          throw new Error("El SKU destino debe tener el mismo codigo que el SKU origen");
        }
        if (skuOrigen.zona && skuDestino.zona && normalizeSkuName(skuDestino.zona) !== normalizeSkuName(skuOrigen.zona)) {
          throw new Error("El SKU destino debe pertenecer a la misma zona que el SKU origen");
        }
        if (parseBooleanFlag(skuDestino.tiene_lote) && !loteDestinoId) {
          throw new Error(`Selecciona un lote destino para ${skuDestino.nombre}`);
        }
        if (!(await validateLoteSku(connection, { lote_id: loteDestinoId, sku_id: skuDestinoId }))) {
          throw new Error("Un lote destino no pertenece al SKU seleccionado");
        }
      }

      // Crear transferencia
      const [result] = await connection.query(
        `INSERT INTO tg_interno_transferencias 
        (empresa_id, almacen_id, categoria_origen_id, sku_origen_id, lote_origen_id, cantidad_origen, usuario_id, observaciones, foto_guia, activo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          empresaId,
          almacenId,
          categoriaOrigenId,
          skuOrigenId,
          loteOrigenId || null,
          cantidadOrigenNumber,
          req.usuario.id,
          observaciones || null,
          uploadedFileName,
        ]
      );

      const transferenciaId = result.insertId;

      // Crear detalles
      for (const detalle of detalles) {
        const categoriaDestinoId = parsePositiveInt(detalle.categoria_destino_id);
        const skuDestinoId = parsePositiveInt(detalle.sku_destino_id) || (
          await findEquivalentSkuByName(connection, {
            sku_nombre: skuOrigen.nombre,
            sku_codigo: skuOrigen.codigo,
            sku_zona: skuOrigen.zona,
            categoria_id: categoriaDestinoId,
            empresa_id: empresaId,
          })
        )?.id;
        const loteDestinoId = parsePositiveInt(detalle.lote_destino_id);
        const cantidadDetalle = parsePositiveIntegerQuantity(detalle.cantidad);
        if (!skuDestinoId) {
          throw new Error(`No existe ${skuOrigen.nombre} en una categoria destino seleccionada`);
        }
        if (!cantidadDetalle) {
          throw new Error("Las cantidades destino deben ser enteros mayores a 0");
        }
        const skuDestino = await validateSkuCategory(connection, {
          sku_id: skuDestinoId,
          categoria_id: categoriaDestinoId,
          empresa_id: empresaId,
        });
        if (parseBooleanFlag(skuDestino?.tiene_lote) && !loteDestinoId) {
          throw new Error(`Selecciona un lote destino para ${skuDestino.nombre}`);
        }
        await connection.query(
          `INSERT INTO tg_interno_detalle 
          (tg_interno_transferencia_id, categoria_destino_id, sku_destino_id, lote_destino_id, cantidad)
          VALUES (?, ?, ?, ?, ?)`,
          [transferenciaId, categoriaDestinoId, skuDestinoId, loteDestinoId || null, cantidadDetalle]
        );

        await upsertStock(connection, {
          empresa_id: empresaId,
          almacen_id: almacenId,
          sku_id: skuDestinoId,
          lote_id: loteDestinoId,
          cantidad: cantidadDetalle,
        });

        await insertTgStockMovement(connection, {
          empresa_id: empresaId,
          tg_interno_transferencia_id: transferenciaId,
          almacen_origen_id: almacenId,
          almacen_destino_id: almacenId,
          sku_id: skuDestinoId,
          lote_id: loteDestinoId,
          cantidad: cantidadDetalle,
          tipo_movimiento: "TG_INTERNO_ENTRADA",
          usuario_id: req.usuario.id,
        });
      }

      await upsertStock(connection, {
        empresa_id: empresaId,
        almacen_id: almacenId,
        sku_id: skuOrigenId,
        lote_id: loteOrigenId,
        cantidad: cantidadOrigenNumber * -1,
      });

      await insertTgStockMovement(connection, {
        empresa_id: empresaId,
        tg_interno_transferencia_id: transferenciaId,
        almacen_origen_id: almacenId,
        almacen_destino_id: almacenId,
        sku_id: skuOrigenId,
        lote_id: loteOrigenId,
        cantidad: cantidadOrigenNumber,
        tipo_movimiento: "TG_INTERNO_SALIDA",
        usuario_id: req.usuario.id,
      });

      await connection.commit();

      res.status(201).json({
        mensaje: "Transferencia creada exitosamente",
        id: transferenciaId,
      });
    } catch (err) {
      await connection.rollback();
      if (uploadedFileName) cleanupUploadedFile(uploadedFileName);
      throw err;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("[TG INTERNO POST]", error);
    res.status(500).json({ mensaje: error.message || "Error al crear transferencia" });
  }
});

// PUT - Editar montos de una transferencia activa
router.put("/:id", requireRol("superadmin", "admin"), upload.single("foto_guia"), async (req, res) => {
  const uploadedFileName = req.file?.filename || null;
  const { cantidad_origen, observaciones, detalles: detallesRaw } = req.body;
  let detalles = [];
  try {
    detalles = parseJsonArray(detallesRaw);
  } catch {
    if (uploadedFileName) cleanupUploadedFile(uploadedFileName);
    return res.status(400).json({ mensaje: "El detalle de destinos no tiene un formato valido" });
  }

  if (!parsePositiveIntegerQuantity(cantidad_origen)) {
    return res.status(400).json({ mensaje: "La cantidad a trasladar debe ser un entero mayor a 0" });
  }
  if (!Array.isArray(detalles) || detalles.length < 1) {
    return res.status(400).json({ mensaje: "Debe haber al menos 1 destino" });
  }
  if (detalles.some((detalle) => !parsePositiveInt(detalle.id) || !parsePositiveIntegerQuantity(detalle.cantidad))) {
    return res.status(400).json({ mensaje: "Cada destino requiere id y cantidad entera mayor a 0" });
  }

  const cantidadOrigenNumber = parsePositiveIntegerQuantity(cantidad_origen);
  const sumaDestinos = detalles.reduce((sum, detalle) => sum + Number(detalle.cantidad), 0);
  if (sumaDestinos !== cantidadOrigenNumber) {
    return res.status(400).json({ mensaje: "La suma de destinos debe ser igual al origen" });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await ensureTgInternoColumns(connection);
    await ensureTgInternoStockSchema(connection);

    const [transferencias] = await connection.query(
      `SELECT * FROM tg_interno_transferencias
       WHERE id = ? AND (? IS NULL OR empresa_id = ?)
       LIMIT 1
       FOR UPDATE`,
      [req.params.id, req.empresa_id || null, req.empresa_id || null],
    );

    if (!transferencias.length) {
      await connection.rollback();
      return res.status(404).json({ mensaje: "Transferencia no encontrada" });
    }

    const transferencia = transferencias[0];
    const empresaId = transferencia.empresa_id || req.empresa_id;
    if (!transferencia.activo) {
      await connection.rollback();
      return res.status(400).json({ mensaje: "No se puede editar una transferencia inactiva" });
    }
    if (!uploadedFileName && !transferencia.foto_guia) {
      await connection.rollback();
      return res.status(400).json({ mensaje: "Foto guia requerida" });
    }

    const [detallesActuales] = await connection.query(
      "SELECT * FROM tg_interno_detalle WHERE tg_interno_transferencia_id=? FOR UPDATE",
      [req.params.id],
    );
    const detalleActualPorId = new Map(detallesActuales.map((detalle) => [Number(detalle.id), detalle]));

    if (detalles.length !== detallesActuales.length) {
      await connection.rollback();
      return res.status(400).json({ mensaje: "Solo se pueden editar los montos de los destinos existentes" });
    }

    for (const detalle of detalles) {
      if (!detalleActualPorId.has(Number(detalle.id))) {
        await connection.rollback();
        return res.status(400).json({ mensaje: "Un destino no pertenece a esta transferencia" });
      }
    }

    await upsertStock(connection, {
      empresa_id: empresaId,
      almacen_id: transferencia.almacen_id,
      sku_id: transferencia.sku_origen_id,
      lote_id: transferencia.lote_origen_id,
      cantidad: Number(transferencia.cantidad_origen || 0),
    });

    for (const detalle of detallesActuales) {
      await upsertStock(connection, {
        empresa_id: empresaId,
        almacen_id: transferencia.almacen_id,
        sku_id: detalle.sku_destino_id,
        lote_id: detalle.lote_destino_id,
        cantidad: Number(detalle.cantidad || 0) * -1,
      });
    }

    const stockDisponible = await getCurrentStockAmount(connection, {
      empresa_id: empresaId,
      almacen_id: transferencia.almacen_id,
      sku_id: transferencia.sku_origen_id,
      lote_id: transferencia.lote_origen_id,
    });
    if (stockDisponible - cantidadOrigenNumber < -STOCK_EPSILON) {
      await connection.rollback();
      return res.status(400).json({
        mensaje: `Stock insuficiente. Disponible: ${Math.max(0, stockDisponible)}, salida solicitada: ${cantidadOrigenNumber}`,
      });
    }

    await connection.query(
      `UPDATE tg_interno_transferencias
       SET cantidad_origen=?, observaciones=?, updated_at=CURRENT_TIMESTAMP
       WHERE id=?`,
      [cantidadOrigenNumber, observaciones || null, req.params.id],
    );
    if (uploadedFileName) {
      await connection.query(
        "UPDATE tg_interno_transferencias SET foto_guia=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
        [uploadedFileName, req.params.id],
      );
      cleanupUploadedFile(transferencia.foto_guia);
    }

    for (const detalle of detalles) {
      const detalleActual = detalleActualPorId.get(Number(detalle.id));
      const nuevaCantidad = parsePositiveIntegerQuantity(detalle.cantidad);

      await connection.query(
        "UPDATE tg_interno_detalle SET cantidad=? WHERE id=? AND tg_interno_transferencia_id=?",
        [nuevaCantidad, detalleActual.id, req.params.id],
      );

      await upsertStock(connection, {
        empresa_id: empresaId,
        almacen_id: transferencia.almacen_id,
        sku_id: detalleActual.sku_destino_id,
        lote_id: detalleActual.lote_destino_id,
        cantidad: nuevaCantidad,
      });
    }

    await upsertStock(connection, {
      empresa_id: empresaId,
      almacen_id: transferencia.almacen_id,
      sku_id: transferencia.sku_origen_id,
      lote_id: transferencia.lote_origen_id,
      cantidad: cantidadOrigenNumber * -1,
    });

    await connection.query(
      "DELETE FROM stock_movimientos WHERE tg_interno_transferencia_id=?",
      [req.params.id],
    );

    for (const detalle of detalles) {
      const detalleActual = detalleActualPorId.get(Number(detalle.id));
      await insertTgStockMovement(connection, {
        empresa_id: empresaId,
        tg_interno_transferencia_id: req.params.id,
        almacen_origen_id: transferencia.almacen_id,
        almacen_destino_id: transferencia.almacen_id,
        sku_id: detalleActual.sku_destino_id,
        lote_id: detalleActual.lote_destino_id,
        cantidad: parsePositiveIntegerQuantity(detalle.cantidad),
        tipo_movimiento: "TG_INTERNO_ENTRADA",
        usuario_id: req.usuario.id,
      });
    }

    await insertTgStockMovement(connection, {
      empresa_id: empresaId,
      tg_interno_transferencia_id: req.params.id,
      almacen_origen_id: transferencia.almacen_id,
      almacen_destino_id: transferencia.almacen_id,
      sku_id: transferencia.sku_origen_id,
      lote_id: transferencia.lote_origen_id,
      cantidad: cantidadOrigenNumber,
      tipo_movimiento: "TG_INTERNO_SALIDA",
      usuario_id: req.usuario.id,
    });

    await connection.commit();
    res.json({ mensaje: "Transferencia actualizada exitosamente" });
  } catch (error) {
    await connection.rollback();
    if (uploadedFileName) cleanupUploadedFile(uploadedFileName);
    console.error("[TG INTERNO PUT]", error);
    res.status(500).json({ mensaje: error.message || "Error al editar transferencia" });
  } finally {
    connection.release();
  }
});

// DELETE - Anular una transferencia
router.delete("/:id", requireRol("superadmin", "admin"), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await ensureTgInternoColumns(connection);
    await ensureTgInternoStockSchema(connection);

    const [transferencias] = await connection.query(
      `SELECT * FROM tg_interno_transferencias
       WHERE id = ? AND (? IS NULL OR empresa_id = ?)
       LIMIT 1
       FOR UPDATE`,
      [req.params.id, req.empresa_id || null, req.empresa_id || null]
    );

    if (!transferencias.length) {
      await connection.rollback();
      return res.status(404).json({ mensaje: "Transferencia no encontrada" });
    }

    const transferencia = transferencias[0];
    if (!transferencia.activo) {
      await connection.rollback();
      return res.json({ mensaje: "Transferencia ya estaba anulada" });
    }

    const [detalles] = await connection.query(
      "SELECT * FROM tg_interno_detalle WHERE tg_interno_transferencia_id=?",
      [req.params.id],
    );

    await upsertStock(connection, {
      empresa_id: req.empresa_id,
      almacen_id: transferencia.almacen_id,
      sku_id: transferencia.sku_origen_id,
      lote_id: transferencia.lote_origen_id,
      cantidad: Number(transferencia.cantidad_origen || 0),
    });

    for (const detalle of detalles) {
      await upsertStock(connection, {
        empresa_id: req.empresa_id,
        almacen_id: transferencia.almacen_id,
        sku_id: detalle.sku_destino_id,
        lote_id: detalle.lote_destino_id,
        cantidad: Number(detalle.cantidad || 0) * -1,
      });
    }

    await connection.query(
      "DELETE FROM stock_movimientos WHERE tg_interno_transferencia_id=?",
      [req.params.id],
    );

    await connection.query(
      `UPDATE tg_interno_transferencias SET activo = 0 WHERE id = ?`,
      [req.params.id]
    );

    await connection.commit();
    res.json({ mensaje: "Transferencia anulada exitosamente" });
  } catch (error) {
    await connection.rollback();
    console.error("[TG INTERNO DELETE]", error);
    res.status(500).json({ mensaje: error.message || "Error al anular transferencia" });
  } finally {
    connection.release();
  }
});

module.exports = router;
