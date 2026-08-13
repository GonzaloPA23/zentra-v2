export function normalizeWarehouseName(value) {
  if (typeof value !== 'string') return value;

  return value
    .trim()
    .replace(/^ALMAC[EÉ]N\b[\s:.-]*/i, '')
    .trim();
}

function isWarehouseNameKey(key = '') {
  return /^almacen(?:_|$)/i.test(key) && !/(?:_id|_ids)$/i.test(key);
}

export function normalizeWarehouseNamesInData(value, options = {}) {
  const { warehouseContext = false } = options;

  if (Array.isArray(value)) {
    return value.map((item) => normalizeWarehouseNamesInData(item, { warehouseContext }));
  }

  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(Object.entries(value).map(([key, childValue]) => {
    const childWarehouseContext = warehouseContext || key === 'almacenes';
    const shouldNormalize = typeof childValue === 'string'
      && (isWarehouseNameKey(key) || (warehouseContext && key === 'nombre'));

    return [
      key,
      shouldNormalize
        ? normalizeWarehouseName(childValue)
        : normalizeWarehouseNamesInData(childValue, {
          warehouseContext: childWarehouseContext,
        }),
    ];
  }));
}
