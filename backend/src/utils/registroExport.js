function normalizeExportText(value) {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.,;:\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function expandTgAlmacenesRowsForKardex(
  rows = [],
  { enabled = false, indicator = "" } = {},
) {
  if (
    !enabled ||
    normalizeExportText(indicator) !== "TG ALMACENES" ||
    !rows.length
  ) {
    return rows;
  }

  const almacenOrigen = rows[0]?.almacen_origen || "";
  const almacenDestino = rows[0]?.almacen_destino || "";

  if (
    !almacenOrigen ||
    !almacenDestino ||
    normalizeExportText(almacenOrigen) === normalizeExportText(almacenDestino)
  ) {
    return rows;
  }

  return [
    ...rows.map((row) => ({
      ...row,
      almacen_origen: almacenOrigen,
      almacen_destino: almacenOrigen,
      tipo_accion: "SALIDA",
    })),
    ...rows.map((row) => ({
      ...row,
      almacen_origen: almacenDestino,
      almacen_destino: almacenDestino,
      tipo_accion: "ENTRADA",
    })),
  ];
}

module.exports = { expandTgAlmacenesRowsForKardex };
