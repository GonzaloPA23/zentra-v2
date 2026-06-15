const express = require("express");
const { pool } = require("../db");
const { authMiddleware, requireRol, empresaMiddleware } = require("../middleware/auth");
const { insertAuditLog } = require("../utils/audit");

const router = express.Router();
router.use(authMiddleware, empresaMiddleware);

function parsePositiveInt(value) {
  const parsed = parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function toFlag(value) {
  return value ? 1 : 0;
}

async function validateTiposMercaderia(connection, tipoMercaderiaIds) {
  const uniqueIds = [...new Set(tipoMercaderiaIds.map((id) => parsePositiveInt(id)).filter(Boolean))];

  if (!uniqueIds.length) {
    return { ok: false, mensaje: "No hay tipos de mercaderia validos", ids: [] };
  }

  const [typeRows] = await connection.query(
    "SELECT id FROM tipos_mercaderia WHERE id IN (?) AND activo = 1",
    [uniqueIds],
  );
  const existingIds = new Set(typeRows.map((row) => Number(row.id)));
  const missingIds = uniqueIds.filter((id) => !existingIds.has(Number(id)));

  if (missingIds.length) {
    return {
      ok: false,
      mensaje: "Uno o mas tipos de mercaderia no existen o estan inactivos",
      ids: uniqueIds,
    };
  }

  return { ok: true, ids: uniqueIds };
}

async function upsertConfigNotificacion(connection, empresaId, tipoMercaderiaId, flags) {
  await connection.query(
    `INSERT INTO config_notificaciones
     (empresa_id, tipo_mercaderia_id, excluir_de_stock_critico, excluir_de_stock_bajo, excluir_de_vencimientos, activo)
     VALUES (?, ?, ?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE
       excluir_de_stock_critico = VALUES(excluir_de_stock_critico),
       excluir_de_stock_bajo = VALUES(excluir_de_stock_bajo),
       excluir_de_vencimientos = VALUES(excluir_de_vencimientos),
       activo = 1`,
    [
      empresaId,
      tipoMercaderiaId,
      flags.excluirDeStockCritico,
      flags.excluirDeStockBajo,
      flags.excluirDeVencimientos,
    ],
  );
}

router.get("/config", requireRol("superadmin", "admin"), async (req, res) => {
  try {
    const eid = req.empresa_id;
    if (!eid) {
      return res.status(403).json({ ok: false, mensaje: "Empresa requerida" });
    }

    const [config] = await pool.query(
      `SELECT MIN(cn.id) AS id,
              cn.tipo_mercaderia_id,
              tm.categoria_id,
              ca.nombre AS categoria_nombre,
              tm.nombre AS tipo_mercaderia_nombre,
              MAX(cn.excluir_de_stock_critico) AS excluir_de_stock_critico,
              MAX(cn.excluir_de_stock_bajo) AS excluir_de_stock_bajo,
              MAX(cn.excluir_de_vencimientos) AS excluir_de_vencimientos
       FROM config_notificaciones cn
       LEFT JOIN tipos_mercaderia tm ON tm.id = cn.tipo_mercaderia_id
       LEFT JOIN categorias ca ON ca.id = tm.categoria_id
       WHERE cn.empresa_id = ? AND cn.activo = 1
       GROUP BY cn.tipo_mercaderia_id, tm.categoria_id, ca.nombre, tm.nombre
       ORDER BY ca.nombre, tm.nombre`,
      [eid],
    );

    const [tiposMercaderia] = await pool.query(
      `SELECT tm.id, tm.nombre, tm.categoria_id, ca.nombre AS categoria_nombre
       FROM tipos_mercaderia tm
       LEFT JOIN categorias ca ON ca.id = tm.categoria_id
       WHERE tm.activo = 1
       ORDER BY ca.nombre, tm.nombre`,
    );

    res.json({
      ok: true,
      datos: {
        config,
        tipos_disponibles: tiposMercaderia,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, mensaje: "Error al obtener configuracion" });
  }
});

router.post("/config", requireRol("superadmin", "admin"), async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const eid = req.empresa_id;
    if (!eid) {
      return res.status(403).json({ ok: false, mensaje: "Empresa requerida" });
    }

    const {
      tipo_mercaderia_id,
      excluir_de_stock_critico,
      excluir_de_stock_bajo,
      excluir_de_vencimientos,
    } = req.body;
    const tipoMercaderiaId = parsePositiveInt(tipo_mercaderia_id);

    if (!tipoMercaderiaId) {
      return res.status(400).json({ ok: false, mensaje: "Tipo de mercaderia invalido" });
    }

    const validation = await validateTiposMercaderia(connection, [tipoMercaderiaId]);
    if (!validation.ok) {
      return res.status(404).json({ ok: false, mensaje: validation.mensaje });
    }

    await connection.beginTransaction();

    await upsertConfigNotificacion(connection, eid, tipoMercaderiaId, {
      excluirDeStockCritico: toFlag(excluir_de_stock_critico),
      excluirDeStockBajo: toFlag(excluir_de_stock_bajo),
      excluirDeVencimientos: toFlag(excluir_de_vencimientos),
    });

    await insertAuditLog(connection, {
      empresa_id: eid,
      usuario_id: req.usuario.id,
      accion: "UPDATE",
      tabla: "config_notificaciones",
      detalle: {
        summary: `Actualizo configuracion de notificaciones para tipo de mercaderia ${tipoMercaderiaId}`,
        tipo_mercaderia_id: tipoMercaderiaId,
        excluir_de_stock_critico,
        excluir_de_stock_bajo,
        excluir_de_vencimientos,
      },
      ip: req.ip,
    });

    await connection.commit();
    res.json({ ok: true, mensaje: "Configuracion actualizada" });
  } catch (err) {
    await connection.rollback();
    console.error(err);
    res.status(500).json({ ok: false, mensaje: "Error al actualizar configuracion" });
  } finally {
    connection.release();
  }
});

router.post("/config/bulk", requireRol("superadmin", "admin"), async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const eid = req.empresa_id;
    if (!eid) {
      return res.status(403).json({ ok: false, mensaje: "Empresa requerida" });
    }

    const tipoMercaderiaIds = Array.isArray(req.body.tipo_mercaderia_ids)
      ? req.body.tipo_mercaderia_ids
      : [];
    const validation = await validateTiposMercaderia(connection, tipoMercaderiaIds);

    if (!validation.ok) {
      return res.status(400).json({ ok: false, mensaje: validation.mensaje });
    }

    await connection.beginTransaction();

    const flags = {
      excluirDeStockCritico: 1,
      excluirDeStockBajo: 1,
      excluirDeVencimientos: 1,
    };

    for (const tipoMercaderiaId of validation.ids) {
      await upsertConfigNotificacion(connection, eid, tipoMercaderiaId, flags);
    }

    await insertAuditLog(connection, {
      empresa_id: eid,
      usuario_id: req.usuario.id,
      accion: "UPDATE",
      tabla: "config_notificaciones",
      detalle: {
        summary: `Actualizo ${validation.ids.length} configuraciones de notificaciones`,
        tipo_mercaderia_ids: validation.ids,
      },
      ip: req.ip,
    });

    await connection.commit();
    res.json({ ok: true, mensaje: "Configuraciones actualizadas" });
  } catch (err) {
    await connection.rollback();
    console.error(err);
    res.status(500).json({ ok: false, mensaje: "Error al actualizar configuraciones" });
  } finally {
    connection.release();
  }
});

router.delete("/config/:id", requireRol("superadmin", "admin"), async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const eid = req.empresa_id;
    const configId = parsePositiveInt(req.params.id);

    if (!eid) {
      return res.status(403).json({ ok: false, mensaje: "Empresa requerida" });
    }
    if (!configId) {
      return res.status(400).json({ ok: false, mensaje: "ID de configuracion invalido" });
    }

    const [existingRows] = await connection.query(
      "SELECT id, tipo_mercaderia_id FROM config_notificaciones WHERE id = ? AND empresa_id = ?",
      [configId, eid],
    );
    if (!existingRows.length) {
      return res.json({ ok: true, mensaje: "Configuracion ya eliminada" });
    }

    await connection.beginTransaction();

    await connection.query(
      "DELETE FROM config_notificaciones WHERE empresa_id = ? AND tipo_mercaderia_id = ?",
      [eid, existingRows[0].tipo_mercaderia_id],
    );

    await insertAuditLog(connection, {
      empresa_id: eid,
      usuario_id: req.usuario.id,
      accion: "DELETE",
      tabla: "config_notificaciones",
      detalle: { summary: `Elimino exclusion de notificaciones con ID ${configId}` },
      ip: req.ip,
    });

    await connection.commit();
    res.json({ ok: true, mensaje: "Configuracion eliminada" });
  } catch (err) {
    await connection.rollback();
    console.error(err);
    res.status(500).json({ ok: false, mensaje: "Error al eliminar configuracion" });
  } finally {
    connection.release();
  }
});

module.exports = router;
